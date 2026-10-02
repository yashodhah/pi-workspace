# pi-workspace

A [pi](https://github.com/earendil-works/pi) extension that attaches several folders to one session as a named workspace. The model is told which folders belong to the workspace, and each folder's instruction file (`AGENTS.md` etc.) and skills are loaded alongside the session's own. `grep`, `find` and `ls` search every workspace folder when given a relative path (an absolute path, `~` or `@`-prefixed path runs once), and `read` already accepts absolute paths. Workspaces are saved per user and are restored when you resume a session.

**Requires pi >= 0.86.0** (the extension injects a prompt section through `systemPromptOptions.sections`, which older pi does not have). On pi < 0.86 only that prompt injection fails (the spike saw pi report an "Extension error" and carry on); the flag, `/ws`, the status line and the tools do not depend on `sections`.

## Install

```bash
pi install ./pi-workspace          # install as a pi package
pi -e /path/to/pi-workspace/extensions/workspace.ts   # or load for one run
```

## Usage

```bash
pi --workspace <name>
```

If `<name>` does not exist, pi asks whether to create it (in a non-interactive mode it warns and continues without a workspace). Without `--workspace`, a workspace used earlier in the session is restored from the session file, so `pi --continue` picks it up again. On a fresh start `--workspace` wins over a saved choice; on `/reload`, resume, fork and new-session the session's latest saved choice wins over the flag.

Inside a session, `/ws` manages the workspace:

| Command | Effect |
| --- | --- |
| `/ws new <name>` | Create an empty workspace and attach it |
| `/ws add [path]` | Add a folder (opens a folder browser when the path is omitted) |
| `/ws remove [path]` | Remove a folder (prompts with a list when omitted) |
| `/ws use <name>` | Attach an existing workspace |
| `/ws list` | List saved workspaces |

`/ws` with no or an unknown subcommand prints the usage text. `/ws` never sends anything to the model and adds nothing to the conversation: output goes through UI notifications and the state change is saved as a custom session entry, which is not part of the model context.

Notes:

- `/ws add` with no path opens a terminal folder browser (arrow keys and Enter) that starts in the parent of the session cwd. The options are: add this folder, up one level, home, type a path, cancel, then the subfolders. Hidden folders and `node_modules` are not listed. One folder is added per invocation. `/ws add <path>` still adds directly. `~`, relative paths, `..` and trailing slashes are normalized to one absolute path, and duplicates are ignored.
- Workspace files are stored as `~/.pi/workspaces/<name>.json`: `{ "name": string, "folders": string[] }`. Names must match `[A-Za-z0-9][A-Za-z0-9_-]{0,63}`; anything else (including `/`, `..` and spaces) is rejected.
- The status line shows `ws: <name> (<n> folders)` (`1 folder` for one), plus `, <k> missing` when folders have been deleted. A folder that has been deleted never crashes the session: the prompt marks it `(missing, skipped)`, and its instruction files and skills are left out. The fanned-out `grep`/`find`/`ls` also skip it (checked on every call), so the other folders still return their results; if every folder is missing, the tool runs once against the session cwd.
- Skills found in `.pi/skills`, `.claude/skills` and `.github/skills` of each folder are discovered when pi loads resources. A folder added with `/ws add`, or a different workspace attached with `/ws use`, needs `/reload` before its skills appear (or disappear). Skill name clashes are reported as warnings.
- Instruction files per folder: the first of `AGENTS.override.md`, `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, `CLAUDE.MD`, truncated with a note above 20000 characters. A file already loaded by pi (for example through its cwd walk) appears once.

## How the session cwd is treated

The cwd you start pi in stays the default for relative paths and for `bash`. If it is one of the workspace folders it is marked `(session cwd)` in the prompt; if it is inside a workspace folder or outside the workspace, the prompt says so. Only the workspace folders are searched by the fanned-out `grep`, `find` and `ls`: an absolute `path` argument, or one pi resolves to an absolute path (`~`, `~/...`, and either form with a leading `@`), runs the tool once with the session cwd as the base (whether or not the path is inside a workspace folder), and a relative or omitted path runs once per workspace folder with results headed `## <folder>`.

## Out of scope for v1

- Writes outside the cwd: `write`, `edit` and `bash` are not overridden (tool reach across folders is read-only).
- Semantic indexing: search is live `grep`/`find` only.
- Workspace trust.
- Shell subcommands: there is no separate CLI; management is `/ws` inside a session.

## Development

```bash
npm install
npm test
npx tsc --noEmit
```

## Verified

End-to-end checks against pi 1.0.0 (`node_modules/@earendil-works/pi-coding-agent`, model `openrouter/anthropic/claude-haiku-4.5`), started from `~` with `--no-extensions -e extensions/workspace.ts`, scratch folders `/tmp/ws-a` (AGENTS.md "answer in French", skill `hello-a`) and `/tmp/ws-b` (AGENTS.md "answer in German", `notes.txt` containing `needle-in-b`). There was no tmux, so the TUI was driven through a pseudo-terminal (python `pty` plus a terminal emulator to read the screen) and the rest through `pi --mode rpc` (JSON over stdin/stdout). The global `pi` (0.85.1) was not used because it lacks `systemPromptOptions.sections`.

| # | Check | Result | What was observed |
| --- | --- | --- | --- |
| 1 | Model sees both folders and both instruction sets | Observed, pass | RPC, `--workspace e2e`. Asked "Which folders are in my workspace and what instructions apply to each?"; the answer listed `/tmp/ws-a` (French) and `/tmp/ws-b` (German). The session file's system message has a `workspace` section listing both folders and a `project_context` with `<project_instructions path="/tmp/ws-a/AGENTS.md">` and `.../ws-b/AGENTS.md`. |
| 2 | grep result headed `## /tmp/ws-b` | Observed, pass | `grep needle-in-b` returned `## /tmp/ws-a\nNo matches found\n\n## /tmp/ws-b\nnotes.txt:1: needle-in-b`; the model quoted `## /tmp/ws-b`. |
| 3 | `/ws` produces no transcript entry | Observed, pass | RPC: `/ws new`, `add`, `list`, bare `/ws` and `/ws bogus` returned `disposition: handled`, and `get_messages` was empty after them. The session JSONL (after later RPC and TUI runs that also used `/ws add` and `/ws list`) contains no user message for any `/ws` command, only `custom` entries of type `pi-workspace`. |
| 4 | `hello-a` skill appears after reload | Partly observed | In the TUI, `/ws add /tmp/ws-c` (a folder with skill `hello-c`) left `/skill:hello-c` out of the autocomplete list; after `/reload` ("Reloaded keybindings, extensions, skills, ...") `/skill:hello-c` was listed and the workspace (3 folders) was still attached. `hello-a` itself was already listed at startup with `--workspace e2e`, since the flag attaches the workspace before resources load, and `/skill:hello-a` was offered in the autocomplete list. (A mistyped `/rskill:hello-a` prompt was also sent, the model read `/tmp/ws-a/.pi/skills/hello-a/SKILL.md` and replied `HELLO-A`; the `/skill:hello-a` command itself was not run.) `/reload` is not a built-in command in RPC mode, so it was only exercised in the TUI. |
| 5 | Workspace restored on `--continue` without `--workspace` | Observed, pass | RPC and TUI, `pi --continue` from `~`: the status line showed `ws: e2e (2 folders)`, the earlier 8 messages were restored, and asking "Which folders are in my workspace?" gave `/tmp/ws-a`, `/tmp/ws-b`. |
| 6 | Status line `ws: e2e (2 folders)` | Observed, pass | Real TUI footer showed `ws: e2e (2 folders)` after `--continue`, `ws: e2e (3 folders)` after `/ws add /tmp/ws-c`, and it persisted across `/reload`. RPC `setStatus` events carried the same text. |

Also observed in the TUI: `pi --workspace e2e-new` for a missing workspace shows the "Create workspace "e2e-new"?" dialog; accepting it creates `~/.pi/workspaces/e2e-new.json` and the status line shows `ws: e2e-new (0 folders)`.

Not verified live:

- The "create workspace" dialog in RPC mode. pi 1.0.0 awaits `session_start` before it starts reading stdin, so a dialog raised there is never answered and the process exits with code 0. This is a property of RPC startup, not of the extension; use `/ws new <name>` first in RPC, or a TUI. The non-UI "not found" path is covered by unit tests only.
- Rendering of the overridden `find`/`ls` in the TUI was not inspected. For `grep`, the restored transcript in the TUI showed the `## /tmp/ws-b` / `notes.txt:1: needle-in-b` result text, but the tool-call header styling was not examined; the tool results themselves were read from RPC events and the session file.
- `/ws add` folder browser in the real TUI (covered by unit tests only).
- `--continue` was checked with `~` as the cwd (outside the workspace); a cwd that is a workspace member was not run live and is covered by unit tests.
