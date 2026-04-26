import { assert, step } from "../utils/assert.js";
import { requestJson } from "../utils/http.js";

export async function runHttpExamples(ctx) {
	const { apiBaseUrl, users } = ctx;
	const manager = users.manager;
	const student = users.student;

	await step("log in with email and password", async () => {
		const login = await requestJson(`${apiBaseUrl}/auth/login`, {
			method: "POST",
			body: { email: manager.email, password: manager.password },
		});
		assert(login.data.accessToken, "login did not return accessToken");
		assert(login.data.refreshToken, "login did not return refreshToken");
	});

	await step("read current user with bearer token", async () => {
		const me = await requestJson(`${apiBaseUrl}/user/me`, { token: manager.accessToken });
		assert(me.data.email === manager.email, "user/me returned the wrong manager email");
	});

	await step("create, join, enroll, and start a class", async () => {
		const created = await requestJson(`${apiBaseUrl}/class/create`, {
			method: "POST",
			token: manager.accessToken,
			body: { name: "Wiki Example Class" },
		});
		const classId = Number(created.data.classId);
		assert(classId > 0, "class/create did not return classId");
		assert(created.data.key, "class/create did not return class key");

		await requestJson(`${apiBaseUrl}/class/${classId}/join`, { method: "POST", token: manager.accessToken, allowStatuses: [400] });
		await requestJson(`${apiBaseUrl}/class/enroll/${created.data.key}`, { method: "POST", token: student.accessToken });
		await requestJson(`${apiBaseUrl}/class/${classId}/join`, { method: "POST", token: student.accessToken, allowStatuses: [400] });
		await requestJson(`${apiBaseUrl}/class/${classId}/start`, { method: "POST", token: manager.accessToken });

		ctx.shared.classId = classId;
		ctx.shared.classKey = created.data.key;
	});

	await step("create a poll and submit a response", async () => {
		await requestJson(`${apiBaseUrl}/class/${ctx.shared.classId}/polls/create`, {
			method: "POST",
			token: manager.accessToken,
			body: {
				prompt: "What is 2 + 2?",
				answers: ["3", "4", "5"],
				allowTextResponses: true,
			},
		});
		await requestJson(`${apiBaseUrl}/class/${ctx.shared.classId}/polls/response`, {
			method: "POST",
			token: manager.accessToken,
			body: { response: ["4"], textRes: "owner response" },
		});
		const current = await requestJson(`${apiBaseUrl}/class/${ctx.shared.classId}/polls/current`, { token: manager.accessToken });
		assert(current.data.prompt === "What is 2 + 2?", "current poll prompt did not match");
	});

	await step("start and read a timer", async () => {
		await requestJson(`${apiBaseUrl}/class/${ctx.shared.classId}/timer/start`, {
			method: "POST",
			token: manager.accessToken,
			body: { duration: 60_000, sound: false },
		});
		const timer = await requestJson(`${apiBaseUrl}/class/${ctx.shared.classId}/timer`, { token: manager.accessToken });
		assert(timer.data?.timer?.active === true, "timer was not active");
	});

	await step("register an app and use future OAuth endpoints", async () => {
		const redirectUri = "http://127.0.0.1:4888/oauth/callback";
		const app = await requestJson(`${apiBaseUrl}/apps/register`, {
			method: "POST",
			token: manager.accessToken,
			body: {
				name: "Wiki OAuth Example",
				description: "Verifies the wiki OAuth example",
				redirectUris: [redirectUri],
			},
		});
		assert(app.data.appId, "app registration did not return appId");
		assert(app.data.apiSecret, "app registration did not return apiSecret");

		const authorizeUrl = new URL(`${apiBaseUrl}/oauth/authorize`);
		authorizeUrl.searchParams.set("response_type", "code");
		authorizeUrl.searchParams.set("client_id", String(app.data.appId));
		authorizeUrl.searchParams.set("redirect_uri", redirectUri);
		authorizeUrl.searchParams.set("scope", "read");
		authorizeUrl.searchParams.set("state", "wiki-state");

		const authResponse = await fetch(authorizeUrl, {
			redirect: "manual",
			headers: { Authorization: `Bearer ${manager.accessToken}` },
		});
		assert(authResponse.status === 302, `authorize returned ${authResponse.status}`);
		const callback = new URL(authResponse.headers.get("location"));
		assert(callback.searchParams.get("state") === "wiki-state", "OAuth state was not returned");
		const code = callback.searchParams.get("code");
		assert(code, "OAuth authorize did not return a code");

		const token = await requestJson(`${apiBaseUrl}/oauth/token`, {
			method: "POST",
			body: {
				grant_type: "authorization_code",
				code,
				redirect_uri: redirectUri,
				client_id: String(app.data.appId),
				client_secret: app.data.apiSecret,
			},
		});
		assert(token.data.access_token, "OAuth token exchange did not return access_token");
		assert(token.data.refresh_token, "OAuth token exchange did not return refresh_token");

		const refreshed = await requestJson(`${apiBaseUrl}/oauth/token`, {
			method: "POST",
			body: {
				grant_type: "refresh_token",
				refresh_token: token.data.refresh_token,
			},
		});
		assert(refreshed.data.access_token, "OAuth refresh did not return access_token");

		await requestJson(`${apiBaseUrl}/oauth/revoke`, {
			method: "POST",
			body: { token: refreshed.data.refresh_token, token_type_hint: "refresh_token" },
		});
	});

	await step("read certs and authenticate with an API key", async () => {
		const certs = await requestJson(`${apiBaseUrl}/certs`);
		assert(certs.data?.publicKey || certs.data?.keys || certs.data, "certs response was empty");

		const regenerated = await requestJson(`${apiBaseUrl}/user/${manager.id}/api/regenerate`, {
			method: "POST",
			token: manager.accessToken,
		});
		assert(regenerated.data.apiKey, "API key regenerate did not return apiKey");
		const me = await requestJson(`${apiBaseUrl}/user/me`, { apiKey: regenerated.data.apiKey });
		assert(me.data.email === manager.email, "API-key user/me returned the wrong email");
		ctx.shared.managerApiKey = regenerated.data.apiKey;
	});
}
