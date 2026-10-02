import {
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import { beforeEach, describe, expect, it } from "vitest";
import { fanOutTool } from "../src/fanout.ts";

function fakeFactory(calls: string[]) {
	return (cwd: string) =>
		({
			name: "grep",
			label: "grep",
			description: "fake grep",
			parameters: Type.Object({ pattern: Type.String(), path: Type.Optional(Type.String()) }),
			async execute(_id: string, params: any, _s: any, _u: any, ctx: any) {
				calls.push(`${cwd}|${ctx.cwd}|${params.path ?? ""}`);
				return { content: [{ type: "text", text: `hit in ${cwd}` }], details: undefined };
			},
		}) as any;
}

const ctx = (cwd: string) => ({ cwd }) as any;

let a: string;
let b: string;
beforeEach(async () => {
	a = await mkdtemp(join(tmpdir(), "ws-fan-a-"));
	b = await mkdtemp(join(tmpdir(), "ws-fan-b-"));
});

describe("fanOutTool", () => {
	it("keeps name, description and parameters of the built-in", () => {
		const t = fanOutTool(fakeFactory([]), () => [a]);
		expect(t.name).toBe("grep");
		expect(t.description).toBe("fake grep");
		expect(t.label).toContain("workspace");
	});
	it("searches every folder for a relative or missing path, with headings", async () => {
		const calls: string[] = [];
		const t = fanOutTool(fakeFactory(calls), () => [a, b]);
		const r = await t.execute("1", { pattern: "x" }, undefined, undefined, ctx(a));
		expect(calls).toEqual([`${a}|${a}|`, `${b}|${b}|`]);
		const text = (r.content[0] as any).text as string;
		expect(text).toContain(`## ${a}`);
		expect(text).toContain(`hit in ${a}`);
		expect(text).toContain(`## ${b}`);
		expect((r.details as any).folders).toEqual([a, b]);
	});
	it("runs once for an absolute path", async () => {
		const calls: string[] = [];
		const t = fanOutTool(fakeFactory(calls), () => [a, b]);
		await t.execute("1", { pattern: "x", path: `${b}/src` }, undefined, undefined, ctx(a));
		expect(calls).toEqual([`${a}|${a}|${b}/src`]);
	});
	it.each(["~/x/y", "~", "@/abs/p", "@~/x"])("runs once for the pi-resolved absolute path %s", async (path) => {
		const calls: string[] = [];
		const t = fanOutTool(fakeFactory(calls), () => [a, b]);
		await t.execute("1", { pattern: "x", path }, undefined, undefined, ctx(a));
		expect(calls).toEqual([`${a}|${a}|${path}`]);
	});
	it.each(["src", "@src", "./src", "~user/x"])("still fans out for the relative path %s", async (path) => {
		const calls: string[] = [];
		const t = fanOutTool(fakeFactory(calls), () => [a, b]);
		await t.execute("1", { pattern: "x", path }, undefined, undefined, ctx(a));
		expect(calls).toEqual([`${a}|${a}|${path}`, `${b}|${b}|${path}`]);
	});
	it("skips a deleted folder and still returns results for the others", async () => {
		const calls: string[] = [];
		await rm(a, { recursive: true });
		const t = fanOutTool(fakeFactory(calls), () => [a, b]);
		const r = await t.execute("1", { pattern: "x" }, undefined, undefined, ctx(b));
		const text = (r.content[0] as any).text as string;
		expect(calls).toEqual([`${b}|${b}|`]);
		expect(text).not.toContain(a);
		expect(text).not.toContain("error");
		expect(text).toContain(`## ${b}`);
		expect((r.details as any).folders).toEqual([b]);
	});
	it("delegates once to the cwd when every folder is missing", async () => {
		const calls: string[] = [];
		await rm(a, { recursive: true });
		await rm(b, { recursive: true });
		const t = fanOutTool(fakeFactory(calls), () => [a, b]);
		await t.execute("1", { pattern: "x" }, undefined, undefined, ctx("/cwd"));
		expect(calls).toEqual(["/cwd|/cwd|"]);
	});
	it("delegates once to the cwd when no workspace is attached", async () => {
		const calls: string[] = [];
		const t = fanOutTool(fakeFactory(calls), () => []);
		await t.execute("1", { pattern: "x" }, undefined, undefined, ctx("/cwd"));
		expect(calls).toEqual(["/cwd|/cwd|"]);
	});
	it("keeps going when one folder throws, and reports the error under its heading", async () => {
		const factory = (cwd: string) => {
			const base = fakeFactory([])(cwd);
			return {
				...base,
				async execute(...args: any[]) {
					if (cwd === a) throw new Error("boom");
					return base.execute(...args);
				},
			};
		};
		const t = fanOutTool(factory, () => [a, b]);
		const r = await t.execute("1", { pattern: "x" }, undefined, undefined, ctx(b));
		const text = (r.content[0] as any).text as string;
		expect(text).toContain(`## ${a}`);
		expect(text).toContain("error: boom");
		expect(text).toContain(`hit in ${b}`);
	});

	it("rethrows instead of reporting an error section when the call was aborted", async () => {
		const controller = new AbortController();
		const factory = (cwd: string) => {
			const base = fakeFactory([])(cwd);
			return {
				...base,
				async execute() {
					controller.abort();
					throw new Error("aborted");
				},
			};
		};
		const t = fanOutTool(factory, () => [a, b]);
		await expect(t.execute("1", { pattern: "x" }, controller.signal, undefined, ctx(a))).rejects.toThrow("aborted");
	});

	it("accepts pi's real grep, find and ls factories", () => {
		expect(fanOutTool(createGrepToolDefinition, () => []).name).toBe("grep");
		expect(fanOutTool(createFindToolDefinition, () => []).name).toBe("find");
		expect(fanOutTool(createLsToolDefinition, () => []).name).toBe("ls");
	});
});
