import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { dedupe, normalizeFolder } from "./paths.ts";

export interface Workspace {
	name: string;
	folders: string[];
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function workspacesDir(home: string = homedir()): string {
	return join(home, ".pi", "workspaces");
}

export function validateName(name: string): void {
	if (!NAME.test(name)) {
		throw new Error(`Invalid workspace name "${name}": use letters, digits, - and _ (max 64, no leading -)`);
	}
}

function isWorkspace(v: unknown, name: string): v is Workspace {
	const o = v as Workspace;
	return (
		!!o &&
		typeof o === "object" &&
		o.name === name &&
		Array.isArray(o.folders) &&
		o.folders.every((f) => typeof f === "string")
	);
}

export async function loadWorkspace(name: string, dir: string = workspacesDir()): Promise<Workspace | undefined> {
	validateName(name);
	const file = join(dir, `${name}.json`);
	let text: string;
	try {
		text = await readFile(file, "utf-8");
	} catch (e: any) {
		if (e?.code === "ENOENT") return undefined;
		throw e;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new Error(`Invalid workspace file: ${file}`);
	}
	if (!isWorkspace(parsed, name)) throw new Error(`Invalid workspace file: ${file}`);
	return parsed;
}

export async function saveWorkspace(ws: Workspace, dir: string = workspacesDir()): Promise<void> {
	validateName(ws.name);
	await mkdir(dir, { recursive: true });
	const file = join(dir, `${ws.name}.json`);
	const tmp = `${file}.tmp`;
	await writeFile(tmp, `${JSON.stringify({ name: ws.name, folders: ws.folders }, null, 2)}\n`);
	await rename(tmp, file);
}

export async function listWorkspaces(dir: string = workspacesDir()): Promise<string[]> {
	try {
		const names = await readdir(dir);
		return names
			.filter((n) => n.endsWith(".json"))
			.map((n) => n.slice(0, -".json".length))
			.sort();
	} catch (e: any) {
		if (e?.code === "ENOENT") return [];
		throw e;
	}
}

export function addFolder(ws: Workspace, folder: string): Workspace {
	return { ...ws, folders: dedupe([...ws.folders, normalizeFolder(folder)]) };
}

export function removeFolder(ws: Workspace, folder: string): Workspace {
	const target = normalizeFolder(folder);
	return { ...ws, folders: ws.folders.filter((f) => f !== target) };
}
