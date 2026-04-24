// Deployment invariant: settings.json must not list "npm:pi-subagents" —
// nicobailon loads exactly once through this wrapper so every
// handler/bridge/tracker registers once. rpiv-core/claim-pi-subagents.ts
// enforces this by stripping that entry from ~/.pi/agent/settings.json.

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import registerSubagentExtension from "pi-subagents";
import { buildAgentEnumDescription } from "./agent-catalog.js";
import {
	filterDisabledFromListResult,
	getCuratedSubagentDescription,
	rewriteSubagentParameters,
} from "./hide-builtin-subagents.js";
import {
	buildQuietRenderCall,
	buildQuietRenderResult,
	type OriginalRenderCall,
	type QuietRenderResult,
} from "./overlay.js";

const SUBAGENT_TOOL = "subagent";

interface SubagentToolShape {
	name: string;
	description?: string;
	parameters?: unknown;
	execute?: unknown;
	renderCall?: unknown;
	renderResult?: unknown;
}

type RegisterTool = (tool: unknown) => unknown;

// pi-subagents' execute signature (index.ts:339) is (id, params, signal,
// onUpdate, ctx). We intentionally spread ...args rather than naming them —
// the wrapper is transport-agnostic; we only ever inspect params.action to
// decide whether to rewrite the return value, and we never interpose on
// onUpdate because management actions don't stream (index.ts:1503 returns the
// handler result directly; no onUpdate emissions fire for action:"list").
type ExecuteFn = (...args: unknown[]) => Promise<{
	content?: Array<{ type: string; text?: string }>;
	isError?: boolean;
	details?: unknown;
}>;

interface ListParamsLike {
	action?: unknown;
}

function buildFilteredExecute(originalExecute: ExecuteFn): ExecuteFn {
	return async (...args) => {
		const result = await originalExecute(...args);
		const params = args[1] as ListParamsLike | undefined;
		if (params?.action !== "list") return result;
		if (result.isError === true) return result;
		const firstContent = result.content?.[0];
		if (!firstContent || firstContent.type !== "text" || typeof firstContent.text !== "string") return result;
		const filteredText = filterDisabledFromListResult(firstContent.text);
		if (filteredText === firstContent.text) return result;
		return {
			...result,
			content: [{ ...firstContent, text: filteredText }, ...result.content!.slice(1)],
		};
	};
}

function applyRpivOverrides(tool: SubagentToolShape, quietRenderResult: QuietRenderResult): SubagentToolShape {
	return {
		...tool,
		description: getCuratedSubagentDescription(),
		parameters: rewriteSubagentParameters(tool.parameters, buildAgentEnumDescription()),
		execute: tool.execute ? buildFilteredExecute(tool.execute as ExecuteFn) : tool.execute,
		renderCall: buildQuietRenderCall(tool.renderCall as OriginalRenderCall | undefined),
		renderResult: quietRenderResult,
	};
}

function interceptRegisterTool(pi: ExtensionAPI): ExtensionAPI {
	const quietRenderResult = buildQuietRenderResult();
	return new Proxy(pi, {
		get(target, prop, receiver) {
			if (prop !== "registerTool") return Reflect.get(target, prop, receiver);
			const registerTool = target.registerTool as unknown as RegisterTool;
			return (tool: SubagentToolShape) =>
				registerTool(tool.name === SUBAGENT_TOOL ? applyRpivOverrides(tool, quietRenderResult) : tool);
		},
	});
}

export async function registerSubagentsWithQuietRenderer(pi: ExtensionAPI): Promise<void> {
	await registerSubagentExtension(interceptRegisterTool(pi));
}
