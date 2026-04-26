import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { requestJson, waitForHttp } from "./utils/http.js";
import { copyRepo, writeBackendEnv, writeClientEnv } from "./utils/workspace.js";
import { runCommand, startProcess, stopProcesses } from "./utils/process.js";
import { runHttpExamples } from "./suites/httpExamples.js";
import { runSocketExamples } from "./suites/socketExamples.js";
import { runDigipogsExamples } from "./suites/digipogsExamples.js";
import { runCurrentOAuthExample } from "./suites/oauthCurrentExample.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
loadEnv({ path: path.join(repoRoot, ".env") });

const supportsColor = process.stdout.isTTY && process.env.NO_COLOR !== "1";
const ANSI = {
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	cyan: "\x1b[36m",
	reset: "\x1b[0m",
};

function colorize(color, text) {
	if (!supportsColor) return text;
	return `${ANSI[color] || ""}${text}${ANSI.reset}`;
}

function logInfo(message) {
	console.log(colorize("cyan", message));
}

function logPass(message) {
	console.log(colorize("green", message));
}

function logWarn(message) {
	console.log(colorize("yellow", message));
}

function logFail(message) {
	console.log(colorize("red", message));
}

const backendRepoValue = process.env.FORMBAR_BACKEND_REPO;
const clientRepoValue = process.env.FORMBAR_CLIENT_REPO;
const backendRepo = backendRepoValue ? path.resolve(backendRepoValue) : "";
const clientRepo = clientRepoValue ? path.resolve(clientRepoValue) : "";
const workRoot = path.resolve(process.env.WORK_DIR || path.join(repoRoot, ".tmp"));
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runRoot = path.join(workRoot, `run-${runId}`);
const backendCopy = path.join(runRoot, "Formbar.js");
const clientCopy = path.join(runRoot, "Formbar.ts-client");
const portOffset = Math.floor(Math.random() * 1000);
const backendPort = Number(process.env.FORMBAR_BACKEND_PORT || 4420 + portOffset);
const frontendPort = Number(process.env.FORMBAR_FRONTEND_PORT || 5520 + portOffset);
const backendUrl = `http://127.0.0.1:${backendPort}`;
const apiBaseUrl = `${backendUrl}/api/v1`;
const frontendUrl = `http://127.0.0.1:${frontendPort}`;

const processes = [];
const results = [];

async function runSuite(name, fn, ctx) {
	const started = Date.now();
	const timeoutMs = Number(process.env.SUITE_TIMEOUT_MS || 120_000);
	try {
		await Promise.race([
			fn(ctx),
			new Promise((_, reject) => {
				setTimeout(() => reject(new Error(`${name} timed out after ${timeoutMs}ms`)), timeoutMs);
			}),
		]);
		results.push({ name, status: "passed", durationMs: Date.now() - started });
		logPass(`PASS ${name}`);
	} catch (error) {
		results.push({ name, status: error?.skip ? "skipped" : "failed", durationMs: Date.now() - started, error });
		if (error?.skip) {
			logWarn(`SKIP ${name}: ${error.message}`);
		} else {
			logFail(`FAIL ${name}: ${error.message}`);
		}
	}
}

async function prepareWorkspace() {
	if (!backendRepoValue) {
		throw new Error("FORMBAR_BACKEND_REPO is not set. Copy .env.example to .env and set the backend path.");
	}
	if (!clientRepoValue) {
		throw new Error("FORMBAR_CLIENT_REPO is not set. Copy .env.example to .env and set the frontend path.");
	}
	if (!existsSync(backendRepo)) {
		throw new Error(`Backend repo was not found: ${backendRepo}`);
	}
	if (!existsSync(clientRepo)) {
		throw new Error(`Frontend repo was not found: ${clientRepo}`);
	}

	await copyRepo(backendRepo, backendCopy, {
		excludeNames: new Set([".git", "node_modules", "Formbar.js.wiki", "Formbar.ts-client", "logs"]),
		excludeRelative: new Set(["database/database.db", "database/database.bak", "public-key.pem", "private-key.pem"]),
	});
	await copyRepo(clientRepo, clientCopy, {
		excludeNames: new Set([".git", "node_modules", "dist"]),
		excludeRelative: new Set([".env"]),
	});

	writeBackendEnv(backendCopy, { port: backendPort, frontendUrl });
	writeClientEnv(clientCopy, { apiUrl: backendUrl, clientUrl: frontendUrl });
}

async function installAndInitialize() {
	if (process.env.SKIP_INSTALL !== "true") {
		logInfo("Installing backend dependencies...");
		await runCommand("npm", ["install"], { cwd: backendCopy, title: "backend npm install" });
		logInfo("Installing frontend dependencies...");
		await runCommand("npm", ["install"], { cwd: clientCopy, title: "frontend npm install" });
	}

	logInfo("Initializing fresh backend database...");
	await runCommand("npm", ["run", "init-db"], { cwd: backendCopy, title: "backend init-db" });
	logInfo("Running backend migrations...");
	await runCommand("npm", ["run", "migrate"], {
		cwd: backendCopy,
		title: "backend migrate",
		env: { SKIP_BACKUP: "true" },
	});
}

async function startServices() {
	logInfo(`Starting backend on ${backendUrl}...`);
	processes.push(
		startProcess("node", ["app.js"], {
			cwd: backendCopy,
			title: "backend",
			env: {
				PORT: String(backendPort),
				ENABLE_CORS: "true",
				FRONTEND_URL: frontendUrl,
				EMAIL_ENABLED: "false",
				RATE_LIMIT_MULTIPLIER: "50",
			},
		})
	);
	await waitForHttp(`${backendUrl}/docs.json`, 60_000);

	logInfo(`Starting frontend on ${frontendUrl}...`);
	processes.push(
		startProcess("node", ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(frontendPort)], {
			cwd: clientCopy,
			title: "frontend",
		})
	);
	await waitForHttp(frontendUrl, 60_000);
}

async function seedUsers(ctx) {
	logInfo("Seeding manager and student users...");
	const stamp = Date.now();
	const manager = await requestJson(`${apiBaseUrl}/auth/register`, {
		method: "POST",
		body: {
			email: `wiki-manager-${stamp}@example.com`,
			password: "pass12345",
			displayName: `WikiMgr${String(stamp).slice(-8)}`,
		},
	});
	const student = await requestJson(`${apiBaseUrl}/auth/register`, {
		method: "POST",
		body: {
			email: `wiki-student-${stamp}@example.com`,
			password: "pass12345",
			displayName: `WikiStu${String(stamp).slice(-8)}`,
		},
	});

	ctx.users = {
		manager: {
			email: manager.data.user.email,
			password: "pass12345",
			id: Number(manager.data.user.id),
			accessToken: manager.data.accessToken,
			refreshToken: manager.data.refreshToken,
		},
		student: {
			email: student.data.user.email,
			password: "pass12345",
			id: Number(student.data.user.id),
			accessToken: student.data.accessToken,
			refreshToken: student.data.refreshToken,
		},
	};
}

async function main() {
	const ctx = {
		backendCopy,
		clientCopy,
		backendUrl,
		apiBaseUrl,
		frontendUrl,
		users: {},
		shared: {},
	};

	let runError;
	try {
		await prepareWorkspace();
		await installAndInitialize();
		await startServices();
		await seedUsers(ctx);

		await runSuite("HTTP wiki examples", runHttpExamples, ctx);
		await runSuite("Socket wiki examples", runSocketExamples, ctx);
		await runSuite("Digipogs wiki examples", runDigipogsExamples, ctx);
		await runSuite("Current frontend OAuth redirect example", runCurrentOAuthExample, ctx);
	} catch (error) {
		runError = error;
	} finally {
		await stopProcesses(processes);
		if (process.env.KEEP_WORKDIR !== "true") {
			try {
				rmSync(runRoot, { recursive: true, force: true });
			} catch (cleanupError) {
				logFail(`Could not remove temporary workspace ${runRoot}: ${cleanupError.message}`);
			}
		} else {
			logWarn(`Kept temporary workspace: ${runRoot}`);
		}
	}

	if (runError) {
		throw runError;
	}

	const failed = results.filter((result) => result.status === "failed");
	console.log(`\n${colorize("blue", "Summary")}`);
	for (const result of results) {
		const line = `${result.status.toUpperCase()} ${result.name} (${result.durationMs}ms)`;
		if (result.status === "passed") {
			logPass(line);
		} else if (result.status === "skipped") {
			logWarn(line);
		} else {
			logFail(line);
		}
	}

	if (failed.length > 0) {
		process.exitCode = 1;
	}
}

main().catch(async (error) => {
	await stopProcesses(processes);
	logFail(error?.stack || error?.message || String(error));
	process.exitCode = 1;
});
