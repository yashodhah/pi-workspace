import { stat } from "node:fs/promises";
import { normalizeFolder } from "./paths.ts";
import { findMissing } from "./prompt.ts";
import {
	addFolder,
	listWorkspaces,
	loadWorkspace,
	removeFolder,
	saveWorkspace,
	validateName,
	type Workspace,
} from "./store.ts";

export interface WsUi {
	notify(msg: string, type?: "info" | "warning" | "error"): void;
	input(title: string, placeholder?: string): Promise<string | undefined>;
	select(title: string, options: string[]): Promise<string | undefined>;
	setStatus(key: string, text: string | undefined): void;
}

export interface WsDeps {
	ui: WsUi;
	dir?: string;
	home?: string;
	getCurrent(): Workspace | undefined;
	setCurrent(ws: Workspace | undefined): void;
	persist(name: string | undefined): void;
}

const USAGE = "Usage: /ws new <name> | add [path] | remove [path] | use <name> | list";
const NO_WORKSPACE = "No workspace attached. Use /ws new <name> or /ws use <name>";

export async function refreshStatus(ws: Workspace | undefined, ui: Pick<WsUi, "setStatus">): Promise<void> {
	if (!ws) return ui.setStatus("workspace", undefined);
	const missing = await findMissing(ws.folders);
	const extra = missing.size ? `, ${missing.size} missing` : "";
	ui.setStatus("workspace", `ws: ${ws.name} (${ws.folders.length} ${ws.folders.length === 1 ? "folder" : "folders"}${extra})`);
}

async function isDirectory(p: string): Promise<boolean> {
	try {
		return (await stat(p)).isDirectory();
	} catch {
		return false;
	}
}

async function attach(ws: Workspace, d: WsDeps): Promise<void> {
	d.setCurrent(ws);
	d.persist(ws.name);
	await refreshStatus(ws, d.ui);
}

async function save(ws: Workspace, d: WsDeps): Promise<void> {
	await saveWorkspace(ws, d.dir);
	d.setCurrent(ws);
	await refreshStatus(ws, d.ui);
}

export async function runWsCommand(args: string, d: WsDeps): Promise<void> {
	const [sub, ...rest] = args.trim().split(/\s+/).filter(Boolean);
	const arg = rest.join(" ");
	try {
		switch (sub) {
			case "new": {
				validateName(arg);
				if (await loadWorkspace(arg, d.dir)) return d.ui.notify(`Workspace "${arg}" already exists`, "warning");
				const ws: Workspace = { name: arg, folders: [] };
				await saveWorkspace(ws, d.dir);
				await attach(ws, d);
				return d.ui.notify(`Created workspace "${arg}". Use /ws add to add folders.`, "info");
			}
			case "use": {
				const ws = await loadWorkspace(arg, d.dir);
				if (!ws) return d.ui.notify(`Workspace "${arg}" not found`, "warning");
				await attach(ws, d);
				return d.ui.notify(`Attached workspace "${arg}"`, "info");
			}
			case "list": {
				const names = await listWorkspaces(d.dir);
				return d.ui.notify(names.length ? `Workspaces: ${names.join(", ")}` : "No workspaces yet", "info");
			}
			case "add": {
				const ws = d.getCurrent();
				if (!ws) return d.ui.notify(NO_WORKSPACE, "warning");
				const raw = arg || (await d.ui.input("Folder to add", "/path/to/folder"));
				if (!raw) return;
				const folder = normalizeFolder(raw, d.home);
				if (!(await isDirectory(folder))) return d.ui.notify(`${folder} is not an existing directory`, "error");
				await save(addFolder(ws, folder), d);
				return d.ui.notify(`Added ${folder}`, "info");
			}
			case "remove": {
				const ws = d.getCurrent();
				if (!ws) return d.ui.notify(NO_WORKSPACE, "warning");
				const raw = arg || (await d.ui.select("Folder to remove", ws.folders));
				if (!raw) return;
				const folder = normalizeFolder(raw, d.home);
				await save(removeFolder(ws, folder), d);
				return d.ui.notify(`Removed ${folder}`, "info");
			}
			default:
				return d.ui.notify(USAGE, "info");
		}
	} catch (e) {
		d.ui.notify((e as Error).message, "error");
	}
}
