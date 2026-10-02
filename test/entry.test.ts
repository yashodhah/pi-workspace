import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import extension from "../extensions/workspace.ts";
import { saveWorkspace, workspacesDir } from "../src/store.ts";

function fakePi(flag?: string) {
	const handlers: Record<string, Function> = {};
	const commands: Record<string, any> = {};
	const tools: any[] = [];
	const entries: any[] = [];
	const sent: unknown[] = [];
	const pi: any = {
		registerFlag: () => {},
		getFlag: () => flag,
		registerCommand: (n: string, o: any) => void (commands[n] = o),
		registerTool: (t: any) => void tools.push(t),
		on: (e: string, h: Function) => void (handlers[e] = h),
		appendEntry: (type: string, data: unknown) => void entries.push({ type: "custom", customType: type, data }),
		sendMessage: (m: unknown) => void sent.push(m),
		sendUserMessage: (m: unknown) => void sent.push(m),
	};
	return { pi, handlers, commands, tools, entries, sent };
}

function fakeCtx(cwd: string, branch: any[] = []) {
	const statuses: any[] = [];
	const notes: string[] = [];
	return {
		statuses,
		notes,
		ctx: {
			cwd,
			hasUI: true,
			sessionManager: { getBranch: () => branch },
			ui: {
				setStatus: (k: string, t: any) => void statuses.push([k, t]),
				notify: (m: string) => void notes.push(m),
				confirm: async () => false,
				input: async () => undefined,
				select: async () => undefined,
			},
		} as any,
	};
}

async function withHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
	const home = await mkdtemp(join(tmpdir(), "ws-home-"));
	const prev = process.env.HOME;
	process.env.HOME = home;
	try {
		return await fn(home);
	} finally {
		process.env.HOME = prev;
	}
}

describe("workspace extension", () => {
	it("registers /ws, the grep/find/ls overrides", () => {
		const { pi, commands, tools } = fakePi();
		extension(pi);
		expect(commands.ws).toBeDefined();
		expect(tools.map((t) => t.name).sort()).toEqual(["find", "grep", "ls"]);
	});

	it("injects the workspace block and instruction files, once, across repeated turns", async () => {
		await withHome(async (home) => {
			const folder = await mkdtemp(join(tmpdir(), "ws-f-"));
			await writeFile(join(folder, "AGENTS.md"), "rules for f");
			await saveWorkspace({ name: "demo", folders: [folder] }, workspacesDir(home));
			const { pi, handlers } = fakePi("demo");
			extension(pi);
			const { ctx } = fakeCtx(folder);
			await handlers.session_start({ type: "session_start" }, ctx);
			const event: any = { systemPromptOptions: { sections: {}, contextFiles: [] } };
			await handlers.before_agent_start(event, ctx);
			await handlers.before_agent_start(event, ctx);
			expect(event.systemPromptOptions.sections.workspace).toContain(folder);
			expect(event.systemPromptOptions.contextFiles).toEqual([
				{ path: join(folder, "AGENTS.md"), content: "rules for f" },
			]);
		});
	});

	it("does nothing when no workspace is attached", async () => {
		await withHome(async () => {
			const { pi, handlers } = fakePi(undefined);
			extension(pi);
			const { ctx } = fakeCtx("/x");
			await handlers.session_start({ type: "session_start" }, ctx);
			const event: any = { systemPromptOptions: { sections: {}, contextFiles: [] } };
			await handlers.before_agent_start(event, ctx);
			expect(event.systemPromptOptions.sections.workspace).toBeUndefined();
		});
	});

	it("restores the workspace from the last saved custom entry", async () => {
		await withHome(async (home) => {
			const folder = await mkdtemp(join(tmpdir(), "ws-r-"));
			await saveWorkspace({ name: "kept", folders: [folder] }, workspacesDir(home));
			const { pi, handlers } = fakePi(undefined);
			extension(pi);
			const branch = [{ type: "custom", customType: "pi-workspace", data: { name: "kept" } }];
			const { ctx } = fakeCtx(folder, branch);
			await handlers.session_start({ type: "session_start" }, ctx);
			const event: any = { systemPromptOptions: { sections: {}, contextFiles: [] } };
			await handlers.before_agent_start(event, ctx);
			expect(event.systemPromptOptions.sections.workspace).toContain("kept");
		});
	});

	it("warns and continues when --workspace names a missing workspace and there is no UI", async () => {
		await withHome(async () => {
			const { pi, handlers } = fakePi("ghost");
			extension(pi);
			const { ctx, notes } = fakeCtx("/x");
			ctx.hasUI = false;
			await handlers.session_start({ type: "session_start" }, ctx);
			expect(notes.join("\n")).toMatch(/ghost.*not found/);
			const event: any = { systemPromptOptions: { sections: {}, contextFiles: [] } };
			await handlers.before_agent_start(event, ctx);
			expect(event.systemPromptOptions.sections.workspace).toBeUndefined();
		});
	});

	it("returns skill paths from existing folders on resources_discover", async () => {
		await withHome(async (home) => {
			const folder = await mkdtemp(join(tmpdir(), "ws-s-"));
			await mkdir(join(folder, ".pi", "skills"), { recursive: true });
			await saveWorkspace({ name: "demo", folders: [folder] }, workspacesDir(home));
			const { pi, handlers } = fakePi("demo");
			extension(pi);
			const { ctx } = fakeCtx(folder);
			await handlers.session_start({ type: "session_start" }, ctx);
			const r = await handlers.resources_discover({ type: "resources_discover", cwd: folder, reason: "startup" }, ctx);
			expect(r.skillPaths).toEqual([join(folder, ".pi", "skills")]);
		});
	});

	it("skips a folder deleted after it was added, keeping the others working", async () => {
		await withHome(async (home) => {
			const gone = await mkdtemp(join(tmpdir(), "ws-gone-"));
			const live = await mkdtemp(join(tmpdir(), "ws-live-"));
			await writeFile(join(gone, "AGENTS.md"), "rules for gone");
			await writeFile(join(live, "AGENTS.md"), "rules for live");
			await mkdir(join(live, ".pi", "skills"), { recursive: true });
			await saveWorkspace({ name: "demo", folders: [gone, live] }, workspacesDir(home));
			await rm(gone, { recursive: true });
			const { pi, handlers } = fakePi("demo");
			extension(pi);
			const { ctx } = fakeCtx(live);
			await handlers.session_start({ type: "session_start" }, ctx);
			const event: any = { systemPromptOptions: { sections: {}, contextFiles: [] } };
			await handlers.before_agent_start(event, ctx);
			expect(event.systemPromptOptions.contextFiles).toEqual([
				{ path: join(live, "AGENTS.md"), content: "rules for live" },
			]);
			const r = await handlers.resources_discover({ type: "resources_discover", cwd: live, reason: "startup" }, ctx);
			expect(r.skillPaths).toEqual([join(live, ".pi", "skills")]);
		});
	});

	it("on reload the latest saved entry wins over --workspace", async () => {
		await withHome(async (home) => {
			const a = await mkdtemp(join(tmpdir(), "ws-a-"));
			const b = await mkdtemp(join(tmpdir(), "ws-b-"));
			await saveWorkspace({ name: "fromflag", folders: [a] }, workspacesDir(home));
			await saveWorkspace({ name: "other", folders: [b] }, workspacesDir(home));
			const branch = [{ type: "custom", customType: "pi-workspace", data: { name: "other" } }];
			const { pi, handlers } = fakePi("fromflag");
			extension(pi);
			const { ctx } = fakeCtx(a, branch);
			await handlers.session_start({ type: "session_start", reason: "reload" }, ctx);
			const event: any = { systemPromptOptions: { sections: {}, contextFiles: [] } };
			await handlers.before_agent_start(event, ctx);
			expect(event.systemPromptOptions.sections.workspace).toContain("other");
			expect(event.systemPromptOptions.sections.workspace).not.toContain("fromflag");
		});
	});

	it("on startup --workspace wins over a saved entry", async () => {
		await withHome(async (home) => {
			const a = await mkdtemp(join(tmpdir(), "ws-a-"));
			await saveWorkspace({ name: "fromflag", folders: [a] }, workspacesDir(home));
			await saveWorkspace({ name: "other", folders: [a] }, workspacesDir(home));
			const branch = [{ type: "custom", customType: "pi-workspace", data: { name: "other" } }];
			const { pi, handlers } = fakePi("fromflag");
			extension(pi);
			const { ctx } = fakeCtx(a, branch);
			await handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
			const event: any = { systemPromptOptions: { sections: {}, contextFiles: [] } };
			await handlers.before_agent_start(event, ctx);
			expect(event.systemPromptOptions.sections.workspace).toContain("fromflag");
		});
	});

	it("/ws handlers never send messages", async () => {
		await withHome(async () => {
			const folder = await mkdtemp(join(tmpdir(), "ws-c-"));
			const { pi, handlers, commands, sent } = fakePi(undefined);
			extension(pi);
			const { ctx } = fakeCtx(folder);
			await handlers.session_start({ type: "session_start" }, ctx);
			for (const a of ["new demo", `add ${folder}`, "list", "use demo", `remove ${folder}`, "bogus"]) {
				await commands.ws.handler(a, ctx);
			}
			expect(sent).toEqual([]);
		});
	});
});
