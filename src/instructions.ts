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
