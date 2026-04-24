import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RPIV_SPECIALISTS } from "./hide-builtin-subagents.js";

const AGENTS_DIR = fileURLToPath(new URL("../../agents/", import.meta.url));

function discoverAgentStems(): string[] {
	return readdirSync(AGENTS_DIR)
		.filter((name) => name.endsWith(".md"))
		.map((name) => name.slice(0, -".md".length))
		.sort();
}

describe("RPIV_SPECIALISTS catalog drift guard", () => {
	it("matches the bundled packages/rpiv-pi/agents/*.md filenames", () => {
		const onDisk = discoverAgentStems();
		const declared = [...RPIV_SPECIALISTS].sort();
		expect(declared).toEqual(onDisk);
	});
});
