# pi-workspace: multi-folder workspaces for pi

Status: draft for review. Date: 2026-10-03.

## Goal

A pi extension that lets a user group several local folders into a named
workspace, attach it to a pi session, and have the model see all of the folders
(their layout, instruction files and skills) the way VS Code multi-root
workspaces work with Copilot Chat.

Success: a user can create a workspace, add and remove folders, start pi with
`pi --workspace <name>` from any directory, and the model can read and search
every folder with each folder's instructions and skills loaded, without any
setup outside pi.

## Decisions made

- Workspaces are per user: stored in `~/.pi/`, usable from any directory.
- No separate CLI. Entry point is `pi --workspace <name>`; management is `/ws`
  commands inside the session.
- The session cwd is just one member of the workspace, never special-cased
  beyond being marked "(session cwd)" and being the default for relative paths
  and `bash`.
- v1 tool reach is read-only across all folders. `write`, `edit` and `bash`
  stay in the cwd.
- Skills from workspace folders are in v1.

## Out of scope for v1

Writes or `bash` outside the cwd, workspace trust, semantic indexing (out of
scope; search is live `grep`/`find` only), a cross-session workspace file
format, shell subcommands (pi does not allow extensions to add them).

## Facts this design rests on (from pi source, verified by subagent)

- Extension = TS/JS module, default export `(pi: ExtensionAPI) => void`, loaded
  from `.pi/extensions/`, `~/.pi/agent/extensions/`, `-e` or installed packages.
- `pi.registerFlag` flags are parsed before extensions load and matched after;
  `pi --workspace foo` works if `workspace` is registered as a string flag.
- `/cmd` input matching an extension command runs the handler only; it is not
  sent to the model, not written to the transcript, and does not fire `input`.
- `pi.appendEntry` persists to the session file but is not LLM context.
  `sendMessage` and `sendUserMessage` do enter context.
- `before_agent_start` exposes mutable `systemPromptOptions` (`sections`,
  `contextFiles`, ...).
- Registering a tool with a built-in's name replaces it. Tools take one cwd
  string and do not sandbox absolute paths.
- `resources_discover` can return `skillPaths`.
- `ctx.cwd` is fixed per session; no setter found.

## Components

| Unit | Job | Depends on |
|---|---|---|
| Store | Read/write workspace JSON in `~/.pi/`; normalize and de-duplicate absolute paths | filesystem |
| Instruction loader | For a folder, find `AGENTS.md` / `CLAUDE.md`, return `{path, content}`, truncate if oversized | Store output |
| Skill discovery | For each folder, find skill dirs (`.pi/skills`, `.claude/skills`, `.github/skills`) and return them from `resources_discover` | Store |
| Prompt injector | On `before_agent_start`, add the workspace block and each folder's instructions | Store, loader |
| Multi-root tools | Same-name overrides of `read`, `grep`, `find`, `ls` that fan out over every folder | Store, pi tool factories |
| Commands and flag | `/ws new\|add\|remove\|use\|list`, folder picker, `--workspace`, status line | Store, UI |
| Session state | Remember the attached workspace via `appendEntry`, restore on `session_start` | pi session |

## Data format

`~/.pi/workspaces/<name>.json`:

```json
{ "name": "myproject", "folders": ["/abs/path/a", "/abs/path/b"] }
```

Hand-editable. Paths are stored absolute and de-duplicated.

## Behavior

Start: `--workspace <name>` loads the workspace. An unknown name offers to
create it (folder picker at session start; nothing sent to the model).

Commands (no context cost): `new`, `add`, `remove`, `use <name>`, `list`.
Changes take effect on the next turn; skills may need a reload.

Prompt each turn:
- A workspace block listing the folders, with "(session cwd)" on the cwd folder.
- Each folder's instruction files, labelled by folder, with a hint to apply each
  set to its own folder.
- Anything pi already loaded from the cwd walk is skipped (dedupe by absolute
  path) so nothing appears twice.

Overlap rules: all paths normalized; cwd inside a workspace folder is shown as
current and the parent stays a member; cwd outside the workspace is shown as
current but separate.

Tools: `grep`, `find`, `ls` are overridden to search every folder (given a
relative or no path) and label results by folder; given an absolute path they
run once. `read` is not overridden, because it already accepts absolute paths
in any folder. The folder "picker" is a path prompt with validation, since
pi's UI API has no native folder dialog. Same skill name in two folders: cwd wins, then first folder in the
list, and the clash is reported.

## Error handling

- Missing folder: skipped, flagged in the status line, no crash.
- Corrupt JSON: report the error, attach nothing.
- Unknown workspace name: offer to create.
- Oversized instruction file: truncate with a note.

## Open questions to test first (throwaway spike)

1. Do `contextFiles` / `sections` changes in `before_agent_start` last across
   turns or only for one run?
2. Does same-name overriding of `read`, `grep`, `find`, `ls` work cleanly,
   including TUI rendering?
3. Does `getFlag` work in the extension factory, or only in `session_start`?
4. Does a `/ws` handler add nothing to the transcript, as the routing code
   suggests?
5. Does `resources_discover` run on `/reload`, and can skill paths be added
   mid-session?

If any fail, adjust the affected component only; the Store and data format do
not change.

## Testing

Unit tests for Store, Instruction loader, dedupe/overlap rules and skill
precedence. The multi-root tools get tests against temporary directories.
Command handlers and prompt injection get tested against a fake `ExtensionAPI`.
The five spike questions become integration checks against real pi.

## v2 (ideas only, not planned for implementation now)

Goal: keep the model workspace-aware without flooding the context window for a
given task. Borrowed from how Copilot Chat budgets context (capped tool results,
search delegated to a subagent), using pi's own mechanisms. Every item below
has no generated or managed files.

1. **Folder descriptions**: optional one-line `description` per folder in the
   workspace JSON, written by the user, shown in the workspace block (a routing
   table, about 20 tokens per folder). Descriptions are per workspace.
2. **Capped search tools**: `grep`/`find`/`ls` get per-folder and total result
   caps, counts first with a hint to narrow, and a `folder` scope parameter.
   Cheap enough that it may move into v1 Task 6.
3. **`/ws focus a,b`**: full detail (instructions, skills) only for focused
   folders; the rest stay as one-line entries and contribute no skills.
   `/ws focus all` resets. Focus is per session, applied on the next reload.
4. **Search scout**: a `workspace_search` tool that spawns a read-only `pi`
   subprocess per folder (as `examples/extensions/subagent` does, with `cwd` =
   the folder and `--tools read,grep,find,ls`) and returns a short summary with
   paths. The workspace block says when to prefer it over `grep`: fuzzy
   questions, not exact strings. Costs a model run per call.
5. **Lazy instructions**: load a folder's `AGENTS.md` on the first tool call that
   touches that folder. Unverified: needs a pi hook for it; spike first.
6. **Overviews are written by the repo owners**: a repo that wants an overview
   ships a skill in `<folder>/.pi/skills/`, which v1 already loads. Keep
   `AGENTS.md` short (it is always loaded) and put long material in skills.
   Optional later: a bundled `/overview` prompt template that asks the agent to
   draft that `SKILL.md` into the repo for the user to review and commit.

### Considered and dropped: `/ws init`

An LLM-generated overview skill per folder, stored under `~/.pi/` and loaded
through `resources_discover`. Dropped because it is fragile and unproven:
overviews keyed by folder path orphan when a folder moves, go stale without
notice, cost one model run per folder, and make the extension write files the
user did not write. Its value over `grep` is not shown (VS Code ships nothing
like it). Revisit only if v1/v2 use shows that models cannot orient themselves
in a workspace from descriptions, repo-owned skills and the scout.

### Multiple workspaces

Each workspace is its own file in `~/.pi/workspaces/`. A session is attached to
one workspace at a time; `/ws use <name>` switches it and reloads. Different
terminals can run different workspaces; saves are atomic and the last save wins.

### Dynamic skill loading (checked)

Per-workspace skills work through `resources_discover`, which pi runs on startup
and on every reload; `ctx.reload()` from a command triggers it. The spike (Q5)
confirmed a skill directory created mid-session was picked up after reload and
shown in the next turn's skills section, and pi's `skills.md` says to run
`/reload` after editing a skill. Limits: a new skill appears from the next turn,
not mid-turn; a directory no longer returned is removed on the next reload; pi's
own skills (cwd, global) always load and win name clashes; on a clash the first
path wins. That `resources_discover` runs after `session_start` on startup is
inferred from source, not observed; check it in the integration tests.

## Project location

New package at `/Users/yashodhah/Projects/pi_flue/pi-workspace/`, separate from
the `pi/` and `vscode/` checkouts, installable as a pi package.
