import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { addFolder, listWorkspaces, loadWorkspace, removeFolder, saveWorkspace, validateName } from "../src/store.ts";

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "ws-store-"));
});

describe("validateName", () => {
	it("accepts simple names", () => {
		expect(() => validateName("my-proj_2")).not.toThrow();
	});
	it.each(["", "../x", "a/b", "has space", "-lead", "x".repeat(65)])("rejects %j", (n) => {
		expect(() => validateName(n)).toThrow();
	});
});

describe("save/load/list", () => {
	it("round-trips a workspace", async () => {
		await saveWorkspace({ name: "p", folders: ["/a", "/b"] }, dir);
		expect(await loadWorkspace("p", dir)).toEqual({ name: "p", folders: ["/a", "/b"] });
		const raw = JSON.parse(await readFile(join(dir, "p.json"), "utf-8"));
		expect(raw).toEqual({ name: "p", folders: ["/a", "/b"] });
	});
	it("normalizes and de-duplicates folders of a hand-written file on load", async () => {
		await writeFile(join(dir, "hand.json"), JSON.stringify({ name: "hand", folders: ["/a/b/", "/a/b", "/c/../d"] }));
		expect(await loadWorkspace("hand", dir)).toEqual({ name: "hand", folders: ["/a/b", "/d"] });
	});
	it("expands ~ in folders of a hand-written file on load", async () => {
		await writeFile(join(dir, "tilde.json"), JSON.stringify({ name: "tilde", folders: ["~/proj"] }));
		expect((await loadWorkspace("tilde", dir))?.folders).toEqual([join(homedir(), "proj")]);
	});
	it("returns undefined for a missing workspace", async () => {
		expect(await loadWorkspace("nope", dir)).toBeUndefined();
	});
	it("throws on corrupt JSON and on wrong shape", async () => {
		await writeFile(join(dir, "bad.json"), "{not json");
		await expect(loadWorkspace("bad", dir)).rejects.toThrow(/Invalid workspace file/);
		await writeFile(join(dir, "shape.json"), JSON.stringify({ name: "shape", folders: "x" }));
		await expect(loadWorkspace("shape", dir)).rejects.toThrow(/Invalid workspace file/);
	});
	it("lists sorted names", async () => {
		await saveWorkspace({ name: "b", folders: [] }, dir);
		await saveWorkspace({ name: "a", folders: [] }, dir);
		expect(await listWorkspaces(dir)).toEqual(["a", "b"]);
	});
	it("list on a missing dir is empty", async () => {
		expect(await listWorkspaces(join(dir, "missing"))).toEqual([]);
	});
	it("refuses to save an invalid name", async () => {
		await expect(saveWorkspace({ name: "../evil", folders: [] }, dir)).rejects.toThrow();
	});
});

describe("addFolder/removeFolder", () => {
	it("adds normalized and dedupes", () => {
		let ws = addFolder({ name: "p", folders: [] }, "/a/b/");
		ws = addFolder(ws, "/a/b");
		ws = addFolder(ws, "/a/c/../b");
		expect(ws.folders).toEqual(["/a/b"]);
	});
	it("removes by normalized path and is a no-op when absent", () => {
		const ws = { name: "p", folders: ["/a", "/b"] };
		expect(removeFolder(ws, "/a/").folders).toEqual(["/b"]);
		expect(removeFolder(ws, "/zzz").folders).toEqual(["/a", "/b"]);
	});
});
