# pi spike findings

Throwaway spike for the pi-workspace extension. Answers the open questions in
`docs/superpowers/specs/2026-10-03-pi-workspace-extension-design.md`.

**Test target:** `@earendil-works/pi-coding-agent@1.0.0` (npm `latest`, installed in a
temp dir), driven headlessly (`pi --mode rpc`, `pi -p`) with an isolated
`PI_CODING_AGENT_DIR`, `--session-dir`, `--continue`, and
`openrouter/anthropic/claude-haiku-4.5`. Source citations are to the pi checkout at
`/Users/yashodhah/Projects/pi_flue/pi` (HEAD `7fbbd5f4a`, v1.0.0 plus one unreleased
commit), under `packages/coding-agent/src/`.

Each answer is labelled **OBSERVED** (ran it) or **FROM SOURCE** (read only).

## Version requirement (found while running, affects the whole plan)

The `pi` CLI on this machine is **0.85.1**. It has no `systemPromptOptions.sections`
(`before_agent_start` gets only the older `BuildSystemPromptOptions`). OBSERVED: with
0.85.1 the spike's `event.systemPromptOptions.sections["spike"]` throws
`Cannot read properties of undefined (reading 'spike')`; pi reports "Extension error"
and carries on without it. `sections` and the per-turn system message were added in
**0.86.0** (commit `9e05370b2`, "Mid conversation system messages", first contained in
tag `v0.86.0`). Everything below is from 1.0.0, where it works.

**Plan line affected:** package metadata / README (Task that writes `package.json`):
require `@earendil-works/pi-coding-agent >= 0.86.0` and say so. The Prompt injector must
not assume `sections` exists on older pi.

## Q1. Do `sections` / `contextFiles` mutations persist across turns? Do they take effect?

**OBSERVED + FROM SOURCE. Per-run reset. Mutations take effect.**

- Turn 1 and turn 2 both logged `sectionAlreadyPresent=false`, and `contextFiles` was
  `0 -> 1` on every turn (never `1 -> 2`). Same after `/reload` and after `--continue`.
  (Base was 0 only because the spike ran with `--no-context-files`.)
- Source: `core/agent-session.ts:2015` passes `this._baseSystemPromptOptions` to
  `emitBeforeAgentStart`, which does `normalizeBuildSystemPromptOptions(...)`
  (`core/extensions/runner.ts:1416`). That function (`core/system-prompt.ts:54-70`) copies
  `sections`, `contextFiles`, `skills` and the rest, so handler edits never reach the
  base options.
- Effect: the session file shows the injected text reaching the prompt. The turn-1 system
  message has `sections.spike = "<spike>\nspike section set on turn 1\n</spike>"` and
  `sections.project_context` containing `<project_instructions path="/spike/AGENTS.md">`.
  `contextFiles` render into the `project_context` section.
- The system prompt is a transcript message (`role: "system"`, `content: ""`, `sections`)
  holding only the sections that **changed** since the previous system message. Turn 2
  had only `project_context` and `spike`; a turn whose prompt is unchanged records
  nothing new (turn 4 after reload recorded only `skills`, because `spike` and
  `project_context` were byte-identical to the previous ones). An idempotent injector
  that returns the same text each turn adds no transcript noise.
- Constraint: section names must match `/^[a-z][a-z0-9_-]*$/` and must not be
  `preamble`, or prompt building throws (`core/system-prompt.ts:52,137`). A name like
  `workspace` is fine.

**Plan line affected:** none. The injector is idempotent, as the brief anticipated.
Note only that the section key must be a lowercase tag name (use `workspace`).

## Q2. Same-name override of `grep` (and `find`/`ls`/`read`): works, and does the TUI render it?

**Override and execution: OBSERVED. TUI rendering: FROM SOURCE (no TUI available).**

- OBSERVED: registered `grep` with `{...createGrepToolDefinition(process.cwd()), label: "grep (spike override)", execute: wrapper}`.
  The model called `grep`; the wrapper's log line fired (`Q2 override grep execute called`),
  and the result was `a.txt:1: hello world`. `createGrepToolDefinition` is a public export.
- FROM SOURCE, replacement: `_refreshToolRegistry` builds the built-in map first, then
  `toolRegistry.set(tool.name, tool)` for each extension tool, so a same-name extension
  tool replaces the built-in (`core/agent-session.ts:3513-3516`; definition registry the
  same at ~`3470-3482`). Same mechanism as `examples/extensions/tool-override.ts`.
- FROM SOURCE, rendering: the TUI calls `withBuiltInRenderers(toolName, definition)`
  (`modes/interactive/interactive-mode.ts:2168`), which fills in `renderCall` and
  `renderResult` from the built-in renderers for that tool name when the extension
  definition has none (`core/tools/renderers/index.ts:51-67`; the example's header says
  the same). If neither exists, `ToolExecutionComponent` falls back to a generic
  text renderer (`modes/interactive/components/tool-execution.ts:~330-372`). So an
  override with no `renderCall`/`renderResult` renders like the built-in. The
  `label` only changes the display name where used.
- Not verified visually. This is the one answer not seen in a real TUI.

**Plan line affected:** none. Do not copy renderers; omit `renderCall`/`renderResult`.
Spread `createXToolDefinition(cwd)` and replace only `execute` (and `label`/`description`
if the fan-out behaviour needs describing to the model).

## Q3. Is `getFlag("workspace")` populated in the factory body? In `session_start`?

**OBSERVED + FROM SOURCE.**

- Factory body: `undefined` on every start (startup, `--continue`, and each reload's
  re-run of the factory).
- `session_start`: `"demo"` (reason `startup`, and again after `--continue`, and after
  reload with reason `reload`). When `--workspace` is not passed it is `undefined`.
- Source: flags are parsed before extensions load but applied after, so
  `getFlag` reads `pendingFlagValues` only once set (`core/extensions/loader.ts:367`).
  Flag values survive reload (`core/agent-session.ts:3614,3635` pass
  `previousFlagValues` into the rebuilt runtime).
- `session_start` reasons seen: `startup` for both a fresh run and `--continue`
  (not `resume`), `reload` for reload.

**Plan line affected:** none. Task 7 reads the flag in `session_start`, never in the
factory body.

## Q4. After `/spike hello`, does the transcript change? Shape of the `appendEntry` entry

**OBSERVED + FROM SOURCE.**

- `/spike hello` returned `disposition: "handled"` in RPC. `get_messages` shows no
  user message and no message of any kind for it; the session file contains no
  message entry for it. The handler runs and the text is not sent to the model.
  (Source: `core/agent-session.ts:1931`, `_tryExecuteExtensionCommand` runs before the prompt path.)
- `pi.appendEntry("pi-workspace-spike", { name: "hello" })` writes one line to the session
  file and `ctx.sessionManager.getBranch()` returns it as exactly:

  ```json
  {"type":"custom","customType":"pi-workspace-spike","data":{"name":"hello"},"id":"f0009579","parentId":"9afd48b7","timestamp":"2026-10-02T17:28:13.607Z"}
  ```

  So the discriminator is `type === "custom"`, the key is `customType`, the payload is
  `data` (matches `CustomEntry` in `core/session-manager.ts:128`).
- It survives restart: after `--continue`, `getBranch()` in `session_start` still returned
  the entry. It also survives `/reload`.
- It is not LLM context and not in `get_messages`.

**Plan line affected:** none. The shape is `{type:"custom", customType, data}`, which is
what Task 7's `restoreFromBranch` should already expect. Filter by
`e.type === "custom" && e.customType === "<key>"` and take the **last** match.

## Q5. Does `resources_discover` fire on `/reload`? Can a skill dir created after startup be picked up?

**OBSERVED + FROM SOURCE.**

- Fires on startup (`reason: "startup"`) and on reload (`reason: "reload"`). OBSERVED
  via `ctx.reload()` from an extension command, which is the same code path as the
  TUI's `/reload`: the TUI wires the command context `reload` to `handleReloadCommand`
  (`modes/interactive/interactive-mode.ts:1996`) -> `session.reload()`
  (`core/agent-session.ts:3612`), which emits `session_start{reload}` then
  `extendResourcesFromExtensions("reload")` (`:3648`). The literal `/reload` slash
  command is interactive-only and was not typed.
- A skill dir created after startup (and a path file written after startup) was picked
  up by returning its path on reload: `/skill:late2` appeared in `get_commands` right
  after the reload and the skill appeared in the next turn's `skills` section.
  Earlier run: same for `late`.
- Returning no paths on a later reload removes the skill again (`late` was gone after
  the next reload that did not return it). The loader rebuilds its path list on reload
  (`core/resource-loader.ts` `reload()`), then `extendResources` merges the returned paths
  (`:457`, `:473`).
- The skill is picked up by the *next turn's prompt*, not mid-turn. A skill added by
  a `/ws add` command therefore needs `ctx.reload()` (or a user `/reload`) to appear,
  as the spec already says ("skills may need a reload").

**Plan line affected:** none. Skill discovery returns paths from `resources_discover`;
a command that changes membership calls `ctx.reload()` if skills should appear
immediately.

## Q6. Two `skillPaths` with the same skill name: which wins, is a diagnostic shown?

**Winner: OBSERVED. Diagnostic and ordering rules: FROM SOURCE.**

- OBSERVED: returned `["/tmp/.../skills1", "/tmp/.../skills2"]`, each containing a skill
  named `dup`. `get_commands` listed one `skill:dup` with path `skills1/dup/SKILL.md`,
  and only one `dup` appeared in the prompt's `skills` section. **First path wins.**
- FROM SOURCE: `loadSkills` keeps the first skill seen per name and records a
  `collision` diagnostic for each later one (`core/skills.ts:433-434`), listing
  winner and loser paths. The TUI shows it under a **"[Skill conflicts]"** heading as
  `"dup" collision:` with a check mark on the winner and `(skipped)` on losers
  (`modes/interactive/interactive-mode.ts:1891`, `formatDiagnostics`). It is shown on
  startup (`showDiagnosticsWhenQuiet`) and after reload. No RPC/event is emitted
  for it that an extension can hook, so the extension must still report clashes itself
  (the spec already says "the clash is reported").
- Precedence versus pi's own discovery: extension paths are appended with
  `mergePaths(this.lastSkillPaths, extensionPaths)` after pi's own resolved paths
  (`core/resource-loader.ts:473`), so a same-named skill pi already found wins over one
  an extension returns. In practice the skills in the session cwd's `.pi/skills` are
  already loaded by pi and win; an extension-supplied skill with that name is skipped.
- Paths are de-duplicated by canonical path (`mergePaths`), and the same file via a
  symlink is skipped silently.

**Plan line affected:** none. Return the cwd folder's skill dirs first, then the rest in
list order, to get "cwd wins, then first folder". Detect and report clashes in the
extension itself (do not rely on pi's diagnostic reaching the user in non-TUI modes).

## Summary

| Q | Result | Plan impact |
|---|---|---|
| Version | needs pi >= 0.86.0 (`sections`); installed CLI is 0.85.1 | add engine/peer requirement and docs note |
| Q1 | per-run reset, takes effect | none (idempotent injector; section name lowercase tag) |
| Q2 | override works; built-in renderers apply by name (source) | none (omit renderers) |
| Q3 | `getFlag`: factory `undefined`, `session_start` populated | none |
| Q4 | no transcript output; entry is `{type:"custom", customType, data, id, parentId, timestamp}` | none |
| Q5 | fires on reload; later-created dir picked up | none |
| Q6 | first path wins; TUI shows "[Skill conflicts]" | none |

No stop condition hit: Q1 mutations take effect, and the Q2 override executes and has
built-in renderer fallback.
