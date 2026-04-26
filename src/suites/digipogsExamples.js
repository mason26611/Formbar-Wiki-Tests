import { assert, step } from "../utils/assert.js";
import { setTimeout as delay } from "node:timers/promises";
import { requestJson } from "../utils/http.js";
import { connectSocket, disconnectSockets, waitForSocketEvent } from "../utils/socket.js";

export async function runDigipogsExamples(ctx) {
	const { apiBaseUrl, users, shared } = ctx;
	const manager = users.manager;
	const student = users.student;

	await step("set the student's PIN", async () => {
		await requestJson(`${apiBaseUrl}/user/${student.id}/pin`, {
			method: "PATCH",
			token: student.accessToken,
			body: { pin: "1234" },
		});
	});

	await step("award digipogs over HTTP", async () => {
		const award = await requestJson(`${apiBaseUrl}/digipogs/award`, {
			method: "POST",
			token: manager.accessToken,
			body: {
				to: { id: student.id, type: "user" },
				amount: 50,
			},
		});
		assert(award.data.success === true, "digipog award was not successful");
	});

	await step("transfer digipogs over HTTP", async () => {
		const transfer = await requestJson(`${apiBaseUrl}/digipogs/transfer`, {
			method: "POST",
			body: {
				from: { id: student.id, type: "user" },
				to: { id: manager.id, type: "user" },
				amount: 5,
				pin: "1234",
				reason: "Wiki example transfer",
			},
		});
		assert(transfer.data.success === true, "digipog transfer was not successful");
	});

	await step("create a pool, add a member, fund it, and pay it out", async () => {
		const pool = await requestJson(`${apiBaseUrl}/pools/create`, {
			method: "POST",
			token: manager.accessToken,
			body: { name: "Wiki Example Pool", description: "Pool for wiki example tests" },
		});
		assert(pool.data.poolId, "pool create did not return poolId");

		await requestJson(`${apiBaseUrl}/pools/${pool.data.poolId}/add-member`, {
			method: "POST",
			token: manager.accessToken,
			body: { userId: student.id },
		});

		await delay(650);
		await requestJson(`${apiBaseUrl}/digipogs/award`, {
			method: "POST",
			token: manager.accessToken,
			body: {
				to: { id: pool.data.poolId, type: "pool" },
				amount: 20,
			},
		});

		const payout = await requestJson(`${apiBaseUrl}/pools/${pool.data.poolId}/payout`, {
			method: "POST",
			token: manager.accessToken,
		});
		assert(payout.data.success === true, "pool payout was not successful");
		shared.poolId = pool.data.poolId;
	});

	await step("read user transactions", async () => {
		const transactions = await requestJson(`${apiBaseUrl}/user/${student.id}/transactions`, {
			token: student.accessToken,
		});
		assert(Array.isArray(transactions.data.transactions), "transactions did not return an array");
	});

	await step("award and transfer digipogs over sockets", async () => {
		const managerSocket = await connectSocket(ctx, { token: manager.accessToken });
		const studentSocket = await connectSocket(ctx, { token: student.accessToken });
		try {
			await Promise.all([waitForSocketEvent(managerSocket, "setClass"), waitForSocketEvent(studentSocket, "setClass")]);

			const awardResponse = waitForSocketEvent(managerSocket, "awardDigipogsResponse");
			await delay(650);
			managerSocket.emit("awardDigipogs", {
				to: { id: student.id, type: "user" },
				amount: 10,
			});
			const [award] = await awardResponse;
			assert(award.success === true, "socket digipog award was not successful");

			const transferResponse = waitForSocketEvent(studentSocket, "transferResponse");
			studentSocket.emit("transferDigipogs", {
				from: { id: student.id, type: "user" },
				to: { id: manager.id, type: "user" },
				amount: 1,
				pin: "1234",
				reason: "Socket wiki example transfer",
			});
			const [transfer] = await transferResponse;
			assert(transfer.success === true, "socket digipog transfer was not successful");
		} finally {
			await disconnectSockets(managerSocket, studentSocket);
		}
	});
}
