# pi-workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pi extension that attaches a named multi-folder workspace to a session, so the model sees every folder's layout, instruction files and skills and can search all of them.

**Architecture:** One pi package (`pi-workspace/`) with small pure modules (store, paths, instructions, skills, prompt) wired into pi through a thin `index.ts` that registers a flag, a `/ws` command, event hooks and three same-name tool overrides (`grep`, `find`, `ls`). Pure modules are unit-tested with vitest on temp directories; `index.ts` is tested against a fake `ExtensionAPI`. A throwaway spike runs first to settle five unconfirmed pi behaviours.

**Tech Stack:** TypeScript (ESM), vitest, `@earendil-works/pi-coding-agent` and `@earendil-works/pi-ai` as peer dependencies, `typebox` for schemas. pi loads TS directly via jiti, so there is no build step.

**Spec:** `docs/superpowers/specs/2026-10-03-pi-workspace-extension-design.md`

## Global Constraints

- Workspaces are per user, stored as `~/.pi/workspaces/<name>.json` with shape `{ "name": string, "folders": string[] }`; folders are absolute, normalized and de-duplicated.
- No separate CLI. Entry point is `pi --workspace <name>`; management is `/ws new|add|remove|use|list` inside the session.
- The session cwd is one member of the workspace; it is marked `(session cwd)` and stays the default for relative paths and `bash`.
- v1 tool reach is read-only across folders: `write`, `edit` and `bash` are not overridden. `read` needs no override because it already accepts absolute paths; `grep`, `find`, `ls` are overridden to fan out.
- Semantic indexing is out of scope; search is live `grep`/`find` only.
- Workspace trust, writes outside the cwd and shell subcommands are out of scope.
- `/ws` handlers must never call `sendMessage` or `sendUserMessage` (zero context cost). State is saved with `appendEntry` only.
- Missing folders are skipped and flagged in the status line; they never crash the session.
- Instruction files are `AGENTS.override.md`, `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, `CLAUDE.MD` (first match per folder), truncated with a note above 20000 characters.
- Skill dirs searched in each folder: `.pi/skills`, `.claude/skills`, `.github/skills`.
- Tool override pattern: register a tool with the built-in's name (see `pi/packages/coding-agent/examples/extensions/tool-override.ts`).

## Review Focus

- Folder path with a trailing slash, `~`, relative path or `..` segments: stored once as one absolute path, never twice.
- Workspace name containing `/`, `..` or spaces: rejected, never writes outside `~/.pi/workspaces/`.
- A folder deleted after being added: skipped with a flag in the status line; instructions and tools for the other folders still work.
- The same `AGENTS.md` reachable twice (cwd walk by pi and workspace folder): appears once in the prompt, including when `before_agent_start` fires every turn.
- `grep`/`find`/`ls` called with an absolute path inside one folder: runs once, not once per folder.
- `/ws` typed with no or an unknown subcommand: usage text via `notify`, nothing sent to the model.
- `--workspace` pointing at a nonexistent workspace in a non-interactive mode (no UI): clear warning, session continues with no workspace.

---

## File Structure

```
pi-workspace/
  package.json
  tsconfig.json
  vitest.config.ts
  extensions/workspace.ts      # thin entry: default export (pi) => void; only wiring
  src/paths.ts                 # normalizeFolder, dedupe, cwdRole
  src/store.ts                 # Workspace type, validateName, load/save/list, addFolder/removeFolder
  src/instructions.ts          # loadFolderInstructions
  src/skills.ts                # discoverSkillPaths, findSkillClashes
  src/prompt.ts                # buildWorkspaceBlock, collectContextFiles
  src/fanout.ts                # fanOutTool wrapper for grep/find/ls
  src/commands.ts              # runWsCommand(args, deps)
  test/*.test.ts               # one file per src module + test/entry.test.ts
  docs/spike-findings.md       # written by Task 0
```

Each `src/` module has one job and imports only from lower-numbered modules in the task list (paths -> store -> instructions/skills -> prompt -> fanout -> commands -> entry).

---

### Task 0: Throwaway spike (settle five unknowns)

**Files:**
- Create: `pi-workspace/spike/spike.ts` (throwaway; delete after)
- Create: `pi-workspace/docs/spike-findings.md`

**Interfaces:**
- Consumes: pi checkout at `/Users/yashodhah/Projects/pi_flue/pi`.
- Produces: `docs/spike-findings.md` with an exact answer for each of the questions below. Later tasks adjust only the single line the finding affects.

The spike is an answer, not code to keep. Label it throwaway and delete it at the end of the task.

- [ ] **Step 1: Write the spike extension**

```ts
// pi-workspace/spike/spike.ts  (THROWAWAY)
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	let turn = 0;
	pi.registerFlag("workspace", { type: "string", description: "spike flag" });

	pi.on("session_start", async (_e, ctx) => {
		ctx.ui.notify(`Q3 getFlag in session_start: ${String(pi.getFlag("workspace"))}`, "info");
		const entries = ctx.sessionManager.getBranch();
		ctx.ui.notify(`Q4b entries: ${JSON.stringify(entries.filter((e: any) => e.type === "custom"))}`, "info");
	});

	pi.on("resources_discover", async (e) => {
		console.error(`Q5 resources_discover reason=${e.reason}`);
		return { skillPaths: [] };
	});

	pi.on("before_agent_start", async (event) => {
		turn += 1;
		const had = event.systemPromptOptions.sections["spike"];
		console.error(`Q1 turn=${turn} sectionAlreadyPresent=${had !== undefined}`);
		event.systemPromptOptions.sections["spike"] = `spike section set on turn ${turn}`;
		event.systemPromptOptions.contextFiles.push({ path: "/spike/AGENTS.md", content: `turn ${turn}` });
		console.error(`Q1 contextFiles=${event.systemPromptOptions.contextFiles.length}`);
	});

	pi.registerCommand("spike", {
		description: "spike command",
		handler: async (args, ctx) => {
			ctx.ui.notify(`spike ran: ${args}`, "info");
			pi.appendEntry("pi-workspace-spike", { name: args });
		},
	});
}
```

- [ ] **Step 2: Run pi with the spike and answer each question**

Run (from any directory): `pi -e /Users/yashodhah/Projects/pi_flue/pi-workspace/spike/spike.ts --workspace demo`

Send two normal prompts, run `/spike hello`, then `/reload`, then send another prompt, then exit and restart with `--continue` (or pi's resume flag; check `pi --help`). Record, for each question:

1. Q1: on the second turn is `sectionAlreadyPresent` true, and does `contextFiles` grow by one each turn (mutations persist) or reset to the base count (per run)?
2. Q2: replace the tool by registering `grep` with the built-in schema (copy `createGrepToolDefinition(process.cwd())` fields, change `label`) and confirm the TUI still renders results normally.
3. Q3: is `getFlag("workspace")` populated in `session_start`? In the factory body?
4. Q4: after `/spike hello`, does the transcript show the command text or any message? (Expected: no.) Record the exact shape of the entry returned by `getBranch()` for `appendEntry` (fields holding `customType` and `data`).
5. Q5: does `resources_discover` fire on `/reload` (reason `"reload"`)? Can a skill dir created after startup be picked up by returning its path on reload?
6. Q6: if two `skillPaths` contain a skill with the same name, which one does pi use, and is a diagnostic shown?

- [ ] **Step 3: Write findings**

Create `pi-workspace/docs/spike-findings.md` with one section per question: the observed behaviour, and the exact line in the plan it changes (or "no change"). If Q1 shows per-run reset, no change is needed (the injector is idempotent). If Q3 shows the flag is only available in `session_start`, no change is needed (Task 7 reads it there). If Q4 shows a different entry shape, Task 7's `restoreFromBranch` is the only line to adjust.

- [ ] **Step 4: Delete the throwaway and stop if anything is blocking**

Run: `rm -rf /Users/yashodhah/Projects/pi_flue/pi-workspace/spike`

If Q2 shows the override cannot render or Q1 shows mutations do not take effect at all, stop and report to the user before continuing.

---

### Task 1: Package scaffold and paths module

**Files:**
- Create: `pi-workspace/package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- Create: `pi-workspace/src/paths.ts`
- Test: `pi-workspace/test/paths.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `normalizeFolder(input: string, home?: string): string` (absolute, `~` expanded, no trailing separator)
  - `dedupe(paths: string[]): string[]` (keeps first occurrence, order preserved)
  - `type CwdRole = { kind: "member"; folder: string } | { kind: "inside"; folder: string } | { kind: "outside" }`
  - `cwdRole(folders: string[], cwd: string): CwdRole`

- [ ] **Step 1: Scaffold the package**

```bash
mkdir -p /Users/yashodhah/Projects/pi_flue/pi-workspace/{src,test,extensions,docs}
cd /Users/yashodhah/Projects/pi_flue/pi-workspace
git init
cat > package.json <<'EOF'
{
  "name": "pi-workspace",
  "version": "0.1.0",
  "type": "module",
  "description": "Multi-folder workspaces for the pi coding agent",
  "pi": { "extensions": ["./extensions/workspace.ts"] },
  "scripts": { "test": "vitest --run" },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-ai": "*"
  },
  "dependencies": { "typebox": "*" },
  "devDependencies": { "typescript": "^5.6.0", "vitest": "^2.1.0", "@types/node": "^22.0.0" }
}
EOF
cat > tsconfig.json <<'EOF'
{ "compilerOptions": { "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler", "strict": true, "skipLibCheck": true, "noEmit": true, "types": ["node"] }, "include": ["src", "extensions", "test"] }
EOF
cat > vitest.config.ts <<'EOF'
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
EOF
printf "node_modules\n" > .gitignore
npm install
```

Expected: install completes. If the pi packages are not published for your registry, add `"@earendil-works/pi-coding-agent": "file:../pi/packages/coding-agent"` under `devDependencies` and re-run `npm install`; they stay peer dependencies in the published package.

- [ ] **Step 2: Write the failing test**

```ts
// test/paths.test.ts
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest --run test/paths.test.ts`
Expected: FAIL, cannot resolve `../src/paths.ts`.

- [ ] **Step 4: Write minimal implementation**

```ts
// src/paths.ts
import { homedir } from "node:os";
import { resolve, sep } from "node:path";

export type CwdRole = { kind: "member"; folder: string } | { kind: "inside"; folder: string } | { kind: "outside" };

export function normalizeFolder(input: string, home: string = homedir()): string {
	const expanded = input === "~" ? home : input.startsWith("~/") ? home + input.slice(1) : input;
	return resolve(expanded);
}

export function dedupe(paths: string[]): string[] {
	return [...new Set(paths)];
}

export function cwdRole(folders: string[], cwd: string): CwdRole {
	const exact = folders.find((f) => f === cwd);
	if (exact) return { kind: "member", folder: exact };
	const inside = folders.find((f) => cwd.startsWith(f.endsWith(sep) ? f : f + sep));
	if (inside) return { kind: "inside", folder: inside };
	return { kind: "outside" };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest --run test/paths.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: package scaffold and path helpers"
```

---

### Task 2: Workspace store

**Files:**
- Create: `pi-workspace/src/store.ts`
- Test: `pi-workspace/test/store.test.ts`

**Interfaces:**
- Consumes: `normalizeFolder`, `dedupe` from `src/paths.ts`.
- Produces:
  - `interface Workspace { name: string; folders: string[] }`
  - `workspacesDir(home?: string): string` (`<home>/.pi/workspaces`)
  - `validateName(name: string): void` (throws `Error` unless `/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/`)
  - `loadWorkspace(name: string, dir?: string): Promise<Workspace | undefined>` (undefined if missing; throws `Error("Invalid workspace file: <path>")` on corrupt JSON or wrong shape)
  - `saveWorkspace(ws: Workspace, dir?: string): Promise<void>`
  - `listWorkspaces(dir?: string): Promise<string[]>` (sorted names)
  - `addFolder(ws: Workspace, folder: string): Workspace` (pure; normalized, deduped)
  - `removeFolder(ws: Workspace, folder: string): Workspace` (pure; normalized)

- [ ] **Step 1: Write the failing test**

```ts
// test/store.test.ts
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --run test/store.test.ts`
Expected: FAIL, cannot resolve `../src/store.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/store.ts
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { dedupe, normalizeFolder } from "./paths.ts";

export interface Workspace {
	name: string;
	folders: string[];
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function workspacesDir(home: string = homedir()): string {
	return join(home, ".pi", "workspaces");
}

export function validateName(name: string): void {
	if (!NAME.test(name)) {
		throw new Error(`Invalid workspace name "${name}": use letters, digits, - and _ (max 64, no leading -)`);
	}
}

function isWorkspace(v: unknown, name: string): v is Workspace {
	const o = v as Workspace;
	return (
		!!o &&
		typeof o === "object" &&
		o.name === name &&
		Array.isArray(o.folders) &&
		o.folders.every((f) => typeof f === "string")
	);
}

export async function loadWorkspace(name: string, dir: string = workspacesDir()): Promise<Workspace | undefined> {
	validateName(name);
	const file = join(dir, `${name}.json`);
	let text: string;
	try {
		text = await readFile(file, "utf-8");
	} catch (e: any) {
		if (e?.code === "ENOENT") return undefined;
		throw e;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new Error(`Invalid workspace file: ${file}`);
	}
	if (!isWorkspace(parsed, name)) throw new Error(`Invalid workspace file: ${file}`);
	return parsed;
}

export async function saveWorkspace(ws: Workspace, dir: string = workspacesDir()): Promise<void> {
	validateName(ws.name);
	await mkdir(dir, { recursive: true });
	const file = join(dir, `${ws.name}.json`);
	const tmp = `${file}.tmp`;
	await writeFile(tmp, `${JSON.stringify({ name: ws.name, folders: ws.folders }, null, 2)}\n`);
	await rename(tmp, file);
}

export async function listWorkspaces(dir: string = workspacesDir()): Promise<string[]> {
	try {
		const names = await readdir(dir);
		return names
			.filter((n) => n.endsWith(".json"))
			.map((n) => n.slice(0, -".json".length))
			.sort();
	} catch (e: any) {
		if (e?.code === "ENOENT") return [];
		throw e;
	}
}

export function addFolder(ws: Workspace, folder: string): Workspace {
	return { ...ws, folders: dedupe([...ws.folders, normalizeFolder(folder)]) };
}

export function removeFolder(ws: Workspace, folder: string): Workspace {
	const target = normalizeFolder(folder);
	return { ...ws, folders: ws.folders.filter((f) => f !== target) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest --run test/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: workspace store with validated names and atomic saves"
```

---

### Task 3: Instruction loader

**Files:**
- Create: `pi-workspace/src/instructions.ts`
- Test: `pi-workspace/test/instructions.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `INSTRUCTION_FILES: readonly string[]` = `["AGENTS.override.md","AGENTS.md","AGENTS.MD","CLAUDE.md","CLAUDE.MD"]`
  - `MAX_INSTRUCTION_CHARS = 20000`
  - `interface ContextFile { path: string; content: string }`
  - `loadFolderInstructions(folder: string): Promise<ContextFile | undefined>` (first match only; truncated with the note `\n\n[truncated: file exceeds 20000 characters]`)

- [ ] **Step 1: Write the failing test**

```ts
// test/instructions.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --run test/instructions.test.ts`
Expected: FAIL, cannot resolve `../src/instructions.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/instructions.ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const INSTRUCTION_FILES = ["AGENTS.override.md", "AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"] as const;
export const MAX_INSTRUCTION_CHARS = 20000;

export interface ContextFile {
	path: string;
	content: string;
}

export async function loadFolderInstructions(folder: string): Promise<ContextFile | undefined> {
	for (const name of INSTRUCTION_FILES) {
		const path = join(folder, name);
		let content: string;
		try {
			content = await readFile(path, "utf-8");
		} catch {
			continue;
		}
		if (content.length > MAX_INSTRUCTION_CHARS) {
			content = `${content.slice(0, MAX_INSTRUCTION_CHARS)}\n\n[truncated: file exceeds ${MAX_INSTRUCTION_CHARS} characters]`;
		}
		return { path, content };
	}
	return undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest --run test/instructions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: per-folder instruction file loader"
```

---

### Task 4: Prompt block and context-file collection

**Files:**
- Create: `pi-workspace/src/prompt.ts`
- Test: `pi-workspace/test/prompt.test.ts`

**Interfaces:**
- Consumes: `Workspace` from `src/store.ts`; `cwdRole` from `src/paths.ts`; `loadFolderInstructions`, `ContextFile` from `src/instructions.ts`.
- Produces:
  - `buildWorkspaceBlock(ws: Workspace, cwd: string, missing: ReadonlySet<string>): string`
  - `collectContextFiles(folders: string[], existing: ReadonlyArray<{ path: string }>): Promise<ContextFile[]>` (instruction files for `folders` whose `path` is not already in `existing`)
  - `findMissing(folders: string[]): Promise<Set<string>>` (folders that do not exist or are not directories)
  - `MULTI_ROOT_HINT: string`

- [ ] **Step 1: Write the failing test**

```ts
// test/prompt.test.ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --run test/prompt.test.ts`
Expected: FAIL, cannot resolve `../src/prompt.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/prompt.ts
import { stat } from "node:fs/promises";
import { type ContextFile, loadFolderInstructions } from "./instructions.ts";
import { cwdRole } from "./paths.ts";
import type { Workspace } from "./store.ts";

export const MULTI_ROOT_HINT =
	"This is a multi-folder workspace. Apply each folder's instructions to files inside that folder.";

export function buildWorkspaceBlock(ws: Workspace, cwd: string, missing: ReadonlySet<string>): string {
	const role = cwdRole(ws.folders, cwd);
	const lines = ws.folders.map((f) => {
		const tags: string[] = [];
		if (role.kind === "member" && role.folder === f) tags.push("session cwd");
		if (missing.has(f)) tags.push("missing, skipped");
		return `- ${f}${tags.length ? ` (${tags.join(", ")})` : ""}`;
	});
	const out = [`Workspace "${ws.name}" has these folders:`, ...lines];
	if (role.kind === "inside") out.push(`Session cwd: ${cwd} (inside ${role.folder})`);
	if (role.kind === "outside") out.push(`Session cwd (not in workspace): ${cwd}`);
	out.push(
		"Relative paths and bash use the session cwd. Use an absolute path to read a file in any workspace folder; " +
			"grep, find and ls search every folder when given a relative path.",
	);
	out.push(MULTI_ROOT_HINT);
	return out.join("\n");
}

export async function findMissing(folders: string[]): Promise<Set<string>> {
	const missing = new Set<string>();
	await Promise.all(
		folders.map(async (f) => {
			try {
				if (!(await stat(f)).isDirectory()) missing.add(f);
			} catch {
				missing.add(f);
			}
		}),
	);
	return missing;
}

export async function collectContextFiles(
	folders: string[],
	existing: ReadonlyArray<{ path: string }>,
): Promise<ContextFile[]> {
	const seen = new Set(existing.map((e) => e.path));
	const out: ContextFile[] = [];
	for (const folder of folders) {
		const file = await loadFolderInstructions(folder);
		if (file && !seen.has(file.path)) {
			seen.add(file.path);
			out.push(file);
		}
	}
	return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest --run test/prompt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: workspace prompt block and context-file collection"
```

---

### Task 5: Skill discovery

**Files:**
- Create: `pi-workspace/src/skills.ts`
- Test: `pi-workspace/test/skills.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `SKILL_DIRS: readonly string[]` = `[".pi/skills", ".claude/skills", ".github/skills"]`
  - `discoverSkillPaths(folders: string[], cwd: string): Promise<string[]>` (existing skill directories; folders ordered cwd-first, then workspace order)
  - `findSkillClashes(paths: string[]): Promise<string[]>` (human-readable lines, one per skill name that appears under more than one path; skill name is each immediate subdirectory name)

- [ ] **Step 1: Write the failing test**

```ts
// test/skills.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --run test/skills.test.ts`
Expected: FAIL, cannot resolve `../src/skills.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/skills.ts
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { cwdRole } from "./paths.ts";

export const SKILL_DIRS = [".pi/skills", ".claude/skills", ".github/skills"] as const;

async function isDir(p: string): Promise<boolean> {
	try {
		return (await stat(p)).isDirectory();
	} catch {
		return false;
	}
}

function cwdFirst(folders: string[], cwd: string): string[] {
	const role = cwdRole(folders, cwd);
	if (role.kind === "outside") return folders;
	return [role.folder, ...folders.filter((f) => f !== role.folder)];
}

export async function discoverSkillPaths(folders: string[], cwd: string): Promise<string[]> {
	const out: string[] = [];
	for (const folder of cwdFirst(folders, cwd)) {
		for (const rel of SKILL_DIRS) {
			const p = join(folder, rel);
			if (await isDir(p)) out.push(p);
		}
	}
	return out;
}

export async function findSkillClashes(paths: string[]): Promise<string[]> {
	const owners = new Map<string, string[]>();
	for (const p of paths) {
		let names: string[] = [];
		try {
			names = (await readdir(p, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
		} catch {
			continue;
		}
		for (const n of names) owners.set(n, [...(owners.get(n) ?? []), p]);
	}
	return [...owners.entries()]
		.filter(([, where]) => where.length > 1)
		.map(([name, where]) => `Skill "${name}" is defined in ${where.join(" and ")}; the first path wins`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest --run test/skills.test.ts`
Expected: PASS. If Task 0 Q6 showed pi picks the last path instead of the first, reverse the ordering in `discoverSkillPaths` and the wording "the first path wins" in `findSkillClashes`, and update the two ordering tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: skill directory discovery with cwd-first ordering"
```

---

### Task 6: Multi-root fan-out tools

**Files:**
- Create: `pi-workspace/src/fanout.ts`
- Test: `pi-workspace/test/fanout.test.ts`

**Interfaces:**
- Consumes: pi exports `createGrepToolDefinition`, `createFindToolDefinition`, `createLsToolDefinition` (confirmed exported from `pi/packages/coding-agent/src/index.ts`) and type `ToolDefinition`.
- Produces:
  - `type ToolFactory = (cwd: string) => ToolDefinition`
  - `fanOutTool(factory: ToolFactory, getFolders: () => string[]): ToolDefinition` (same `name`, `parameters`, `description` as `factory(process.cwd())`, `label` suffixed `(workspace)`)
  - Behaviour: with no folders attached, or when `params.path` is an absolute path, delegates once to `factory(ctx.cwd)`. Otherwise runs `factory(folder).execute(...)` for every folder with `ctx` overridden to `{ ...ctx, cwd: folder }`, and returns one text block per folder headed `## <folder>`; `details` is `{ folders: string[] }`.

The tests use a fake factory, so they do not depend on pi internals.

- [ ] **Step 1: Write the failing test**

```ts
// test/fanout.test.ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --run test/fanout.test.ts`
Expected: FAIL, cannot resolve `../src/fanout.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/fanout.ts
import { isAbsolute } from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

export type ToolFactory = (cwd: string) => ToolDefinition;

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content
		.filter((c) => c.type === "text")
		.map((c) => c.text ?? "")
		.join("\n");
}

export function fanOutTool(factory: ToolFactory, getFolders: () => string[]): ToolDefinition {
	const base = factory(process.cwd());
	return {
		...base,
		label: `${base.label} (workspace)`,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const folders = getFolders();
			const path = (params as { path?: unknown }).path;
			if (folders.length === 0 || (typeof path === "string" && isAbsolute(path))) {
				return factory(ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
			}
			const parts: string[] = [];
			for (const folder of folders) {
				try {
					const result = await factory(folder).execute(toolCallId, params, signal, undefined, { ...ctx, cwd: folder });
					parts.push(`## ${folder}\n${textOf(result as any)}`);
				} catch (e) {
					parts.push(`## ${folder}\nerror: ${(e as Error).message}`);
				}
			}
			return { content: [{ type: "text", text: parts.join("\n\n") }], details: { folders } } as any;
		},
	} as ToolDefinition;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest --run test/fanout.test.ts`
Expected: PASS. If Task 0 Q2 found that a custom `renderResult` is needed to keep the TUI readable, add it here in the same file and re-run.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: fan-out wrapper for grep, find and ls"
```

---

### Task 7: `/ws` command logic

**Files:**
- Create: `pi-workspace/src/commands.ts`
- Test: `pi-workspace/test/commands.test.ts`

**Interfaces:**
- Consumes: `Workspace`, `loadWorkspace`, `saveWorkspace`, `listWorkspaces`, `addFolder`, `removeFolder`, `validateName` from `src/store.ts`; `normalizeFolder` from `src/paths.ts`; `findMissing` from `src/prompt.ts`.
- Produces:
  - `interface WsUi { notify(msg: string, type?: "info" | "warning" | "error"): void; input(title: string, placeholder?: string): Promise<string | undefined>; select(title: string, options: string[]): Promise<string | undefined>; setStatus(key: string, text: string | undefined): void }`
  - `interface WsDeps { ui: WsUi; dir?: string; getCurrent(): Workspace | undefined; setCurrent(ws: Workspace | undefined): void; persist(name: string | undefined): void; home?: string }`
  - `runWsCommand(args: string, deps: WsDeps): Promise<void>`
  - `refreshStatus(ws: Workspace | undefined, ui: Pick<WsUi, "setStatus">): Promise<void>` (status key `workspace`: `ws: <name> (<n> folders)` or `... (<m> missing)`, cleared when no workspace)
  - Subcommands: `new <name>`, `add [path]`, `remove [path]`, `use <name>`, `list`. A path argument may be omitted; then `ui.input` asks for it (add) or `ui.select` offers current folders (remove). Anything else, or no args, calls `notify` with usage and changes nothing.

There is no native folder picker in pi's UI API, so folder choice is a path prompt (`ui.input`) with validation that the directory exists. This is a deliberate deviation from the spec's "folder picker" wording and is called out in the Review Focus.

- [ ] **Step 1: Write the failing test**

```ts
// test/commands.test.ts
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { refreshStatus, runWsCommand, type WsDeps } from "../src/commands.ts";
import { loadWorkspace, type Workspace } from "../src/store.ts";

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
		expect(current?.name).toBe("demo");
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --run test/commands.test.ts`
Expected: FAIL, cannot resolve `../src/commands.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/commands.ts
import { stat } from "node:fs/promises";
import { normalizeFolder } from "./paths.ts";
import { findMissing } from "./prompt.ts";
import {
	addFolder,
	listWorkspaces,
	loadWorkspace,
	removeFolder,
	saveWorkspace,
	validateName,
	type Workspace,
} from "./store.ts";

export interface WsUi {
	notify(msg: string, type?: "info" | "warning" | "error"): void;
	input(title: string, placeholder?: string): Promise<string | undefined>;
	select(title: string, options: string[]): Promise<string | undefined>;
	setStatus(key: string, text: string | undefined): void;
}

export interface WsDeps {
	ui: WsUi;
	dir?: string;
	home?: string;
	getCurrent(): Workspace | undefined;
	setCurrent(ws: Workspace | undefined): void;
	persist(name: string | undefined): void;
}

const USAGE = "Usage: /ws new <name> | add [path] | remove [path] | use <name> | list";

export async function refreshStatus(ws: Workspace | undefined, ui: Pick<WsUi, "setStatus">): Promise<void> {
	if (!ws) return ui.setStatus("workspace", undefined);
	const missing = await findMissing(ws.folders);
	const extra = missing.size ? `, ${missing.size} missing` : "";
	ui.setStatus("workspace", `ws: ${ws.name} (${ws.folders.length} folders${extra})`);
}

async function isDirectory(p: string): Promise<boolean> {
	try {
		return (await stat(p)).isDirectory();
	} catch {
		return false;
	}
}

async function attach(ws: Workspace, d: WsDeps): Promise<void> {
	d.setCurrent(ws);
	d.persist(ws.name);
	await refreshStatus(ws, d.ui);
}

async function save(ws: Workspace, d: WsDeps): Promise<void> {
	await saveWorkspace(ws, d.dir);
	d.setCurrent(ws);
	await refreshStatus(ws, d.ui);
}

export async function runWsCommand(args: string, d: WsDeps): Promise<void> {
	const [sub, ...rest] = args.trim().split(/\s+/).filter(Boolean);
	const arg = rest.join(" ");
	try {
		switch (sub) {
			case "new": {
				validateName(arg);
				if (await loadWorkspace(arg, d.dir)) return d.ui.notify(`Workspace "${arg}" already exists`, "warning");
				const ws: Workspace = { name: arg, folders: [] };
				await saveWorkspace(ws, d.dir);
				await attach(ws, d);
				return d.ui.notify(`Created workspace "${arg}". Use /ws add to add folders.`, "info");
			}
			case "use": {
				const ws = await loadWorkspace(arg, d.dir);
				if (!ws) return d.ui.notify(`Workspace "${arg}" not found`, "warning");
				await attach(ws, d);
				return d.ui.notify(`Attached workspace "${arg}"`, "info");
			}
			case "list": {
				const names = await listWorkspaces(d.dir);
				return d.ui.notify(names.length ? `Workspaces: ${names.join(", ")}` : "No workspaces yet", "info");
			}
			case "add": {
				const ws = d.getCurrent();
				if (!ws) return d.ui.notify("No workspace attached. Use /ws new <name> or /ws use <name>", "warning");
				const raw = arg || (await d.ui.input("Folder to add", "/path/to/folder"));
				if (!raw) return;
				const folder = normalizeFolder(raw, d.home);
				if (!(await isDirectory(folder))) return d.ui.notify(`${folder} is not an existing directory`, "error");
				await save(addFolder(ws, folder), d);
				return d.ui.notify(`Added ${folder}`, "info");
			}
			case "remove": {
				const ws = d.getCurrent();
				if (!ws) return d.ui.notify("No workspace attached. Use /ws new <name> or /ws use <name>", "warning");
				const raw = arg || (await d.ui.select("Folder to remove", ws.folders));
				if (!raw) return;
				await save(removeFolder(ws, raw), d);
				return d.ui.notify(`Removed ${normalizeFolder(raw, d.home)}`, "info");
			}
			default:
				return d.ui.notify(USAGE, "info");
		}
	} catch (e) {
		d.ui.notify((e as Error).message, "error");
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest --run test/commands.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: /ws command logic"
```

---

### Task 8: Extension entry and wiring

**Files:**
- Create: `pi-workspace/extensions/workspace.ts`
- Test: `pi-workspace/test/entry.test.ts`

**Interfaces:**
- Consumes: everything above; pi API: `registerFlag`, `getFlag`, `registerCommand`, `registerTool`, `on("session_start"|"before_agent_start"|"resources_discover")`, `appendEntry`, `ctx.sessionManager.getBranch()`, `ctx.ui`.
- Produces: default export `(pi: ExtensionAPI) => void`, the file pi loads. The custom-entry type name is the constant `ENTRY_TYPE = "pi-workspace"`, with data `{ name: string | null }`.

Behaviour:
- `session_start`: pick the workspace name from `--workspace` if set, else from the last `pi-workspace` custom entry on the branch. Load it. If it is not found and `ctx.hasUI`, offer to create it with `ui.confirm`; without UI, `notify` a warning and continue with no workspace. Then call `refreshStatus`.
- `before_agent_start`: if a workspace is attached, set `event.systemPromptOptions.sections.workspace = buildWorkspaceBlock(...)` and push the result of `collectContextFiles(ws.folders that exist, event.systemPromptOptions.contextFiles)` onto `contextFiles` (idempotent every turn).
- `resources_discover`: return `{ skillPaths: await discoverSkillPaths(existing folders, event.cwd) }` when attached, and `notify` any clashes from `findSkillClashes` once per attach.
- Tools: `registerTool(fanOutTool(createGrepToolDefinition, folders))` and the same for find and ls, reading folders from the current workspace on every call.

- [ ] **Step 1: Write the failing test**

```ts
// test/entry.test.ts
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import extension from "../extensions/workspace.ts";
import { saveWorkspace, workspacesDir } from "../src/store.ts";

function fakePi(flag?: string) {
	const handlers: Record<string, Function> = {};
	const commands: Record<string, any> = {};
	const tools: any[] = [];
	const entries: any[] = [];
	const pi: any = {
		registerFlag: () => {},
		getFlag: () => flag,
		registerCommand: (n: string, o: any) => void (commands[n] = o),
		registerTool: (t: any) => void tools.push(t),
		on: (e: string, h: Function) => void (handlers[e] = h),
		appendEntry: (type: string, data: unknown) => void entries.push({ type: "custom", customType: type, data }),
	};
	return { pi, handlers, commands, tools, entries };
}

function fakeCtx(cwd: string, branch: any[] = []) {
	const statuses: any[] = [];
	const notes: string[] = [];
	return {
		statuses,
		notes,
		ctx: {
			cwd,
			hasUI: true,
			sessionManager: { getBranch: () => branch },
			ui: {
				setStatus: (k: string, t: any) => void statuses.push([k, t]),
				notify: (m: string) => void notes.push(m),
				confirm: async () => false,
				input: async () => undefined,
				select: async () => undefined,
			},
		} as any,
	};
}

async function withHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
	const home = await mkdtemp(join(tmpdir(), "ws-home-"));
	const prev = process.env.HOME;
	process.env.HOME = home;
	try {
		return await fn(home);
	} finally {
		process.env.HOME = prev;
	}
}

describe("workspace extension", () => {
	it("registers /ws, the grep/find/ls overrides", () => {
		const { pi, commands, tools } = fakePi();
		extension(pi);
		expect(commands.ws).toBeDefined();
		expect(tools.map((t) => t.name).sort()).toEqual(["find", "grep", "ls"]);
	});

	it("injects the workspace block and instruction files, once, across repeated turns", async () => {
		await withHome(async (home) => {
			const folder = await mkdtemp(join(tmpdir(), "ws-f-"));
			await writeFile(join(folder, "AGENTS.md"), "rules for f");
			await saveWorkspace({ name: "demo", folders: [folder] }, workspacesDir(home));
			const { pi, handlers } = fakePi("demo");
			extension(pi);
			const { ctx } = fakeCtx(folder);
			await handlers.session_start({ type: "session_start" }, ctx);
			const event: any = { systemPromptOptions: { sections: {}, contextFiles: [] } };
			await handlers.before_agent_start(event, ctx);
			await handlers.before_agent_start(event, ctx);
			expect(event.systemPromptOptions.sections.workspace).toContain(folder);
			expect(event.systemPromptOptions.contextFiles).toEqual([
				{ path: join(folder, "AGENTS.md"), content: "rules for f" },
			]);
		});
	});

	it("does nothing when no workspace is attached", async () => {
		await withHome(async () => {
			const { pi, handlers } = fakePi(undefined);
			extension(pi);
			const { ctx } = fakeCtx("/x");
			await handlers.session_start({ type: "session_start" }, ctx);
			const event: any = { systemPromptOptions: { sections: {}, contextFiles: [] } };
			await handlers.before_agent_start(event, ctx);
			expect(event.systemPromptOptions.sections.workspace).toBeUndefined();
		});
	});

	it("restores the workspace from the last saved custom entry", async () => {
		await withHome(async (home) => {
			const folder = await mkdtemp(join(tmpdir(), "ws-r-"));
			await saveWorkspace({ name: "kept", folders: [folder] }, workspacesDir(home));
			const { pi, handlers } = fakePi(undefined);
			extension(pi);
			const branch = [{ type: "custom", customType: "pi-workspace", data: { name: "kept" } }];
			const { ctx } = fakeCtx(folder, branch);
			await handlers.session_start({ type: "session_start" }, ctx);
			const event: any = { systemPromptOptions: { sections: {}, contextFiles: [] } };
			await handlers.before_agent_start(event, ctx);
			expect(event.systemPromptOptions.sections.workspace).toContain("kept");
		});
	});

	it("warns and continues when --workspace names a missing workspace and there is no UI", async () => {
		await withHome(async () => {
			const { pi, handlers } = fakePi("ghost");
			extension(pi);
			const { ctx, notes } = fakeCtx("/x");
			ctx.hasUI = false;
			await handlers.session_start({ type: "session_start" }, ctx);
			expect(notes.join("\n")).toMatch(/ghost.*not found/);
		});
	});

	it("returns skill paths from existing folders on resources_discover", async () => {
		await withHome(async (home) => {
			const folder = await mkdtemp(join(tmpdir(), "ws-s-"));
			const { mkdir } = await import("node:fs/promises");
			await mkdir(join(folder, ".pi", "skills"), { recursive: true });
			await saveWorkspace({ name: "demo", folders: [folder] }, workspacesDir(home));
			const { pi, handlers } = fakePi("demo");
			extension(pi);
			const { ctx } = fakeCtx(folder);
			await handlers.session_start({ type: "session_start" }, ctx);
			const r = await handlers.resources_discover({ type: "resources_discover", cwd: folder, reason: "startup" }, ctx);
			expect(r.skillPaths).toEqual([join(folder, ".pi", "skills")]);
		});
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --run test/entry.test.ts`
Expected: FAIL, cannot resolve `../extensions/workspace.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// extensions/workspace.ts
import {
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { refreshStatus, runWsCommand } from "../src/commands.ts";
import { fanOutTool } from "../src/fanout.ts";
import { buildWorkspaceBlock, collectContextFiles, findMissing } from "../src/prompt.ts";
import { discoverSkillPaths, findSkillClashes } from "../src/skills.ts";
import { loadWorkspace, saveWorkspace, type Workspace } from "../src/store.ts";

export const ENTRY_TYPE = "pi-workspace";
const SUBCOMMANDS = ["new", "add", "remove", "use", "list"];

function restoreFromBranch(branch: any[]): string | undefined {
	for (let i = branch.length - 1; i >= 0; i--) {
		const e = branch[i];
		if (e?.type === "custom" && e.customType === ENTRY_TYPE) return e.data?.name ?? undefined;
	}
	return undefined;
}

export default function (pi: ExtensionAPI) {
	let current: Workspace | undefined;
	let clashesReported = false;

	pi.registerFlag("workspace", { type: "string", description: "Attach a saved workspace by name" });

	const folders = () => current?.folders ?? [];
	pi.registerTool(fanOutTool(createGrepToolDefinition, folders));
	pi.registerTool(fanOutTool(createFindToolDefinition, folders));
	pi.registerTool(fanOutTool(createLsToolDefinition, folders));

	pi.registerCommand("ws", {
		description: "Manage workspaces: new | add | remove | use | list",
		getArgumentCompletions: (prefix) => {
			const items = SUBCOMMANDS.filter((s) => s.startsWith(prefix)).map((s) => ({ value: s, label: s }));
			return items.length ? items : null;
		},
		handler: async (args, ctx) => {
			clashesReported = false;
			await runWsCommand(args, {
				ui: ctx.ui,
				getCurrent: () => current,
				setCurrent: (ws) => void (current = ws),
				persist: (name) => pi.appendEntry(ENTRY_TYPE, { name: name ?? null }),
			});
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		const flag = pi.getFlag("workspace");
		const name = typeof flag === "string" && flag ? flag : restoreFromBranch(ctx.sessionManager.getBranch());
		current = undefined;
		clashesReported = false;
		if (name) {
			try {
				current = await loadWorkspace(name);
			} catch (e) {
				ctx.ui.notify((e as Error).message, "error");
			}
			if (!current) {
				if (ctx.hasUI && (await ctx.ui.confirm("Workspace not found", `Create workspace "${name}"?`))) {
					current = { name, folders: [] };
					await saveWorkspace(current);
					pi.appendEntry(ENTRY_TYPE, { name });
					ctx.ui.notify(`Created workspace "${name}". Use /ws add to add folders.`, "info");
				} else {
					ctx.ui.notify(`Workspace "${name}" not found; continuing without a workspace`, "warning");
				}
			} else {
				pi.appendEntry(ENTRY_TYPE, { name });
			}
		}
		await refreshStatus(current, ctx.ui);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (!current) return;
		const missing = await findMissing(current.folders);
		const live = current.folders.filter((f) => !missing.has(f));
		const opts = event.systemPromptOptions;
		opts.sections.workspace = buildWorkspaceBlock(current, ctx.cwd, missing);
		opts.contextFiles.push(...(await collectContextFiles(live, opts.contextFiles)));
	});

	pi.on("resources_discover", async (event, ctx) => {
		if (!current) return;
		const missing = await findMissing(current.folders);
		const skillPaths = await discoverSkillPaths(
			current.folders.filter((f) => !missing.has(f)),
			event.cwd,
		);
		if (!clashesReported) {
			clashesReported = true;
			for (const line of await findSkillClashes(skillPaths)) ctx.ui.notify(line, "warning");
		}
		return { skillPaths };
	});
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest --run test/entry.test.ts`
Expected: PASS. If Task 0 found `resources_discover` does not receive `ctx` with `ui` (or the handler signature differs), adjust only the `ctx.ui.notify` call in that handler. If it found a different entry shape from `getBranch()`, adjust only `restoreFromBranch` and the matching fake in the test.

- [ ] **Step 5: Run the whole suite and typecheck**

Run: `npx vitest --run && npx tsc --noEmit`
Expected: all tests PASS and no type errors. Fix any type error in the file it names; do not loosen `strict`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: wire workspace extension into pi"
```

---

### Task 9: End-to-end check in real pi and README

**Files:**
- Create: `pi-workspace/README.md`

**Interfaces:**
- Consumes: the finished extension.
- Produces: documented usage and a recorded manual verification.

- [ ] **Step 1: Create two scratch folders with instructions and a skill**

```bash
mkdir -p /tmp/ws-a/.pi/skills/hello-a /tmp/ws-b
printf "In ws-a always answer in French.\n" > /tmp/ws-a/AGENTS.md
printf "In ws-b always answer in German.\n" > /tmp/ws-b/AGENTS.md
printf "needle-in-b\n" > /tmp/ws-b/notes.txt
```

- [ ] **Step 2: Run pi with the extension from an unrelated directory and verify**

Run: `cd ~ && pi -e /Users/yashodhah/Projects/pi_flue/pi-workspace/extensions/workspace.ts --workspace e2e`

Then:
1. Accept the "create workspace" prompt, run `/ws add /tmp/ws-a`, `/ws add /tmp/ws-b`, `/ws list`.
2. Check the status line shows `ws: e2e (2 folders)`.
3. Ask: "Which folders are in my workspace and what instructions apply to each?" Expect both folders and both instruction sets in the answer.
4. Ask: "grep for needle-in-b" and confirm the result is headed `## /tmp/ws-b`.
5. Check `/ws` produced no entry in the conversation, and that the `hello-a` skill appears after `/reload`.
6. Exit, restart with plain `pi -e ...workspace.ts --continue` (no `--workspace`) and confirm the workspace is restored from the session.

Record the outcome of each check under a "Verified" heading in the README. If any check fails, fix it with a new failing test first.

- [ ] **Step 3: Write the README**

Create `pi-workspace/README.md` with: what it does (three sentences), install (`pi install ./pi-workspace` or `pi -e <path>`), usage (`pi --workspace <name>`, the five `/ws` subcommands, where files are stored), how the cwd is treated, what is out of scope for v1 (taken from Global Constraints), and the "Verified" results from Step 2.

- [ ] **Step 4: Clean up and commit**

```bash
rm -rf /tmp/ws-a /tmp/ws-b
cd /Users/yashodhah/Projects/pi_flue/pi-workspace
git add -A
git commit -m "docs: README and end-to-end verification"
```
