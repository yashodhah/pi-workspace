import { isAbsolute } from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { findMissing } from "./prompt.ts";

// pi's factories return ToolDefinition<SpecificSchema, SpecificDetails>, which is not
// assignable to the default ToolDefinition (renderCall args are contravariant), so widen here.
export type ToolFactory = (cwd: string) => ToolDefinition<any, any, any>;

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content
		.filter((c) => c.type === "text")
		.map((c) => c.text ?? "")
		.join("\n");
}

// pi's grep/find/ls resolve `path` with resolveToCwd: a leading "@" is stripped and "~" expanded,
// so those forms are as direct as an absolute path.
function isDirectPath(path: string): boolean {
	const p = path.startsWith("@") ? path.slice(1) : path;
	return isAbsolute(p) || p === "~" || p.startsWith("~/");
}

export function fanOutTool(factory: ToolFactory, getFolders: () => string[]): ToolDefinition {
	const base = factory(process.cwd());
	return {
		...base,
		label: `${base.label} (workspace)`,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const path = (params as { path?: unknown }).path;
			const configured = typeof path === "string" && isDirectPath(path) ? [] : getFolders();
			const missing = await findMissing(configured);
			const folders = configured.filter((f) => !missing.has(f));
			if (folders.length === 0) {
				return factory(ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
			}
			const parts: string[] = [];
			for (const folder of folders) {
				try {
					const result = await factory(folder).execute(toolCallId, params, signal, undefined, { ...ctx, cwd: folder });
					parts.push(`## ${folder}\n${textOf(result as any)}`);
				} catch (e) {
					if (signal?.aborted) throw e;
					parts.push(`## ${folder}\nerror: ${(e as Error).message}`);
				}
			}
			return { content: [{ type: "text", text: parts.join("\n\n") }], details: { folders } } as any;
		},
	} as ToolDefinition;
}
