import { Type } from "@sinclair/typebox";
import { describe, expect, it, vi } from "vitest";
import { PI_SUBAGENTS_BUILTINS, RPIV_SPECIALISTS } from "./hide-builtin-subagents.js";

// Hoisted so vi.mock factories can close over it. The default export is a
// stand-in for pi-subagents' registerSubagentExtension: it receives the
// proxied ExtensionAPI and synchronously calls pi.registerTool with a fixture
// tool object matching pi-subagents@0.17.5's shape (description + parameters
// + renderCall + renderResult). We capture whatever the Proxy forwards to
// the real pi.registerTool for assertion.
const { registerSubagentExtensionMock, fixtureOriginalRenderCall, fixtureOriginalRenderResult, fixtureExecute } =
	vi.hoisted(() => {
		const fixtureOriginalRenderCall = vi.fn();
		const fixtureOriginalRenderResult = vi.fn();
		const fixtureExecute = vi.fn(async (_id: string, params: { action?: string }) => {
			if (params.action === "list") {
				return {
					content: [
						{
							type: "text",
							text: "Agents:\n- scout (builtin, disabled): a\n- foo (project): b\n\nChains:\n- (none)",
						},
					],
					details: { mode: "management", results: [] },
				};
			}
			if (params.action === "get") {
				return {
					content: [{ type: "text", text: "Agent: foo (project)\nDescription: x" }],
					details: { mode: "management", results: [] },
				};
			}
			return {
				content: [{ type: "text", text: "single mode output" }],
				details: { mode: "single", results: [] },
			};
		});
		return {
			fixtureOriginalRenderCall,
			fixtureOriginalRenderResult,
			fixtureExecute,
			registerSubagentExtensionMock: vi.fn(async (pi: { registerTool: (t: unknown) => void }) => {
				pi.registerTool({
					name: "subagent",
					description: `Delegate to subagents or manage agent definitions.

EXECUTION (use exactly ONE mode):
• SINGLE: { agent, task } - one task
• CHAIN: { chain: [{agent:"scout"}, {parallel:[{agent:"worker",count:3}]}] } - sequential pipeline with optional parallel fan-out
• PARALLEL: { tasks: [{agent,task,count?}, ...], concurrency?: number, worktree?: true } - concurrent execution (worktree: isolate each task in a git worktree)

Example: { chain: [{agent:"scout", task:"Analyze {task}"}, {agent:"planner", task:"Plan based on {previous}"}] }`,
					parameters: Type.Object({
						agent: Type.Optional(Type.String({ description: "orig" })),
						task: Type.Optional(Type.String()),
					}),
					execute: fixtureExecute,
					renderCall: fixtureOriginalRenderCall,
					renderResult: fixtureOriginalRenderResult,
				});
			}),
		};
	});
vi.mock("pi-subagents", () => ({ default: registerSubagentExtensionMock }));
vi.mock("pi-subagents/render", () => ({ renderSubagentResult: vi.fn() }));

import { registerSubagentsWithQuietRenderer } from "./renderer-override.js";

interface MockPi {
	registerTool: ReturnType<typeof vi.fn>;
	[k: string]: unknown;
}

function makePi(): MockPi {
	return {
		registerTool: vi.fn(),
		// Pi surface is deliberately minimal — the Proxy only intercepts registerTool
		// and forwards everything else via Reflect.get. No other methods are invoked
		// by registerSubagentExtensionMock.
	} as MockPi;
}

describe("registerSubagentsWithQuietRenderer — Proxy integration: all 4 overrides flow through", () => {
	it("replaces description with curated file and pins agent param enum + description", async () => {
		const pi = makePi();
		await registerSubagentsWithQuietRenderer(
			pi as unknown as Parameters<typeof registerSubagentsWithQuietRenderer>[0],
		);
		expect(pi.registerTool).toHaveBeenCalledOnce();
		const forwarded = pi.registerTool.mock.calls[0][0] as {
			name: string;
			description: string;
			parameters: { properties: { agent: { enum: string[]; description: string } } };
			renderCall: unknown;
			renderResult: unknown;
		};
		for (const name of PI_SUBAGENTS_BUILTINS) {
			expect(forwarded.description).not.toContain(`"${name}"`);
		}
		expect(forwarded.description).not.toContain("Example:");
		expect(forwarded.description).toContain("EXECUTION");
		expect(forwarded.parameters.properties.agent.enum).toEqual([...RPIV_SPECIALISTS]);
		// The agent param description is composed from the bundled agents/*.md
		// frontmatter at module init, so each specialist's name appears as a bullet.
		for (const specialist of RPIV_SPECIALISTS) {
			expect(forwarded.parameters.properties.agent.description).toContain(`- ${specialist}: `);
		}
	});

	it("replaces renderCall and renderResult (references differ from the originals)", async () => {
		const pi = makePi();
		await registerSubagentsWithQuietRenderer(
			pi as unknown as Parameters<typeof registerSubagentsWithQuietRenderer>[0],
		);
		const forwarded = pi.registerTool.mock.calls[0][0] as { renderCall: unknown; renderResult: unknown };
		expect(forwarded.renderCall).not.toBe(fixtureOriginalRenderCall);
		expect(forwarded.renderResult).not.toBe(fixtureOriginalRenderResult);
		expect(typeof forwarded.renderCall).toBe("function");
		expect(typeof forwarded.renderResult).toBe("function");
	});

	it("passes non-subagent tools through untouched", async () => {
		const pi = makePi();
		// Override the mock for this test so the fake extension registers a non-subagent tool too.
		registerSubagentExtensionMock.mockImplementationOnce(
			async (wrappedPi: { registerTool: (t: unknown) => void }) => {
				wrappedPi.registerTool({ name: "other-tool", description: "anything", parameters: {}, execute: () => {} });
			},
		);
		await registerSubagentsWithQuietRenderer(
			pi as unknown as Parameters<typeof registerSubagentsWithQuietRenderer>[0],
		);
		expect(pi.registerTool).toHaveBeenCalledOnce();
		const forwarded = pi.registerTool.mock.calls[0][0] as { name: string; description: string };
		expect(forwarded.name).toBe("other-tool");
		expect(forwarded.description).toBe("anything");
	});

	it("filters disabled builtin rows from action:'list' result text", async () => {
		const pi = makePi();
		await registerSubagentsWithQuietRenderer(
			pi as unknown as Parameters<typeof registerSubagentsWithQuietRenderer>[0],
		);
		const forwarded = pi.registerTool.mock.calls[0][0] as {
			execute: (id: string, params: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>;
		};
		const out = await forwarded.execute("call-1", { action: "list" });
		expect(out.content[0].text).not.toContain("(builtin, disabled)");
		expect(out.content[0].text).toContain("- foo (project): b");
		expect(out.content[0].text).toContain("Chains:");
	});

	it("passes action:'get' through untouched (filter is list-specific)", async () => {
		const pi = makePi();
		await registerSubagentsWithQuietRenderer(
			pi as unknown as Parameters<typeof registerSubagentsWithQuietRenderer>[0],
		);
		const forwarded = pi.registerTool.mock.calls[0][0] as {
			execute: (id: string, params: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>;
		};
		const out = await forwarded.execute("call-2", { action: "get", agent: "foo" });
		expect(out.content[0].text).toBe("Agent: foo (project)\nDescription: x");
	});

	it("passes non-management (SINGLE mode) calls through untouched", async () => {
		const pi = makePi();
		await registerSubagentsWithQuietRenderer(
			pi as unknown as Parameters<typeof registerSubagentsWithQuietRenderer>[0],
		);
		const forwarded = pi.registerTool.mock.calls[0][0] as {
			execute: (id: string, params: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>;
		};
		const out = await forwarded.execute("call-3", { agent: "codebase-locator", task: "find x" });
		expect(out.content[0].text).toBe("single mode output");
	});

	it("passes error results through untouched even when action === 'list'", async () => {
		const pi = makePi();
		await registerSubagentsWithQuietRenderer(
			pi as unknown as Parameters<typeof registerSubagentsWithQuietRenderer>[0],
		);
		const forwarded = pi.registerTool.mock.calls[0][0] as { execute: unknown };
		// Reconfigure the shared fixture to return an error for the next call only.
		fixtureExecute.mockImplementationOnce(async () => ({
			content: [{ type: "text", text: "- scout (builtin, disabled): should not be filtered on error path" }],
			isError: true,
			details: { mode: "management", results: [] },
		}));
		const execute = forwarded.execute as (
			id: string,
			params: unknown,
		) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;
		const out = await execute("call-4", { action: "list" });
		expect(out.isError).toBe(true);
		// Filter must NOT run on error results — the row survives.
		expect(out.content[0].text).toContain("(builtin, disabled)");
	});
});
