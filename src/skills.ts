import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { cwdRole } from "./paths.ts";

export const SKILL_DIRS = [".pi/skills", ".claude/skills", ".github/skills"] as const;

async function isDir(p: string): Promise<boolean> {
	try {
		return (await stat(p)).isDirectory();
	} catch {
		return false;
	}
}

function cwdFirst(folders: string[], cwd: string): string[] {
	const role = cwdRole(folders, cwd);
	if (role.kind === "outside") return folders;
	return [role.folder, ...folders.filter((f) => f !== role.folder)];
}

export async function discoverSkillPaths(folders: string[], cwd: string): Promise<string[]> {
	const out: string[] = [];
	for (const folder of cwdFirst(folders, cwd)) {
		for (const rel of SKILL_DIRS) {
			const p = join(folder, rel);
			if (await isDir(p)) out.push(p);
		}
	}
	return out;
}

export async function findSkillClashes(paths: string[]): Promise<string[]> {
	const owners = new Map<string, string[]>();
	for (const p of paths) {
		let names: string[] = [];
		try {
			names = (await readdir(p, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
		} catch {
			continue;
		}
		for (const n of names) owners.set(n, [...(owners.get(n) ?? []), p]);
	}
	return [...owners.entries()]
		.filter(([, where]) => where.length > 1)
		.map(([name, where]) => `Skill "${name}" is defined in ${where.join(" and ")}; the first path wins`);
}
