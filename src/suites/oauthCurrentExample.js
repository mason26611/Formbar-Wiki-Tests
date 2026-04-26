import http from "node:http";
import { requestJson } from "../utils/http.js";
import { assert, skip, step } from "../utils/assert.js";

function startExampleApp({ frontendUrl }) {
	let capturedToken = null;
	const server = http.createServer((req, res) => {
		const url = new URL(req.url, "http://127.0.0.1:4890");
		if (url.pathname === "/") {
			const callback = "http://127.0.0.1:4890/login/callback";
			const target = new URL("/oauth", frontendUrl);
			target.searchParams.set("redirectURL", callback);
			res.writeHead(302, { Location: target.toString() });
			res.end();
			return;
		}

		if (url.pathname === "/login/callback") {
			capturedToken = url.searchParams.get("token");
			res.writeHead(200, { "Content-Type": "text/plain" });
			res.end(capturedToken ? "logged in" : "missing token");
			return;
		}

		res.writeHead(404);
		res.end("not found");
	});

	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(4890, "127.0.0.1", () => {
			resolve({
				close: () => new Promise((done) => server.close(done)),
				get token() {
					return capturedToken;
				},
			});
		});
	});
}

export async function runCurrentOAuthExample(ctx) {
	let chromium;
	try {
		({ chromium } = await import("@playwright/test"));
	} catch {
		skip("Playwright is not installed. Run npm install and npx playwright install chromium.");
	}

	const app = await startExampleApp(ctx);
	let browser;
	try {
		await step("redirect to frontend /oauth and log in there", async () => {
			try {
				browser = await chromium.launch({ headless: process.env.HEADLESS !== "false" });
			} catch (error) {
				skip(`Chromium is not installed or could not launch: ${error.message}`);
			}
			const page = await browser.newPage();
			await page.goto("http://127.0.0.1:4890/");
			await page.getByPlaceholder("Email").fill(ctx.users.manager.email);
			await page.getByPlaceholder("Password").fill(ctx.users.manager.password);
			await page.getByRole("button", { name: "Login" }).click();
			await page.waitForURL(/\/login\/callback\?token=/, { timeout: 20_000 });
			assert(app.token, "OAuth current example did not receive a token");
		});

		await step("use returned token with backend", async () => {
			const me = await requestJson(`${ctx.apiBaseUrl}/user/me`, { token: app.token });
			assert(me.data.email === ctx.users.manager.email, "returned OAuth token did not authenticate as manager");
		});
	} finally {
		if (browser) {
			await browser.close();
		}
		await app.close();
	}
}
