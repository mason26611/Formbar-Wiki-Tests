import { spawn } from "node:child_process";

function spawnSpec(command, args) {
	if (process.platform === "win32") {
		return {
			command: "cmd.exe",
			args: ["/d", "/s", "/c", command, ...args],
		};
	}
	return { command, args };
}

export function runCommand(command, args, { cwd, env = {}, title = command, timeoutMs = 180_000 } = {}) {
	return new Promise((resolve, reject) => {
		const spec = spawnSpec(command, args);
		const child = spawn(spec.command, spec.args, {
			cwd,
			env: { ...process.env, ...env },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let output = "";
		const timer = setTimeout(() => {
			child.kill();
			reject(new Error(`${title} timed out after ${timeoutMs}ms\n${output}`));
		}, timeoutMs);

		child.stdout.on("data", (chunk) => {
			output += chunk.toString();
		});
		child.stderr.on("data", (chunk) => {
			output += chunk.toString();
		});
		child.on("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.on("exit", (code) => {
			clearTimeout(timer);
			if (code === 0) {
				resolve(output);
			} else {
				reject(new Error(`${title} failed with exit code ${code}\n${output}`));
			}
		});
	});
}

export function startProcess(command, args, { cwd, env = {}, title = command } = {}) {
	const spec = spawnSpec(command, args);
	const child = spawn(spec.command, spec.args, {
		cwd,
		env: { ...process.env, ...env },
		stdio: ["ignore", "pipe", "pipe"],
	});
	child.stdout.on("data", (chunk) => process.stdout.write(`[${title}] ${chunk}`));
	child.stderr.on("data", (chunk) => process.stderr.write(`[${title}] ${chunk}`));
	child.on("exit", (code) => {
		if (code !== null && code !== 0) {
			console.log(`[${title}] exited with code ${code}`);
		}
	});
	return child;
}

export async function stopProcesses(processes) {
	await Promise.all(processes.map((child) => stopProcess(child)));
}

function stopProcess(child) {
	return new Promise((resolve) => {
		if (!child || child.exitCode !== null) {
			resolve();
			return;
		}

		child.once("exit", resolve);

		if (process.platform === "win32") {
			const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
				stdio: "ignore",
			});
			killer.once("exit", () => setTimeout(resolve, 250));
			killer.once("error", () => {
				try {
					child.kill();
				} catch {}
				setTimeout(resolve, 1000);
			});
			return;
		}

		try {
			child.kill("SIGTERM");
		} catch {}
		setTimeout(() => {
			try {
				child.kill("SIGKILL");
			} catch {}
			resolve();
		}, 3000);
	});
}
