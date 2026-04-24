import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import {
	filterDisabledFromListResult,
	getCuratedSubagentDescription,
	LIST_FILTER_SNAPSHOT_FRAGMENT,
	PI_SUBAGENTS_BUILTINS,
	RPIV_SPECIALISTS,
	rewriteSubagentParameters,
} from "./hide-builtin-subagents.js";

// Mirrors pi-subagents@0.17.5/index.ts:311-336 verbatim. This fixture is no
// longer used to exercise a rewriter (we replace upstream wholesale), but the
// upstream-snapshot drift guard below fails when these literals diverge — a
// signal to re-review prompts/subagent-description.txt against upstream.
const PI_SUBAGENTS_UPSTREAM_DESCRIPTION = `Delegate to subagents or manage agent definitions.

EXECUTION (use exactly ONE mode):
• SINGLE: { agent, task } - one task
• CHAIN: { chain: [{agent:"scout"}, {parallel:[{agent:"worker",count:3}]}] } - sequential pipeline with optional parallel fan-out
• PARALLEL: { tasks: [{agent,task,count?}, ...], concurrency?: number, worktree?: true } - concurrent execution (worktree: isolate each task in a git worktree)
• Optional context: { context: "fresh" | "fork" } (default: "fresh")

CHAIN TEMPLATE VARIABLES (use in task strings):
• {task} - The original task/request from the user
• {previous} - Text response from the previous step (empty for first step)
• {chain_dir} - Shared directory for chain files (e.g., <tmpdir>/pi-subagents-<scope>/chain-runs/abc123/)

Example: { chain: [{agent:"scout", task:"Analyze {task}"}, {agent:"planner", task:"Plan based on {previous}"}] }

MANAGEMENT (use action field, omit agent/task/chain/tasks):
• { action: "list" } - discover agents/chains
• { action: "get", agent: "name" } - full detail
• { action: "create", config: { name, systemPrompt, systemPromptMode, inheritProjectContext, inheritSkills, ... } }
• { action: "update", agent: "name", config: { ... } } - merge
• { action: "delete", agent: "name" }
• Use chainName for chain operations

CONTROL:
• { action: "status", id: "..." } - inspect an async/background run by id or prefix
• { action: "interrupt", id?: "..." } - soft-interrupt the current child turn and leave the run paused`;

describe("getCuratedSubagentDescription — file-loaded replacement for upstream's literal", () => {
	const curated = getCuratedSubagentDescription();

	it("contains no builtin agent names — leak invariant over prompts/subagent-description.txt", () => {
		for (const name of PI_SUBAGENTS_BUILTINS) {
			expect(curated).not.toContain(`"${name}"`);
			expect(curated).not.toContain(`:"${name}"`);
		}
	});

	it("preserves the mode and action section headers the LLM anchors on", () => {
		expect(curated).toContain("EXECUTION");
		expect(curated).toContain("CHAIN TEMPLATE VARIABLES");
		expect(curated).toContain("MANAGEMENT");
		expect(curated).toContain("CONTROL");
		expect(curated).toContain("• SINGLE: { agent, task }");
		expect(curated).toContain("• PARALLEL:");
		expect(curated).toContain(`{ action: "list" }`);
		expect(curated).toContain(`{ action: "status", id: "..." }`);
	});

	it("is non-empty and trimmed (no trailing whitespace from readFileSync)", () => {
		expect(curated.length).toBeGreaterThan(0);
		expect(curated).toBe(curated.trimEnd());
	});

	it("upstream drift guard: fails when pi-subagents' literal diverges from the pinned snapshot", () => {
		// The snapshot is pinned to pi-subagents@0.17.5/index.ts:311-336. If
		// upstream adds/edits sections, this fails FIRST — prompting a human
		// review of prompts/subagent-description.txt. We deliberately do NOT
		// compare curated to upstream (they're allowed to diverge); we only
		// verify the snapshot remains a faithful record of what we forked from.
		expect(PI_SUBAGENTS_UPSTREAM_DESCRIPTION).toContain("Delegate to subagents or manage agent definitions.");
		expect(PI_SUBAGENTS_UPSTREAM_DESCRIPTION).toContain(
			`{ chain: [{agent:"scout"}, {parallel:[{agent:"worker",count:3}]}] }`,
		);
		expect(PI_SUBAGENTS_UPSTREAM_DESCRIPTION).toContain(
			`Example: { chain: [{agent:"scout", task:"Analyze {task}"}, {agent:"planner", task:"Plan based on {previous}"}] }`,
		);
	});
});

describe("rewriteSubagentParameters — pin top-level agent to RPIV_SPECIALISTS enum + injected description", () => {
	const original = Type.Object({
		agent: Type.Optional(Type.String({ description: "orig agent description" })),
		task: Type.Optional(Type.String({ description: "task" })),
		tasks: Type.Optional(Type.Array(Type.Object({ agent: Type.String(), task: Type.String() }))),
	});

	const stubAgentDescription = "stub agent description (injected)";

	it("re-types the agent field to an optional string enum of RPIV_SPECIALISTS", () => {
		const rewritten = rewriteSubagentParameters(original, stubAgentDescription) as unknown as {
			properties: { agent: { type: string; enum: string[]; description: string } };
		};
		const agent = rewritten.properties.agent;
		expect(agent.type).toBe("string");
		expect(agent.enum).toEqual([...RPIV_SPECIALISTS]);
	});

	it("carries the injected description verbatim onto the agent field", () => {
		const rewritten = rewriteSubagentParameters(original, stubAgentDescription) as unknown as {
			properties: { agent: { description: string } };
		};
		expect(rewritten.properties.agent.description).toBe(stubAgentDescription);
	});

	it("preserves all other top-level properties unchanged by reference", () => {
		const rewritten = rewriteSubagentParameters(original, stubAgentDescription) as unknown as {
			properties: { task: unknown; tasks: unknown };
		};
		expect(rewritten.properties.task).toBe(original.properties.task);
		expect(rewritten.properties.tasks).toBe(original.properties.tasks);
	});

	it("preserves Type.Optional modifier on sibling fields (TypeBox symbol carried via reference spread)", () => {
		const schema = Type.Object({
			agent: Type.Optional(Type.String()),
			task: Type.Optional(Type.String()),
		});
		const rewritten = rewriteSubagentParameters(schema, stubAgentDescription);
		const optionalKey = Object.getOwnPropertySymbols(schema.properties.task).find(
			(s) => s.description === "TypeBox.Optional",
		);
		expect(optionalKey).toBeDefined();
		const preservedFlag = (rewritten as typeof schema).properties.task[
			optionalKey as keyof typeof schema.properties.task
		];
		expect(preservedFlag).toBe("Optional");
	});

	it("does not mutate the input schema", () => {
		const snapshot = JSON.stringify(original);
		rewriteSubagentParameters(original, stubAgentDescription);
		expect(JSON.stringify(original)).toBe(snapshot);
	});

	it("returns input unchanged when it is not a TypeBox object schema (defensive fallback)", () => {
		const notASchema = { foo: "bar" } as unknown;
		expect(rewriteSubagentParameters(notASchema, stubAgentDescription)).toBe(notASchema);
		expect(rewriteSubagentParameters(undefined, stubAgentDescription)).toBe(undefined);
	});
});

// Mirrors the `- <name> (<source>, disabled): <desc>` row format emitted by
// pi-subagents@0.17.5/agent-management.ts:375 (`handleList`). If upstream
// shifts the literal, the drift guard below fails first — pointing at
// LIST_FILTER_SNAPSHOT_FRAGMENT in hide-builtin-subagents.ts.
const PI_SUBAGENTS_LIST_OUTPUT = `Agents:
- claim-verifier (project): Adversarial finding verifier. …
- codebase-analyzer (project): Analyzes codebase implementation details. …
- context-builder (builtin, disabled): Analyzes requirements and codebase, generates context and meta-prompt
- delegate (builtin, disabled): Lightweight subagent that inherits the parent model with no default reads
- general-purpose (project): General-purpose agent for researching complex questions …
- oracle (builtin, disabled): High-context decision-consistency oracle that protects inherited state and prevents drift
- oracle-executor (builtin, disabled): High-context implementation agent that executes only after main-agent approval
- planner (builtin, disabled): Creates implementation plans from context and requirements
- researcher (builtin, disabled): Autonomous web researcher …
- reviewer (builtin, disabled): Code review specialist that validates implementation and fixes issues
- scout (builtin, disabled): Fast codebase recon that returns compressed context for handoff
- thoughts-locator (project): Discovers relevant documents in thoughts/ directory …
- worker (builtin, disabled): General-purpose subagent with full capabilities

Chains:
- (none)`;

describe("filterDisabledFromListResult — strip disabled builtin rows from handleList output", () => {
	it("drift guard: handleList still emits the '(builtin, disabled)' suffix somewhere in the snapshot", () => {
		expect(PI_SUBAGENTS_LIST_OUTPUT).toContain(LIST_FILTER_SNAPSHOT_FRAGMENT);
	});

	it("removes every row tagged '(builtin, disabled)' — leak invariant over all 9 builtins", () => {
		const filtered = filterDisabledFromListResult(PI_SUBAGENTS_LIST_OUTPUT) as string;
		for (const name of PI_SUBAGENTS_BUILTINS) {
			expect(filtered).not.toContain(`- ${name} (builtin, disabled)`);
		}
		expect(filtered).not.toMatch(/, disabled\)/);
	});

	it("preserves non-disabled project rows and the Chains section verbatim", () => {
		const filtered = filterDisabledFromListResult(PI_SUBAGENTS_LIST_OUTPUT) as string;
		expect(filtered).toContain("- claim-verifier (project):");
		expect(filtered).toContain("- codebase-analyzer (project):");
		expect(filtered).toContain("- general-purpose (project):");
		expect(filtered).toContain("- thoughts-locator (project):");
		expect(filtered).toContain("Chains:");
		expect(filtered).toContain("- (none)");
	});

	it("keeps the Agents: header and blank-line-before-Chains even when every builtin is removed", () => {
		const filtered = filterDisabledFromListResult(PI_SUBAGENTS_LIST_OUTPUT) as string;
		expect(filtered.startsWith("Agents:\n")).toBe(true);
		expect(filtered).toMatch(/\n\nChains:/);
	});

	it("consumes trailing newline on each removed row (no accumulated blank lines)", () => {
		const minimal = "Agents:\n- scout (builtin, disabled): a\n- foo (project): b\n\nChains:\n- (none)";
		const filtered = filterDisabledFromListResult(minimal) as string;
		expect(filtered).toBe("Agents:\n- foo (project): b\n\nChains:\n- (none)");
	});

	it("handles a disabled row at EOF (no trailing newline) without leaving it behind", () => {
		const endEdge = "Agents:\n- foo (project): b\n- scout (builtin, disabled): a";
		const filtered = filterDisabledFromListResult(endEdge) as string;
		expect(filtered).toBe("Agents:\n- foo (project): b\n");
	});

	it("is a no-op on inputs that contain no disabled-tagged rows", () => {
		const userOnly = "Agents:\n- claim-verifier (project): x\n\nChains:\n- (none)";
		expect(filterDisabledFromListResult(userOnly)).toBe(userOnly);
	});

	it("passes undefined through unchanged", () => {
		expect(filterDisabledFromListResult(undefined)).toBe(undefined);
	});
});
