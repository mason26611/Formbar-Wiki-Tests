import { io } from "socket.io-client";

export async function connectSocket(ctx, { token, apiKey } = {}) {
	const extraHeaders = {};
	if (token) {
		extraHeaders.Authorization = `Bearer ${token}`;
	}
	if (apiKey) {
		extraHeaders.API = apiKey;
	}

	const socket = io(ctx.backendUrl, {
		transports: ["websocket"],
		extraHeaders,
		reconnection: false,
	});
	socket.__eventBuffer = new Map();
	for (const event of [
		"setClass",
		"classUpdate",
		"customPollUpdate",
		"classPollSave",
		"getPollShareIds",
		"getOwnedClasses",
		"startPoll",
		"isClassActive",
		"awardDigipogsResponse",
		"transferResponse",
		"deprecationWarning",
		"message",
	]) {
		socket.on(event, (...args) => {
			if (!socket.__eventBuffer.has(event)) {
				socket.__eventBuffer.set(event, []);
			}
			socket.__eventBuffer.get(event).push(args);
		});
	}

	await waitForSocketEvent(socket, "connect", 10_000);
	return socket;
}

export function waitForSocketEvent(socket, event, timeoutMs = 10_000, predicate = () => true) {
	const buffered = socket.__eventBuffer?.get(event) || [];
	const bufferedIndex = buffered.findIndex((args) => predicate(...args));
	if (bufferedIndex >= 0) {
		const [args] = buffered.splice(bufferedIndex, 1);
		return Promise.resolve(args);
	}

	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error(`Timed out waiting for socket event ${event}`));
		}, timeoutMs);

		function cleanup() {
			clearTimeout(timer);
			socket.off(event, handler);
		}

		function handler(...args) {
			try {
				if (!predicate(...args)) {
					return;
				}
				cleanup();
				resolve(args);
			} catch (error) {
				cleanup();
				reject(error);
			}
		}

		socket.on(event, handler);
	});
}

export async function disconnectSockets(...sockets) {
	for (const socket of sockets) {
		if (socket?.connected) {
			socket.disconnect();
		}
	}
}
