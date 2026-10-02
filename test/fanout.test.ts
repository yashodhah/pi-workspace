import {
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
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

describe("fanOutTool", () => {
	it("keeps name, description and parameters of the built-in", () => {
		const t = fanOutTool(fakeFactory([]), () => ["/a"]);
		expect(t.name).toBe("grep");
		expect(t.description).toBe("fake grep");
		expect(t.label).toContain("workspace");
	});
	it("searches every folder for a relative or missing path, with headings", async () => {
		const calls: string[] = [];
		const t = fanOutTool(fakeFactory(calls), () => ["/a", "/b"]);
		const r = await t.execute("1", { pattern: "x" }, undefined, undefined, ctx("/a"));
		expect(calls).toEqual(["/a|/a|", "/b|/b|"]);
		const text = (r.content[0] as any).text as string;
		expect(text).toContain("## /a");
		expect(text).toContain("hit in /a");
		expect(text).toContain("## /b");
		expect((r.details as any).folders).toEqual(["/a", "/b"]);
	});
	it("runs once for an absolute path", async () => {
		const calls: string[] = [];
		const t = fanOutTool(fakeFactory(calls), () => ["/a", "/b"]);
		await t.execute("1", { pattern: "x", path: "/b/src" }, undefined, undefined, ctx("/a"));
		expect(calls).toEqual(["/a|/a|/b/src"]);
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
				async execute(...a: any[]) {
					if (cwd === "/bad") throw new Error("boom");
					return base.execute(...a);
				},
			};
		};
		const t = fanOutTool(factory, () => ["/bad", "/ok"]);
		const r = await t.execute("1", { pattern: "x" }, undefined, undefined, ctx("/ok"));
		const text = (r.content[0] as any).text as string;
		expect(text).toContain("## /bad");
		expect(text).toContain("error: boom");
		expect(text).toContain("hit in /ok");
	});

	it("accepts pi's real grep, find and ls factories", () => {
		expect(fanOutTool(createGrepToolDefinition, () => []).name).toBe("grep");
		expect(fanOutTool(createFindToolDefinition, () => []).name).toBe("find");
		expect(fanOutTool(createLsToolDefinition, () => []).name).toBe("ls");
	});
});
