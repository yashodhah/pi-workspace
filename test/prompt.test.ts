import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildWorkspaceBlock, collectContextFiles, findMissing, MULTI_ROOT_HINT } from "../src/prompt.ts";

describe("buildWorkspaceBlock", () => {
	const ws = { name: "demo", folders: ["/w/api", "/w/web"] };
	it("lists every folder and marks the session cwd when it is a member", () => {
		const b = buildWorkspaceBlock(ws, "/w/api", new Set());
		expect(b).toContain("demo");
		expect(b).toContain("/w/api (session cwd)");
		expect(b).toContain("/w/web");
		expect(b).not.toContain("/w/web (session cwd)");
		expect(b).toContain(MULTI_ROOT_HINT);
	});
	it("shows the cwd separately when it is outside the workspace", () => {
		const b = buildWorkspaceBlock(ws, "/elsewhere", new Set());
		expect(b).toContain("Session cwd (not in workspace): /elsewhere");
	});
	it("notes when the cwd is inside a folder", () => {
		const b = buildWorkspaceBlock(ws, "/w/web/src", new Set());
		expect(b).toContain("Session cwd: /w/web/src (inside /w/web)");
	});
	it("flags missing folders", () => {
		const b = buildWorkspaceBlock(ws, "/w/api", new Set(["/w/web"]));
		expect(b).toContain("/w/web (missing, skipped)");
	});
	it("states that absolute paths work in any folder", () => {
		expect(buildWorkspaceBlock(ws, "/w/api", new Set())).toContain("absolute path");
	});
});

describe("findMissing", () => {
	it("returns folders that do not exist or are files", async () => {
		const d = await mkdtemp(join(tmpdir(), "ws-miss-"));
		await writeFile(join(d, "file"), "x");
		const m = await findMissing([d, join(d, "nope"), join(d, "file")]);
		expect([...m].sort()).toEqual([join(d, "file"), join(d, "nope")].sort());
	});
});

describe("collectContextFiles", () => {
	it("collects instruction files and skips paths already present", async () => {
		const a = await mkdtemp(join(tmpdir(), "ws-a-"));
		const b = await mkdtemp(join(tmpdir(), "ws-b-"));
		await mkdir(join(b, "sub"));
		await writeFile(join(a, "AGENTS.md"), "A");
		await writeFile(join(b, "CLAUDE.md"), "B");
		const files = await collectContextFiles([a, b], [{ path: join(a, "AGENTS.md") }]);
		expect(files).toEqual([{ path: join(b, "CLAUDE.md"), content: "B" }]);
	});
	it("skips folders without instruction files", async () => {
		const a = await mkdtemp(join(tmpdir(), "ws-c-"));
		expect(await collectContextFiles([a], [])).toEqual([]);
	});
	it("yields the same AGENTS.md once across repeated per-turn calls", async () => {
		const a = await mkdtemp(join(tmpdir(), "ws-d-"));
		const b = await mkdtemp(join(tmpdir(), "ws-e-"));
		await writeFile(join(a, "AGENTS.md"), "A");
		await writeFile(join(b, "AGENTS.md"), "B");
		const base = [{ path: join(a, "AGENTS.md") }];
		const turn1 = await collectContextFiles([a, b], base);
		const turn2 = await collectContextFiles([a, b], base);
		expect(turn1).toEqual([{ path: join(b, "AGENTS.md"), content: "B" }]);
		expect(turn2).toEqual(turn1);
		const merged = [...base, ...turn1];
		expect(new Set(merged.map((f) => f.path)).size).toBe(merged.length);
	});
	it("skips a folder deleted after being added without breaking the others", async () => {
		const gone = join(await mkdtemp(join(tmpdir(), "ws-f-")), "deleted");
		const b = await mkdtemp(join(tmpdir(), "ws-g-"));
		await writeFile(join(b, "AGENTS.md"), "B");
		expect(await collectContextFiles([gone, b], [])).toEqual([{ path: join(b, "AGENTS.md"), content: "B" }]);
		expect([...(await findMissing([gone, b]))]).toEqual([gone]);
	});
});
