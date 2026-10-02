import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { refreshStatus, runWsCommand, type WsDeps } from "../src/commands.ts";
import { listWorkspaces, loadWorkspace, type Workspace } from "../src/store.ts";

let dir: string;
let proj: string;
let current: Workspace | undefined;
let persisted: Array<string | undefined>;
let notes: string[];
let inputs: Array<string | undefined>;
let selects: Array<string | undefined>;

function deps(): WsDeps {
	return {
		dir,
		ui: {
			notify: (m) => void notes.push(m),
			input: async () => inputs.shift(),
			select: async () => selects.shift(),
			setStatus: () => {},
		},
		getCurrent: () => current,
		setCurrent: (w) => void (current = w),
		persist: (n) => void persisted.push(n),
	};
}

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "ws-cmd-"));
	proj = await mkdtemp(join(tmpdir(), "ws-proj-"));
	current = undefined;
	persisted = [];
	notes = [];
	inputs = [];
	selects = [];
});

describe("runWsCommand", () => {
	it("new creates, attaches and persists the workspace name", async () => {
		await runWsCommand("new demo", deps());
		expect(await loadWorkspace("demo", dir)).toEqual({ name: "demo", folders: [] });
		expect(current?.name).toBe("demo");
		expect(persisted).toEqual(["demo"]);
	});
	it("new rejects an invalid name and writes nothing", async () => {
		await runWsCommand("new ../evil", deps());
		expect(current).toBeUndefined();
		expect(notes.join("\n")).toMatch(/Invalid workspace name/);
	});
	it("new rejects names with slashes, dots or spaces and writes nothing", async () => {
		for (const bad of ["a/b", "..", "my ws"]) {
			await runWsCommand(`new ${bad}`, deps());
		}
		expect(notes.filter((n) => /Invalid workspace name/.test(n)).length).toBe(3);
		expect(await listWorkspaces(dir)).toEqual([]);
		expect(current).toBeUndefined();
		expect(persisted).toEqual([]);
	});
	it("new refuses to overwrite an existing workspace", async () => {
		await runWsCommand("new demo", deps());
		notes.length = 0;
		await runWsCommand("new demo", deps());
		expect(notes.join("\n")).toMatch(/already exists/);
	});
	it("add with a path stores it normalized and deduped", async () => {
		await runWsCommand("new demo", deps());
		await runWsCommand(`add ${proj}/`, deps());
		await runWsCommand(`add ${proj}`, deps());
		expect((await loadWorkspace("demo", dir))?.folders).toEqual([proj]);
	});
	it("add normalizes ~ and .. into one absolute path", async () => {
		await runWsCommand("new demo", deps());
		const home = await mkdtemp(join(tmpdir(), "ws-home-"));
		await mkdir(join(home, "code"));
		const d = { ...deps(), home };
		await runWsCommand("add ~/code", d);
		await runWsCommand("add ~/code/../code/", d);
		expect((await loadWorkspace("demo", dir))?.folders).toEqual([join(home, "code")]);
	});
	it("add without a path asks via input", async () => {
		await runWsCommand("new demo", deps());
		inputs.push(proj);
		await runWsCommand("add", deps());
		expect(current?.folders).toEqual([proj]);
	});
	it("add rejects a path that is not an existing directory", async () => {
		await runWsCommand("new demo", deps());
		await runWsCommand(`add ${join(proj, "nope")}`, deps());
		expect(current?.folders).toEqual([]);
		expect(notes.join("\n")).toMatch(/not an existing directory/);
	});
	it("add and remove need an attached workspace", async () => {
		await runWsCommand(`add ${proj}`, deps());
		expect(notes.join("\n")).toMatch(/No workspace attached/);
	});
	it("remove with a path removes it; without a path it selects", async () => {
		await runWsCommand("new demo", deps());
		const second = join(proj, "second");
		await mkdir(second);
		await runWsCommand(`add ${proj}`, deps());
		await runWsCommand(`add ${second}`, deps());
		await runWsCommand(`remove ${proj}`, deps());
		expect(current?.folders).toEqual([second]);
		selects.push(second);
		await runWsCommand("remove", deps());
		expect(current?.folders).toEqual([]);
	});
	it("use attaches an existing workspace, and reports an unknown one", async () => {
		await runWsCommand("new demo", deps());
		current = undefined;
		await runWsCommand("use demo", deps());
		expect((current as Workspace | undefined)?.name).toBe("demo");
		notes.length = 0;
		await runWsCommand("use ghost", deps());
		expect(notes.join("\n")).toMatch(/not found/);
	});
	it("list shows saved workspaces", async () => {
		await runWsCommand("new alpha", deps());
		await runWsCommand("new beta", deps());
		notes.length = 0;
		await runWsCommand("list", deps());
		expect(notes.join("\n")).toContain("alpha");
		expect(notes.join("\n")).toContain("beta");
	});
	it("no args or an unknown subcommand prints usage and changes nothing", async () => {
		await runWsCommand("", deps());
		await runWsCommand("frobnicate", deps());
		expect(notes.filter((n) => n.includes("Usage")).length).toBe(2);
		expect(persisted).toEqual([]);
		expect(current).toBeUndefined();
		expect(await listWorkspaces(dir)).toEqual([]);
	});
});

describe("refreshStatus", () => {
	it("sets and clears the status line, counting missing folders", async () => {
		const calls: Array<[string, string | undefined]> = [];
		const ui = { setStatus: (k: string, t: string | undefined) => void calls.push([k, t]) };
		await refreshStatus({ name: "demo", folders: [proj, join(proj, "gone")] }, ui);
		await refreshStatus(undefined, ui);
		expect(calls[0]).toEqual(["workspace", "ws: demo (2 folders, 1 missing)"]);
		expect(calls[1]).toEqual(["workspace", undefined]);
	});
});
