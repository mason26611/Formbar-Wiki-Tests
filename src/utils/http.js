import { setTimeout as delay } from "node:timers/promises";
import { assert } from "./assert.js";

export async function requestJson(url, { method = "GET", token, apiKey, headers = {}, body, redirect = "follow", allowStatuses = [] } = {}) {
	const requestHeaders = {
		Accept: "application/json",
		...headers,
	};
	if (body !== undefined) {
		requestHeaders["Content-Type"] = "application/json";
	}
	if (token) {
		requestHeaders.Authorization = `Bearer ${token}`;
	}
	if (apiKey) {
		requestHeaders.API = apiKey;
	}

	const response = await fetch(url, {
		method,
		redirect,
		headers: requestHeaders,
		body: body === undefined ? undefined : JSON.stringify(body),
	});

	const text = await response.text();
	const payload = text ? JSON.parse(text) : {};
	if (!response.ok && !allowStatuses.includes(response.status)) {
		throw new Error(`${method} ${url} returned ${response.status}: ${text}`);
	}
	if (response.ok && payload && Object.hasOwn(payload, "success")) {
		assert(payload.success === true, `${method} ${url} returned success=false: ${text}`);
	}
	return payload;
}

export async function waitForHttp(url, timeoutMs = 30_000) {
	const started = Date.now();
	let lastError;
	while (Date.now() - started < timeoutMs) {
		try {
			const response = await fetch(url);
			if (response.ok) {
				return;
			}
			lastError = new Error(`${url} returned ${response.status}`);
		} catch (error) {
			lastError = error;
		}
		await delay(500);
	}
	throw new Error(`Timed out waiting for ${url}: ${lastError?.message || "no response"}`);
}

export function bearer(token) {
	return { Authorization: `Bearer ${token}` };
}
