export function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

export function skip(message) {
	const error = new Error(message);
	error.skip = true;
	throw error;
}

export async function step(name, fn) {
	process.stdout.write(`  - ${name}... `);
	const result = await fn();
	console.log("ok");
	return result;
}
