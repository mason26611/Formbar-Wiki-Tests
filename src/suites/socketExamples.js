import { assert, step } from "../utils/assert.js";
import { requestJson } from "../utils/http.js";
import { connectSocket, disconnectSockets, waitForSocketEvent } from "../utils/socket.js";

export async function runSocketExamples(ctx) {
	const { apiBaseUrl, users, shared } = ctx;
	const manager = users.manager;
	const student = users.student;
	let managerSocket;
	let studentSocket;

	try {
		await step("connect sockets with bearer tokens", async () => {
			managerSocket = await connectSocket(ctx, { token: manager.accessToken });
			studentSocket = await connectSocket(ctx, { token: student.accessToken });
			const [[managerClass], [studentClass]] = await Promise.all([
				waitForSocketEvent(managerSocket, "setClass"),
				waitForSocketEvent(studentSocket, "setClass"),
			]);
			assert(Number(managerClass) === shared.classId, "manager socket did not resolve active class");
			assert(Number(studentClass) === shared.classId, "student socket did not resolve active class");
		});

		await step("request class state updates", async () => {
			const classUpdatePromise = waitForSocketEvent(managerSocket, "classUpdate", 10_000, (payload) => payload && typeof payload === "object");
			managerSocket.emit("classUpdate");
			const [payload] = await classUpdatePromise;
			assert(payload.className || payload.name || payload.students, "classUpdate did not return classroom data");
		});

		await step("check active class and update settings", async () => {
			const activePromise = waitForSocketEvent(managerSocket, "isClassActive");
			managerSocket.emit("isClassActive");
			const [isActive] = await activePromise;
			assert(isActive === true, "isClassActive did not return true");

			const updatePromise = waitForSocketEvent(managerSocket, "classUpdate");
			managerSocket.emit("setClassSetting", { pogMeter: true });
			await updatePromise;
		});

		await step("create and update a socket poll", async () => {
			const started = waitForSocketEvent(managerSocket, "startPoll");
			managerSocket.emit("startPoll", {
				prompt: "Socket example poll",
				answers: ["A", "B"],
				allowTextResponses: true,
				allowVoteChanges: true,
			});
			await started;

			const responseUpdate = waitForSocketEvent(managerSocket, "classUpdate");
			studentSocket.emit("pollResp", ["A"], "socket answer");
			await responseUpdate;

			const cleared = waitForSocketEvent(managerSocket, "classUpdate");
			managerSocket.emit("updatePoll", { status: false });
			await cleared;
		});

		await step("use help and break socket events", async () => {
			const helpUpdate = waitForSocketEvent(managerSocket, "classUpdate");
			studentSocket.emit("help", "I need help");
			await helpUpdate;

			const breakUpdate = waitForSocketEvent(managerSocket, "classUpdate");
			studentSocket.emit("requestBreak");
			await breakUpdate;
		});

		await step("request owned classes", async () => {
			const ownedClasses = waitForSocketEvent(managerSocket, "getOwnedClasses");
			managerSocket.emit("getOwnedClasses", manager.email);
			const [classes] = await ownedClasses;
			assert(Array.isArray(classes), "getOwnedClasses did not return an array");
			assert(
				classes.some((classroom) => Number(classroom.id) === shared.classId),
				"created class was missing from owned classes"
			);
		});

		await step("save and share a custom poll", async () => {
			const customPoll = {
				name: "Wiki Saved Poll",
				prompt: "Saved poll prompt",
				answers: ["Yes", "No"],
				textRes: false,
				blind: false,
				allowVoteChanges: true,
				allowMultipleResponses: false,
				weight: 1,
				public: false,
			};

			const saved = waitForSocketEvent(managerSocket, "classPollSave");
			managerSocket.emit("classPoll", customPoll);
			const [pollId] = await saved;
			assert(Number(pollId) > 0, "classPoll did not emit a poll id");

			const userShare = waitForSocketEvent(managerSocket, "getPollShareIds");
			managerSocket.emit("sharePollToUser", pollId, student.email);
			const [userPollShares] = await userShare;
			assert(Array.isArray(userPollShares), "sharePollToUser did not refresh user poll shares");

			const classShare = waitForSocketEvent(managerSocket, "getPollShareIds");
			managerSocket.emit("sharePollToClass", pollId, shared.classId);
			const [, classPollShares] = await classShare;
			assert(Array.isArray(classPollShares), "sharePollToClass did not refresh class poll shares");
		});

		await step("use legacy auth event and observe deprecation", async () => {
			const legacySocket = await connectSocket(ctx);
			try {
				const warning = waitForSocketEvent(legacySocket, "deprecationWarning");
				legacySocket.emit("auth", { token: manager.accessToken });
				const [payload] = await warning;
				assert(payload?.event === "auth", "legacy auth warning did not identify auth event");
			} finally {
				await disconnectSockets(legacySocket);
			}
		});

		await step("connect a socket with an API key", async () => {
			if (!shared.managerApiKey) {
				const regenerated = await requestJson(`${apiBaseUrl}/user/${manager.id}/api/regenerate`, {
					method: "POST",
					token: manager.accessToken,
				});
				shared.managerApiKey = regenerated.data.apiKey;
			}
			const apiSocket = await connectSocket(ctx, { apiKey: shared.managerApiKey });
			try {
				const [[classId]] = await Promise.all([waitForSocketEvent(apiSocket, "setClass")]);
				assert(Number(classId) === shared.classId, "API socket did not resolve active class");
			} finally {
				await disconnectSockets(apiSocket);
			}
		});
	} finally {
		await disconnectSockets(managerSocket, studentSocket);
	}
}
