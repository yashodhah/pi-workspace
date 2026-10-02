import { homedir } from "node:os";
import { resolve, sep } from "node:path";

export type CwdRole = { kind: "member"; folder: string } | { kind: "inside"; folder: string } | { kind: "outside" };

export function normalizeFolder(input: string, home: string = homedir()): string {
	const expanded = input === "~" ? home : input.startsWith("~/") ? home + input.slice(1) : input;
	return resolve(expanded);
}

export function dedupe(paths: string[]): string[] {
	return [...new Set(paths)];
}

export function cwdRole(folders: string[], cwd: string): CwdRole {
	const exact = folders.find((f) => f === cwd);
	if (exact) return { kind: "member", folder: exact };
	const inside = folders.find((f) => cwd.startsWith(f.endsWith(sep) ? f : f + sep));
	if (inside) return { kind: "inside", folder: inside };
	return { kind: "outside" };
}
