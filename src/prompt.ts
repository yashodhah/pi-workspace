import { stat } from "node:fs/promises";
import { type ContextFile, loadFolderInstructions } from "./instructions.ts";
import { cwdRole } from "./paths.ts";
import type { Workspace } from "./store.ts";

export const MULTI_ROOT_HINT =
	"This is a multi-folder workspace. Apply each folder's instructions to files inside that folder.";

export function buildWorkspaceBlock(ws: Workspace, cwd: string, missing: ReadonlySet<string>): string {
	const role = cwdRole(ws.folders, cwd);
	const lines = ws.folders.map((f) => {
		const tags: string[] = [];
		if (role.kind === "member" && role.folder === f) tags.push("session cwd");
		if (missing.has(f)) tags.push("missing, skipped");
		return `- ${f}${tags.length ? ` (${tags.join(", ")})` : ""}`;
	});
	const out = [`Workspace "${ws.name}" has these folders:`, ...lines];
	if (role.kind === "inside") out.push(`Session cwd: ${cwd} (inside ${role.folder})`);
	if (role.kind === "outside") out.push(`Session cwd (not in workspace): ${cwd}`);
	out.push(
		"Relative paths and bash use the session cwd. Use an absolute path to read a file in any workspace folder; " +
			"grep, find and ls search every folder when given a relative path.",
	);
	out.push(MULTI_ROOT_HINT);
	return out.join("\n");
}

export async function findMissing(folders: string[]): Promise<Set<string>> {
	const missing = new Set<string>();
	await Promise.all(
		folders.map(async (f) => {
			try {
				if (!(await stat(f)).isDirectory()) missing.add(f);
			} catch {
				missing.add(f);
			}
		}),
	);
	return missing;
}

export async function collectContextFiles(
	folders: string[],
	existing: ReadonlyArray<{ path: string }>,
): Promise<ContextFile[]> {
	const seen = new Set(existing.map((e) => e.path));
	const out: ContextFile[] = [];
	for (const folder of folders) {
		const file = await loadFolderInstructions(folder);
		if (file && !seen.has(file.path)) {
			seen.add(file.path);
			out.push(file);
		}
	}
	return out;
}
