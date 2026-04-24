import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type TSchema, Type } from "@sinclair/typebox";

export const RPIV_SPECIALISTS = [
	"claim-verifier",
	"codebase-analyzer",
	"codebase-locator",
	"codebase-pattern-finder",
	"diff-auditor",
	"general-purpose",
	"integration-scanner",
	"peer-comparator",
	"precedent-locator",
	"test-case-locator",
	"thoughts-analyzer",
	"thoughts-locator",
	"web-search-researcher",
] as const;

export const PI_SUBAGENTS_BUILTINS = [
	"scout",
	"planner",
	"worker",
	"reviewer",
	"context-builder",
	"researcher",
	"delegate",
	"oracle",
	"oracle-executor",
] as const;

const AGENT_ENUM: string[] = [...RPIV_SPECIALISTS];

// Curated tool description loaded once at module init — replaces upstream's
// literal wholesale instead of regex-editing it. Avoids the drift-fragility of
// matching template-literal fragments; we own every byte the LLM sees.
const CURATED_TOOL_DESCRIPTION = readFileSync(
	fileURLToPath(new URL("./prompts/subagent-description.txt", import.meta.url)),
	"utf8",
).trimEnd();

export function getCuratedSubagentDescription(): string {
	return CURATED_TOOL_DESCRIPTION;
}

interface TypeBoxObject {
	properties: Record<string, TSchema>;
}

function isTypeBoxObject(schema: unknown): schema is TypeBoxObject {
	return typeof schema === "object" && schema !== null && "properties" in schema;
}

// Rebuild via Type.Object (not shallow spread) so TypeBox regenerates the
// Symbol-keyed kind markers + compiler hooks that a plain clone would drop.
// agentEnumDescription is injected (not imported directly) to keep this module
// free of the agent-catalog's fs side-effect at load time — test-only callers
// can substitute a stub.
export function rewriteSubagentParameters<T>(original: T, agentEnumDescription: string): T {
	if (!isTypeBoxObject(original)) return original;
	const rebuilt = Type.Object({
		...original.properties,
		agent: Type.Optional(Type.String({ enum: AGENT_ENUM, description: agentEnumDescription })),
	});
	return rebuilt as unknown as T;
}

// Matches a single "- <name> (<source>, disabled): <desc>" row as produced by
// handleList in pi-subagents@0.17.5/agent-management.ts:375. The `(builtin,
// disabled)` suffix is the load-bearing literal — source="user" / "project"
// rows never carry the ", disabled" tag, so this regex is safe to apply to the
// full text block without parsing sections. The `.*(?:\r?\n|$)` trailing group
// consumes the row's newline so removed rows don't leave blank lines behind,
// with an alternation for the EOF case (no trailing newline).
const DISABLED_ROW_REGEX = /^- .+ \([^)]+, disabled\): .*(?:\r?\n|$)/gm;

// Drift guard anchor — the exact literal suffix handleList interpolates when
// an agent is disabled. If upstream renames the tag (e.g. "(builtin, off)"),
// the test fixture fails BEFORE the filter's behavioural test, pinpointing
// the stale literal instead of reporting an empty match.
export const LIST_FILTER_SNAPSHOT_FRAGMENT = ", disabled): ";

export function filterDisabledFromListResult(text: string | undefined): string | undefined {
	if (text === undefined) return undefined;
	return text.replace(DISABLED_ROW_REGEX, "");
}
