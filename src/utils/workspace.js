import fs from "node:fs";
import path from "node:path";

function toPosix(relativePath) {
	return relativePath.split(path.sep).join("/");
}

export async function copyRepo(source, destination, { excludeNames = new Set(), excludeRelative = new Set() } = {}) {
	fs.rmSync(destination, { recursive: true, force: true });
	fs.mkdirSync(destination, { recursive: true });

	await fs.promises.cp(source, destination, {
		recursive: true,
		force: true,
		filter: (src) => {
			const name = path.basename(src);
			if (excludeNames.has(name)) {
				return false;
			}
			const rel = toPosix(path.relative(source, src));
			if (excludeRelative.has(rel)) {
				return false;
			}
			if (rel.startsWith("database/database-") && rel.endsWith(".bak")) {
				return false;
			}
			return true;
		},
	});
}

export function writeBackendEnv(repoPath, { port, frontendUrl }) {
	const envPath = path.join(repoPath, ".env");
	const content = [
		`PORT=${port}`,
		"ENABLE_CORS=true",
		"EMAIL_ENABLED=false",
		"WHITELIST_ENABLED=false",
		"BLACKLIST_ENABLED=false",
		"RATE_LIMIT_MULTIPLIER=50",
		`FRONTEND_URL=${frontendUrl}`,
		"",
	].join("\n");
	fs.writeFileSync(envPath, content, "utf8");
}

export function writeClientEnv(repoPath, { apiUrl, clientUrl }) {
	const envPath = path.join(repoPath, ".env");
	const content = [
		`VITE_FORMBAR_API_URL=${apiUrl}`,
		`VITE_FORMBAR_CLIENT_URL=${clientUrl}`,
		"VITE_ENCRYPTION_KEY=formbar-wiki-example-tests",
		"",
	].join("\n");
	fs.writeFileSync(envPath, content, "utf8");
}
