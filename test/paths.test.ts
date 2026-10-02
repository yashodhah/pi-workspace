import { describe, expect, it } from "vitest";
import { cwdRole, dedupe, normalizeFolder } from "../src/paths.ts";

describe("normalizeFolder", () => {
	it("makes absolute, strips trailing slash and resolves ..", () => {
		expect(normalizeFolder("/a/b/")).toBe("/a/b");
		expect(normalizeFolder("/a/b/../c")).toBe("/a/c");
	});
	it("expands ~ using the provided home", () => {
		expect(normalizeFolder("~/proj", "/home/u")).toBe("/home/u/proj");
	});
	it("resolves relative paths against process.cwd()", () => {
		expect(normalizeFolder("x").startsWith("/")).toBe(true);
	});
});

describe("dedupe", () => {
	it("keeps first occurrence in order", () => {
		expect(dedupe(["/a", "/b", "/a", "/c", "/b"])).toEqual(["/a", "/b", "/c"]);
	});
});

describe("cwdRole", () => {
	const folders = ["/w/api", "/w/web"];
	it("member when cwd equals a folder", () => {
		expect(cwdRole(folders, "/w/api")).toEqual({ kind: "member", folder: "/w/api" });
	});
	it("inside when cwd is under a folder", () => {
		expect(cwdRole(folders, "/w/web/src")).toEqual({ kind: "inside", folder: "/w/web" });
	});
	it("outside otherwise, and /w/apix is not inside /w/api", () => {
		expect(cwdRole(folders, "/elsewhere")).toEqual({ kind: "outside" });
		expect(cwdRole(folders, "/w/apix")).toEqual({ kind: "outside" });
	});
});
