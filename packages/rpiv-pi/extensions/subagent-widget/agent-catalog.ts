// Loads per-agent descriptions from packages/rpiv-pi/agents/<name>.md YAML
// frontmatter so the `agent` tool parameter can carry a rich enum-with-table
// description instead of duplicating copy across the monorepo. Runs once at
// module init; crashes loudly if an expected agent file is missing.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { RPIV_SPECIALISTS } from "./hide-builtin-subagents.js";

// extensions/subagent-widget/agent-catalog.ts → packages/rpiv-pi/agents/
// URL form matches the monorepo idiom (see root guidance: prompts loaded via
// `fileURLToPath(new URL("./prompts/…", import.meta.url))`) and cross-platform
// safely handles both POSIX and Windows file URLs.
const AGENTS_DIR = fileURLToPath(new URL("../../agents/", import.meta.url));

// Splits a markdown file on its leading `---` frontmatter fences and parses
// the YAML block. Returns undefined when no frontmatter is present.
function extractFrontmatter(content: string): Record<string, unknown> | undefined {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) return undefined;
	const parsed = parseYaml(match[1]) as unknown;
	if (typeof parsed !== "object" || parsed === null) return undefined;
	return parsed as Record<string, unknown>;
}

export interface AgentCatalogEntry {
	readonly name: string;
	readonly description: string;
}

function loadAgentEntry(name: string): AgentCatalogEntry {
	const path = join(AGENTS_DIR, `${name}.md`);
	const content = readFileSync(path, "utf8");
	const fm = extractFrontmatter(content);
	if (!fm) throw new Error(`agent-catalog: ${name}.md has no YAML frontmatter`);
	const description = fm.description;
	if (typeof description !== "string" || description.length === 0) {
		throw new Error(`agent-catalog: ${name}.md frontmatter is missing a string 'description'`);
	}
	return { name, description };
}

// Eager load at module init: one readFileSync per specialist. Failure modes
// (missing file, missing description) fail Pi's boot rather than surfacing as
// a runtime tool-registration error — consistent with rpiv-todo / rpiv-advisor
// loading their prompts at module init.
export const AGENT_CATALOG: ReadonlyArray<AgentCatalogEntry> = RPIV_SPECIALISTS.map(loadAgentEntry);

// Flattens the catalog into the LLM-facing string used as the `agent` param's
// `description`. Format: header line + "- <name>: <desc>" bullets. Keeps the
// list parameter-adjacent so the LLM sees agent capabilities inline with the
// enum choice instead of having to cross-reference a separate doc.
export function buildAgentEnumDescription(): string {
	const bullets = AGENT_CATALOG.map((entry) => `- ${entry.name}: ${entry.description}`).join("\n");
	return `Agent name (SINGLE mode) or target for management get/update/delete. Options:\n${bullets}`;
}
