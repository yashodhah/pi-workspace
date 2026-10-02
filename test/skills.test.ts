import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverSkillPaths, findSkillClashes } from "../src/skills.ts";

async function folderWith(...dirs: string[]): Promise<string> {
	const f = await mkdtemp(join(tmpdir(), "ws-sk-"));
	for (const d of dirs) await mkdir(join(f, d), { recursive: true });
	return f;
}

describe("discoverSkillPaths", () => {
	it("returns only skill dirs that exist", async () => {
		const a = await folderWith(".pi/skills", ".github/skills");
		expect(await discoverSkillPaths([a], "/elsewhere")).toEqual([join(a, ".pi/skills"), join(a, ".github/skills")]);
	});
	it("orders the cwd folder first", async () => {
		const a = await folderWith(".claude/skills");
		const b = await folderWith(".claude/skills");
		expect(await discoverSkillPaths([a, b], b)).toEqual([join(b, ".claude/skills"), join(a, ".claude/skills")]);
	});
	it("orders a folder containing the cwd first", async () => {
		const a = await folderWith(".claude/skills");
		const b = await folderWith(".claude/skills");
		expect((await discoverSkillPaths([a, b], join(b, "src")))[0]).toBe(join(b, ".claude/skills"));
	});
	it("returns [] when no folder has skills", async () => {
		const a = await folderWith();
		expect(await discoverSkillPaths([a], a)).toEqual([]);
	});
});

describe("findSkillClashes", () => {
	it("reports a skill name defined under two paths", async () => {
		const a = await folderWith(".pi/skills/deploy", ".pi/skills/only-a");
		const b = await folderWith(".pi/skills/deploy");
		const clashes = await findSkillClashes([join(a, ".pi/skills"), join(b, ".pi/skills")]);
		expect(clashes).toHaveLength(1);
		expect(clashes[0]).toContain("deploy");
	});
	it("returns [] when names are unique", async () => {
		const a = await folderWith(".pi/skills/x");
		const b = await folderWith(".pi/skills/y");
		expect(await findSkillClashes([join(a, ".pi/skills"), join(b, ".pi/skills")])).toEqual([]);
	});
});
