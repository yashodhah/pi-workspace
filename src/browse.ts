import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const MAX_ENTRIES = 200;
export const ADD = "✓ Add this folder";
export const ADD_EXISTING = "✓ Add this folder (already added)";
export const UP = ".. (up one level)";
export const HOME = "~ (home)";
export const TYPE = "⌨ Type a path…";
export const CANCEL = "✗ Cancel";
const moreLabel = (n: number) => `… ${n} more, use Type a path`;

export interface BrowseUi {
	select(title: string, options: string[]): Promise<string | undefined>;
	input(title: string, placeholder?: string): Promise<string | undefined>;
	notify(msg: string, type?: "info" | "warning" | "error"): void;
}

export interface Listing {
	names: string[];
	more: number;
}

async function isDirectory(parent: string, e: Dirent): Promise<boolean> {
	if (e.isDirectory()) return true;
	if (!e.isSymbolicLink()) return false;
	try {
		return (await stat(join(parent, e.name))).isDirectory();
	} catch {
		return false;
	}
}

export async function listSubfolders(dir: string): Promise<Listing> {
	const entries = await readdir(dir, { withFileTypes: true });
	const names: string[] = [];
	for (const e of entries) {
		if (e.name.startsWith(".") || e.name === "node_modules") continue;
		if (await isDirectory(dir, e)) names.push(e.name);
	}
	names.sort();
	return { names: names.slice(0, MAX_ENTRIES), more: Math.max(0, names.length - MAX_ENTRIES) };
}

export async function browseForFolder(
	ui: BrowseUi,
	startDir: string,
	existing: readonly string[],
	home: string = homedir(),
): Promise<string | undefined> {
	let dir = startDir;
	let prev: string | undefined;
	for (;;) {
		let listing: Listing;
		try {
			listing = await listSubfolders(dir);
		} catch (e) {
			ui.notify(`Cannot read ${dir}: ${(e as Error).message}`, "warning");
			if (prev === undefined) return undefined;
			dir = prev;
			prev = undefined;
			continue;
		}
		const subs = new Map(listing.names.map((n) => [`${n}/`, n]));
		const isMember = existing.includes(dir);
		const options = [
			isMember ? ADD_EXISTING : ADD,
			...(dirname(dir) !== dir ? [UP] : []),
			HOME,
			TYPE,
			CANCEL,
			...subs.keys(),
			...(listing.more > 0 ? [moreLabel(listing.more)] : []),
		];
		const choice = await ui.select(`Add folder: ${dir}`, options);
		if (choice === undefined || choice === CANCEL) return undefined;
		if (choice === ADD || choice === ADD_EXISTING) {
			if (isMember) {
				ui.notify(`${dir} is already in the workspace`, "info");
				return undefined;
			}
			return dir;
		}
		if (choice === TYPE) return (await ui.input("Folder to add", "/path/to/folder")) || undefined;
		if (choice === UP) {
			prev = dir;
			dir = dirname(dir);
		} else if (choice === HOME) {
			prev = dir;
			dir = home;
		} else {
			const sub = subs.get(choice);
			if (sub !== undefined) {
				prev = dir;
				dir = join(dir, sub);
			}
			// the "… N more" line (or any unrecognised choice) redisplays this directory
		}
	}
}
