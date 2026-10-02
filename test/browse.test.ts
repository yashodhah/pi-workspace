import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ADD, ADD_EXISTING, browseForFolder, CANCEL, HOME, listSubfolders, MAX_ENTRIES, TYPE, UP } from "../src/browse.ts";

type Step = string | undefined | ((options: string[]) => string | undefined);

let root: string;
let screens: Array<{ title: string; options: string[] }>;
let notes: Array<[string, string | undefined]>;
let script: Step[];
let typed: Array<string | undefined>;

const ui = {
	select: async (title: string, options: string[]) => {
		screens.push({ title, options });
		const step = script.shift();
		return typeof step === "function" ? step(options) : step;
	},
	input: async () => typed.shift(),
	notify: (m: string, t?: string) => void notes.push([m, t]),
};

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "ws-browse-"));
	for (const d of ["a/inner", "b", ".hidden", "node_modules"]) await mkdir(join(root, d), { recursive: true });
	await writeFile(join(root, "file.txt"), "x");
	screens = [];
	notes = [];
	script = [];
	typed = [];
});

describe("listSubfolders", () => {
	it("lists visible directories sorted, omitting hidden, node_modules and files", async () => {
		expect(await listSubfolders(root)).toEqual({ names: ["a", "b"], more: 0 });
	});
	it("includes symlinks that point to directories", async () => {
		await symlink(join(root, "b"), join(root, "link"));
		expect((await listSubfolders(root)).names).toEqual(["a", "b", "link"]);
	});
	it("caps the list and reports how many were omitted", async () => {
		const big = await mkdtemp(join(tmpdir(), "ws-big-"));
		for (let i = 0; i < MAX_ENTRIES + 5; i++) await mkdir(join(big, `d${String(i).padStart(3, "0")}`));
		const r = await listSubfolders(big);
		expect(r.names).toHaveLength(MAX_ENTRIES);
		expect(r.more).toBe(5);
	});
	it("throws for a directory that cannot be read", async () => {
		await expect(listSubfolders(join(root, "nope"))).rejects.toThrow();
	});
});

describe("browseForFolder", () => {
	it("shows the path in the title and the options in the specified order", async () => {
		script.push(ADD);
		expect(await browseForFolder(ui, root, [])).toBe(root);
		expect(screens[0].title).toContain(root);
		expect(screens[0].options).toEqual([ADD, UP, HOME, TYPE, CANCEL, "a/", "b/"]);
	});
	it("descends into subfolders and adds where it lands", async () => {
		script.push("a/", "inner/", ADD);
		expect(await browseForFolder(ui, root, [])).toBe(join(root, "a", "inner"));
		expect(screens[2].title).toContain(join(root, "a", "inner"));
	});
	it("goes up one level", async () => {
		script.push(UP, ADD);
		expect(await browseForFolder(ui, join(root, "a"), [])).toBe(root);
	});
	it("omits the up option at the filesystem root", async () => {
		script.push(CANCEL);
		await browseForFolder(ui, "/", []);
		expect(screens[0].options).not.toContain(UP);
	});
	it("jumps to the injected home", async () => {
		script.push(HOME, ADD);
		expect(await browseForFolder(ui, root, [], join(root, "b"))).toBe(join(root, "b"));
	});
	it("cancels via the cancel option and via escape, adding nothing", async () => {
		script.push(CANCEL);
		expect(await browseForFolder(ui, root, [])).toBeUndefined();
		script.push(undefined);
		expect(await browseForFolder(ui, root, [])).toBeUndefined();
		expect(notes).toEqual([]);
	});
	it("returns typed text as typed, or undefined when the prompt is dismissed", async () => {
		script.push(TYPE);
		typed.push("~/code/x");
		expect(await browseForFolder(ui, root, [])).toBe("~/code/x");
		script.push(TYPE);
		typed.push(undefined);
		expect(await browseForFolder(ui, root, [])).toBeUndefined();
	});
	it("marks an already-added folder and treats choosing it as a no-op with an info note", async () => {
		script.push(ADD_EXISTING);
		expect(await browseForFolder(ui, root, [root])).toBeUndefined();
		expect(screens[0].options[0]).toBe(ADD_EXISTING);
		expect(notes).toHaveLength(1);
		expect(notes[0][1]).toBe("info");
		expect(notes[0][0]).toMatch(/already/);
	});
	it("warns and returns to the previous directory when a folder becomes unreadable", async () => {
		script.push(() => {
			rmSync(join(root, "b"), { recursive: true });
			return "b/";
		}, CANCEL);
		expect(await browseForFolder(ui, root, [])).toBeUndefined();
		expect(notes[0][1]).toBe("warning");
		expect(notes[0][0]).toMatch(/Cannot read/);
		expect(screens).toHaveLength(2);
		expect(screens[1].title).toContain(root);
	});
	it("ends with a warning when the start directory is unreadable", async () => {
		expect(await browseForFolder(ui, join(root, "nope"), [])).toBeUndefined();
		expect(screens).toHaveLength(0);
		expect(notes[0][1]).toBe("warning");
	});
	it("shows an informational more-line past the cap and redisplays on choosing it", async () => {
		const big = await mkdtemp(join(tmpdir(), "ws-more-"));
		for (let i = 0; i < MAX_ENTRIES + 5; i++) await mkdir(join(big, `d${String(i).padStart(3, "0")}`));
		const more = "… 5 more, use Type a path";
		script.push(more, CANCEL);
		await browseForFolder(ui, big, []);
		expect(screens[0].options.at(-1)).toBe(more);
		expect(screens).toHaveLength(2);
		expect(screens[1].title).toBe(screens[0].title);
	});
});
