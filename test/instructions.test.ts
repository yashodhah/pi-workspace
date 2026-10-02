import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { loadFolderInstructions, MAX_INSTRUCTION_CHARS } from "../src/instructions.ts";

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "ws-instr-"));
});

describe("loadFolderInstructions", () => {
	it("returns undefined when no instruction file exists", async () => {
		expect(await loadFolderInstructions(dir)).toBeUndefined();
	});
	it("loads AGENTS.md with its absolute path", async () => {
		await writeFile(join(dir, "AGENTS.md"), "be nice");
		expect(await loadFolderInstructions(dir)).toEqual({ path: join(dir, "AGENTS.md"), content: "be nice" });
	});
	it("prefers AGENTS.override.md over AGENTS.md and CLAUDE.md", async () => {
		await writeFile(join(dir, "AGENTS.md"), "a");
		await writeFile(join(dir, "CLAUDE.md"), "c");
		await writeFile(join(dir, "AGENTS.override.md"), "o");
		expect((await loadFolderInstructions(dir))?.content).toBe("o");
	});
	it("falls back to CLAUDE.md", async () => {
		await writeFile(join(dir, "CLAUDE.md"), "c");
		expect((await loadFolderInstructions(dir))?.content).toBe("c");
	});
	it("truncates oversized files with a note", async () => {
		await writeFile(join(dir, "AGENTS.md"), "x".repeat(MAX_INSTRUCTION_CHARS + 50));
		const r = await loadFolderInstructions(dir);
		expect(r?.content.startsWith("x".repeat(MAX_INSTRUCTION_CHARS))).toBe(true);
		expect(r?.content).toContain("[truncated");
	});
	it("returns undefined for a folder that does not exist", async () => {
		expect(await loadFolderInstructions(join(dir, "gone"))).toBeUndefined();
	});
});
