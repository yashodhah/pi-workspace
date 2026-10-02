# `/ws add` folder browser

Status: approved in conversation. Date: 2026-10-03.

## Goal

`/ws add` with no path lets the user navigate folders in the terminal instead of
typing an absolute path. Pi has no native folder dialog, so the browser is a loop
over the existing `ui.select`.

## Behavior

- `/ws add <path>` is unchanged: adds directly.
- `/ws add` (no argument) opens the browser, starting in the parent directory of the session cwd (so the
  cwd and its sibling projects are listed). If the cwd is the filesystem root, it
  starts at the root.
- Each screen shows the current absolute path as the title. Options, in order:
  1. `✓ Add this folder` (suffixed `(already added)` when the folder is a member)
  2. `.. (up one level)` (omitted at the filesystem root)
  3. `~ (home)`
  4. `⌨ Type a path…` (falls back to the existing `ui.input` prompt)
  5. `✗ Cancel`
  6. Subfolders as `name/`, sorted alphabetically
- Hidden entries (names starting with `.`) and `node_modules` are omitted. There is
  no show-hidden toggle; `Type a path…` covers that case.
- Choosing a subfolder descends. `✓ Add this folder` adds the current directory via
  the existing add logic (normalize, dedupe, save, status refresh) and ends the
  browser. Escape or `✗ Cancel` ends it with nothing added. One add per invocation.
- Lists are capped at 200 subfolders; if more exist, an informational option
  `… N more, use Type a path` is appended; choosing it just redisplays the same screen.
- An unreadable directory (EACCES etc.) produces a warning via `notify` and the
  browser stays on the previous directory.
- Choosing `✓ Add this folder` for an already-added folder is a no-op with an info
  notification.

## Components

- `src/browse.ts` (new, pure over injected deps):
  - `listSubfolders(dir: string): Promise<{ names: string[]; more: number }>`
    (visible directories only, sorted, capped at 200, `more` = omitted count;
    throws on unreadable dir)
  - `browseForFolder(ui: Pick<WsUi, "select" | "input" | "notify">, startDir: string, existing: readonly string[], home?: string): Promise<string | undefined>`
    returns the chosen absolute folder, or `undefined` on cancel.
- `src/commands.ts`: `WsDeps` gains `cwd: string`. The `add` case with no argument
  calls `browseForFolder(d.ui, dirname(d.cwd), ws.folders, d.home)`; the existing
  directory validation and `addFolder`/`save` path is reused for the result.
- `extensions/workspace.ts`: passes `cwd: ctx.cwd` into `runWsCommand`.
- `WsUi` is unchanged.

## Out of scope

Multi-select/multi-add, show-hidden toggle, type-to-filter, a custom TUI
component (considered; rejected for RPC/no-UI compatibility and testability).

## Testing

Real temp directory trees and the existing fake UI with a scripted `select`
queue: descend then add; go up; `~` jumps to the injected home; cancel via
`✗ Cancel` and via `undefined`; hidden and `node_modules` omitted; cap line
appears past 200; starts in the parent of the cwd (cwd listed as a subfolder); cwd at `/` starts at `/`;
unreadable directory warns and stays; `Type a path…` uses
`ui.input`; already-added folder is a no-op; `/ws add <path>` unchanged and does
not open the browser; entry-level test that `cwd` is plumbed through.
