# `/ws add` Folder Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/ws add` with no path lets the user navigate folders in the terminal (a loop over `ui.select`) and add the one they land on.

**Architecture:** A new pure module `src/browse.ts` lists subfolders and runs the select loop against an injected UI. `src/commands.ts` calls it when `add` has no argument, starting in the parent of the session cwd. `extensions/workspace.ts` passes `ctx.cwd` through.

**Tech Stack:** TypeScript (ESM), vitest, Node `fs/promises`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-03-ws-add-folder-browser-design.md`

## Global Constraints

- `/ws add <path>` is unchanged and must not open the browser.
- `/ws add` (no argument) opens the browser, starting in the parent directory of the session cwd (`dirname(cwd)`; at the filesystem root `dirname("/")` is `/`, so it starts at `/`).
- Screen title shows the current absolute path. Option order: `✓ Add this folder` (suffixed ` (already added)` when the folder is a member), `.. (up one level)` (omitted at the filesystem root), `~ (home)`, `⌨ Type a path…`, `✗ Cancel`, then subfolders as `name/` sorted.
- Hidden entries (names starting with `.`) and `node_modules` are omitted; no show-hidden toggle.
- Cap: 200 subfolders; if more exist append the informational option `… N more, use Type a path`; choosing it redisplays the same screen.
- One add per invocation; Escape (`undefined`) or `✗ Cancel` adds nothing.
- Unreadable directory: `notify` a warning and return to the previous directory; if there is no previous directory, end with nothing added.
- Adding an already-added folder is a no-op with an info notification.
- `/ws` handlers must never call `sendMessage` or `sendUserMessage`.
- `WsUi` in `src/commands.ts` stays unchanged. `strict` TypeScript stays on; imports use `.ts` extensions.
- Tests use real temp directories and the existing fake-UI pattern; test output must be pristine.

---

## File Structure

```
src/browse.ts            # NEW: listSubfolders, browseForFolder, label constants
test/browse.test.ts      # NEW
src/commands.ts          # MODIFY: WsDeps.cwd, add-case uses the browser
test/commands.test.ts    # MODIFY
extensions/workspace.ts  # MODIFY: pass cwd: ctx.cwd
test/entry.test.ts       # MODIFY: one new test
README.md                # MODIFY: describe the browser
```

---

### Task 1: Browser module

**Files:**
- Create: `src/browse.ts`
- Test: `test/browse.test.ts`

**Interfaces:**
- Consumes: nothing from earlier code (defines its own `BrowseUi`; `WsUi` from `src/commands.ts` is structurally assignable to it).
- Produces:
  - `interface BrowseUi { select(title: string, options: string[]): Promise<string | undefined>; input(title: string, placeholder?: string): Promise<string | undefined>; notify(msg: string, type?: "info" | "warning" | "error"): void }`
  - Constants: `MAX_ENTRIES = 200`, `ADD`, `ADD_EXISTING`, `UP`, `HOME`, `TYPE`, `CANCEL` (exact strings in the code below)
  - `listSubfolders(dir: string): Promise<{ names: string[]; more: number }>` (throws if `dir` is unreadable)
  - `browseForFolder(ui: BrowseUi, startDir: string, existing: readonly string[], home?: string): Promise<string | undefined>` (returns the chosen absolute directory; for `⌨ Type a path…` returns the text exactly as typed; `undefined` on cancel or when nothing should be added)

- [ ] **Step 1: Write the failing test**

```ts
// test/browse.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --run test/browse.test.ts`
Expected: FAIL, cannot resolve `../src/browse.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/browse.ts
import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const MAX_ENTRIES = 200;
export const ADD = "✓ Add this folder";
export const ADD_EXISTING = "✓ Add this folder (already added)";
export const UP = ".. (up one level)";
export const HOME = "~ (home)";
export const TYPE = "⌨ Type a path…";
export const CANCEL = "✗ Cancel";
const moreLabel = (n: number) => `… ${n} more, use Type a path`;

export interface BrowseUi {
	select(title: string, options: string[]): Promise<string | undefined>;
	input(title: string, placeholder?: string): Promise<string | undefined>;
	notify(msg: string, type?: "info" | "warning" | "error"): void;
}

export interface Listing {
	names: string[];
	more: number;
}

async function isDirectory(parent: string, e: Dirent): Promise<boolean> {
	if (e.isDirectory()) return true;
	if (!e.isSymbolicLink()) return false;
	try {
		return (await stat(join(parent, e.name))).isDirectory();
	} catch {
		return false;
	}
}

export async function listSubfolders(dir: string): Promise<Listing> {
	const entries = await readdir(dir, { withFileTypes: true });
	const names: string[] = [];
	for (const e of entries) {
		if (e.name.startsWith(".") || e.name === "node_modules") continue;
		if (await isDirectory(dir, e)) names.push(e.name);
	}
	names.sort();
	return { names: names.slice(0, MAX_ENTRIES), more: Math.max(0, names.length - MAX_ENTRIES) };
}

export async function browseForFolder(
	ui: BrowseUi,
	startDir: string,
	existing: readonly string[],
	home: string = homedir(),
): Promise<string | undefined> {
	let dir = startDir;
	let prev: string | undefined;
	for (;;) {
		let listing: Listing;
		try {
			listing = await listSubfolders(dir);
		} catch (e) {
			ui.notify(`Cannot read ${dir}: ${(e as Error).message}`, "warning");
			if (prev === undefined) return undefined;
			dir = prev;
			prev = undefined;
			continue;
		}
		const subs = new Map(listing.names.map((n) => [`${n}/`, n]));
		const isMember = existing.includes(dir);
		const options = [
			isMember ? ADD_EXISTING : ADD,
			...(dirname(dir) !== dir ? [UP] : []),
			HOME,
			TYPE,
			CANCEL,
			...subs.keys(),
			...(listing.more > 0 ? [moreLabel(listing.more)] : []),
		];
		const choice = await ui.select(`Add folder: ${dir}`, options);
		if (choice === undefined || choice === CANCEL) return undefined;
		if (choice === ADD || choice === ADD_EXISTING) {
			if (isMember) {
				ui.notify(`${dir} is already in the workspace`, "info");
				return undefined;
			}
			return dir;
		}
		if (choice === TYPE) return (await ui.input("Folder to add", "/path/to/folder")) || undefined;
		if (choice === UP) {
			prev = dir;
			dir = dirname(dir);
		} else if (choice === HOME) {
			prev = dir;
			dir = home;
		} else {
			const sub = subs.get(choice);
			if (sub !== undefined) {
				prev = dir;
				dir = join(dir, sub);
			}
			// the "… N more" line (or any unrecognised choice) redisplays this directory
		}
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest --run test/browse.test.ts && npx tsc --noEmit`
Expected: all browse tests PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/browse.ts test/browse.test.ts
git commit -m "feat: folder browser for /ws add"
```

---

### Task 2: Wire the browser into `/ws add`

**Files:**
- Modify: `src/commands.ts` (the `WsDeps` interface and the `add` case)
- Modify: `extensions/workspace.ts` (the `runWsCommand` call in the `ws` command handler)
- Modify: `test/commands.test.ts`, `test/entry.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `browseForFolder`, `TYPE`, `ADD`, `CANCEL` from `src/browse.ts` (Task 1).
- Produces: `WsDeps` gains a required `cwd: string`. Behaviour: `add` with an argument is unchanged; `add` without one calls `browseForFolder(d.ui, dirname(d.cwd), ws.folders, d.home)` and feeds a non-undefined result through the existing normalize / `isDirectory` check / `addFolder` / `save` path, then notifies `Added <folder>`. A cancelled browser returns silently.

- [ ] **Step 1: Write the failing tests**

In `test/commands.test.ts`:

1. Add `import { ADD, CANCEL, TYPE } from "../src/browse.ts";` to the imports.
2. In `deps()`, add `cwd: join(proj, "child"),` (so the browser starts in `proj`, which exists; `child` need not exist).
3. Replace the existing test `add without a path asks via input` with:

```ts
	it("add without a path opens the browser at the parent of the cwd and adds the chosen folder", async () => {
		await runWsCommand("new demo", deps());
		selects.push(ADD);
		await runWsCommand("add", deps());
		expect(current?.folders).toEqual([proj]);
		expect((await loadWorkspace("demo", dir))?.folders).toEqual([proj]);
		expect(notes.join("\n")).toContain(`Added ${proj}`);
	});
	it("add without a path can fall back to typing a path", async () => {
		await runWsCommand("new demo", deps());
		selects.push(TYPE);
		inputs.push(proj);
		await runWsCommand("add", deps());
		expect(current?.folders).toEqual([proj]);
	});
	it("add without a path adds nothing when the browser is cancelled", async () => {
		await runWsCommand("new demo", deps());
		notes.length = 0;
		selects.push(CANCEL);
		await runWsCommand("add", deps());
		expect(current?.folders).toEqual([]);
		expect(notes).toEqual([]);
	});
	it("add with a path does not open the browser", async () => {
		await runWsCommand("new demo", deps());
		selects.push(ADD);
		await runWsCommand(`add ${proj}`, deps());
		expect(current?.folders).toEqual([proj]);
		expect(selects).toEqual([ADD]);
	});
```

In `test/entry.test.ts`, add one test inside `describe("workspace extension", ...)` (reuse that file's existing helpers `fakePi`, `fakeCtx`, `withHome`; read them first and follow their exact shapes, including how a command handler is invoked):

```ts
	it("/ws add with no path browses from the parent of ctx.cwd", async () => {
		await withHome(async (home) => {
			const parent = await mkdtemp(join(tmpdir(), "ws-par-"));
			const cwd = join(parent, "me");
			await mkdir(cwd);
			await saveWorkspace({ name: "demo", folders: [] }, workspacesDir(home));
			const { pi, handlers, commands } = fakePi("demo");
			extension(pi);
			const { ctx } = fakeCtx(cwd);
			const titles: string[] = [];
			ctx.ui.select = async (title: string) => {
				titles.push(title);
				return "✓ Add this folder";
			};
			await handlers.session_start({ type: "session_start" }, ctx);
			await commands.ws.handler("add", ctx);
			expect(titles[0]).toContain(parent);
			expect((await loadWorkspace("demo", workspacesDir(home)))?.folders).toEqual([parent]);
		});
	});
```

(Add `mkdir` to the `node:fs/promises` import and `loadWorkspace` to the `../src/store.ts` import in that file if they are not already imported.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest --run test/commands.test.ts test/entry.test.ts`
Expected: FAIL (type error / `cwd` unused / browser not opened: the new add tests fail; `select` is never called).

- [ ] **Step 3: Implement**

`src/commands.ts`:

```ts
// imports: add
import { dirname } from "node:path";
import { browseForFolder } from "./browse.ts";

// WsDeps: add one field
	cwd: string;

// in runWsCommand, case "add": replace the `const raw = ...` line with
				const raw = arg || (await browseForFolder(d.ui, dirname(d.cwd), ws.folders, d.home));
```

`extensions/workspace.ts`, in the `runWsCommand(args, { ... })` call add `cwd: ctx.cwd,` next to `ui: ctx.ui`.

`README.md`: find the sentences that describe the path prompt for `/ws add` and the "no native folder picker" caveat; rewrite them to say: `/ws add` with no path opens a terminal folder browser (arrow keys and Enter) that starts in the parent of the session cwd; options are add this folder, up one level, home, type a path, cancel, then subfolders; hidden folders and `node_modules` are not listed; one folder is added per invocation; `/ws add <path>` still adds directly. Do not change the "Verified" section, and add a line there under "Not verified live": "`/ws add` folder browser in the real TUI (covered by unit tests only)".

- [ ] **Step 4: Run the whole suite and typecheck**

Run: `npx vitest --run && npx tsc --noEmit`
Expected: all tests PASS, no type errors, pristine output.

- [ ] **Step 5: Commit**

```bash
git add src/commands.ts extensions/workspace.ts test/commands.test.ts test/entry.test.ts README.md
git commit -m "feat: /ws add opens a folder browser"
```
