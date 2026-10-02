import {
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { refreshStatus, runWsCommand } from "../src/commands.ts";
import { fanOutTool } from "../src/fanout.ts";
import { buildWorkspaceBlock, collectContextFiles, findMissing } from "../src/prompt.ts";
import { discoverSkillPaths, findSkillClashes } from "../src/skills.ts";
import { loadWorkspace, saveWorkspace, type Workspace } from "../src/store.ts";

export const ENTRY_TYPE = "pi-workspace";
const SUBCOMMANDS = ["new", "add", "remove", "use", "list"];

function restoreFromBranch(branch: any[]): string | undefined {
	for (let i = branch.length - 1; i >= 0; i--) {
		const e = branch[i];
		if (e?.type === "custom" && e.customType === ENTRY_TYPE) return e.data?.name ?? undefined;
	}
	return undefined;
}

export default function (pi: ExtensionAPI) {
	let current: Workspace | undefined;
	let clashesReported = false;

	pi.registerFlag("workspace", { type: "string", description: "Attach a saved workspace by name" });

	const folders = () => current?.folders ?? [];
	pi.registerTool(fanOutTool(createGrepToolDefinition, folders));
	pi.registerTool(fanOutTool(createFindToolDefinition, folders));
	pi.registerTool(fanOutTool(createLsToolDefinition, folders));

	pi.registerCommand("ws", {
		description: "Manage workspaces: new | add | remove | use | list",
		getArgumentCompletions: (prefix) => {
			const items = SUBCOMMANDS.filter((s) => s.startsWith(prefix)).map((s) => ({ value: s, label: s }));
			return items.length ? items : null;
		},
		handler: async (args, ctx) => {
			clashesReported = false;
			await runWsCommand(args, {
				ui: ctx.ui,
				getCurrent: () => current,
				setCurrent: (ws) => void (current = ws),
				persist: (name) => pi.appendEntry(ENTRY_TYPE, { name: name ?? null }),
			});
		},
	});

	pi.on("session_start", async (event, ctx) => {
		const rawFlag = pi.getFlag("workspace");
		const flag = typeof rawFlag === "string" && rawFlag ? rawFlag : undefined;
		const saved = restoreFromBranch(ctx.sessionManager.getBranch());
		// On reload the latest /ws choice beats the startup flag; otherwise the flag wins.
		const name = event.reason === "reload" ? (saved ?? flag) : (flag ?? saved);
		current = undefined;
		clashesReported = false;
		if (name) {
			try {
				current = await loadWorkspace(name);
			} catch (e) {
				ctx.ui.notify((e as Error).message, "error");
			}
			if (!current) {
				if (ctx.hasUI && (await ctx.ui.confirm("Workspace not found", `Create workspace "${name}"?`))) {
					current = { name, folders: [] };
					await saveWorkspace(current);
					pi.appendEntry(ENTRY_TYPE, { name });
					ctx.ui.notify(`Created workspace "${name}". Use /ws add to add folders.`, "info");
				} else {
					ctx.ui.notify(`Workspace "${name}" not found; continuing without a workspace`, "warning");
				}
			} else {
				pi.appendEntry(ENTRY_TYPE, { name });
			}
		}
		await refreshStatus(current, ctx.ui);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (!current) return;
		const missing = await findMissing(current.folders);
		const live = current.folders.filter((f) => !missing.has(f));
		const opts = event.systemPromptOptions;
		opts.sections.workspace = buildWorkspaceBlock(current, ctx.cwd, missing);
		opts.contextFiles.push(...(await collectContextFiles(live, opts.contextFiles)));
	});

	pi.on("resources_discover", async (event, ctx) => {
		if (!current) return;
		const missing = await findMissing(current.folders);
		const skillPaths = await discoverSkillPaths(
			current.folders.filter((f) => !missing.has(f)),
			event.cwd,
		);
		if (!clashesReported) {
			clashesReported = true;
			for (const line of await findSkillClashes(skillPaths)) ctx.ui.notify(line, "warning");
		}
		return { skillPaths };
	});
}
