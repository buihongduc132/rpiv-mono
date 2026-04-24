import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { AGENT_CATALOG, buildAgentEnumDescription } from "./agent-catalog.js";
import { RPIV_SPECIALISTS } from "./hide-builtin-subagents.js";

const AGENTS_DIR = fileURLToPath(new URL("../../agents/", import.meta.url));

function readFrontmatterDescription(name: string): string {
	const content = readFileSync(join(AGENTS_DIR, `${name}.md`), "utf8");
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) throw new Error(`${name}.md has no frontmatter`);
	const fm = parseYaml(match[1]) as Record<string, unknown>;
	return fm.description as string;
}

describe("AGENT_CATALOG — frontmatter-sourced per-agent descriptions", () => {
	it("contains exactly one entry per RPIV_SPECIALISTS name, in declaration order", () => {
		expect(AGENT_CATALOG.map((e) => e.name)).toEqual([...RPIV_SPECIALISTS]);
	});

	it("every entry has a non-empty description string", () => {
		for (const entry of AGENT_CATALOG) {
			expect(typeof entry.description).toBe("string");
			expect(entry.description.length).toBeGreaterThan(0);
		}
	});

	it("each entry's description is a byte-for-byte mirror of the agents/<name>.md frontmatter", () => {
		// Hard invariant: no trimming, no truncation, no transformation — the
		// value the LLM sees is exactly the value authored in the .md file.
		for (const entry of AGENT_CATALOG) {
			expect(entry.description).toBe(readFrontmatterDescription(entry.name));
		}
	});
});

describe("AGENTS_DIR resolution — cross-platform URL walk via fileURLToPath(new URL(...))", () => {
	// WHATWG URL resolution is OS-agnostic: `new URL("../../agents/", base)` uses
	// forward-slash URL semantics regardless of what OS the test runs on. We can
	// therefore simulate POSIX, Windows, and Windows-UNC base URLs from any host
	// platform and assert the resolved URL is correct — no actual file I/O, no
	// need for a Windows CI runner to catch URL-walk bugs.
	const MODULE_REL = "/packages/rpiv-pi/extensions/subagent-widget/agent-catalog.ts";

	it("POSIX base: resolves to the rpiv-pi/agents/ directory URL", () => {
		const base = `file:///Users/alice/repo${MODULE_REL}`;
		const resolved = new URL("../../agents/", base);
		expect(resolved.href).toBe("file:///Users/alice/repo/packages/rpiv-pi/agents/");
	});

	it("Windows drive-letter base: resolves preserving the C: drive and backslash-free URL form", () => {
		const base = `file:///C:/Users/alice/repo${MODULE_REL}`;
		const resolved = new URL("../../agents/", base);
		expect(resolved.href).toBe("file:///C:/Users/alice/repo/packages/rpiv-pi/agents/");
	});

	it("Windows UNC share base: preserves the //server/share/ authority across the relative walk", () => {
		const base = `file:////server/share/repo${MODULE_REL}`;
		const resolved = new URL("../../agents/", base);
		// WHATWG keeps the empty-host + path-with-leading-// form of UNC file URLs;
		// Node's fileURLToPath on Windows later converts this to \\server\share\... .
		expect(resolved.href).toBe("file:////server/share/repo/packages/rpiv-pi/agents/");
	});

	it("URL-encoded characters in the path (space, %20): round-trip through fileURLToPath correctly", () => {
		// Typical hazard: installing under a path with a space (e.g. "Program Files").
		// import.meta.url encodes the space as %20; fileURLToPath decodes it back.
		const base = `file:///Users/alice/Program%20Files/repo${MODULE_REL}`;
		const resolved = new URL("../../agents/", base);
		expect(resolved.href).toBe("file:///Users/alice/Program%20Files/repo/packages/rpiv-pi/agents/");
		// fileURLToPath decodes %20 back to a literal space in the filesystem path.
		const fsPath = fileURLToPath(resolved);
		expect(fsPath).toContain("Program Files");
		expect(fsPath).not.toContain("%20");
	});

	it("current-platform sanity: AGENTS_DIR points at a real directory containing the specialists", () => {
		// Closes the loop — the URL walk is correct on this runner AND the
		// resulting path is a real dir that readFileSync can subsequently read.
		const stat = statSync(AGENTS_DIR);
		expect(stat.isDirectory()).toBe(true);
		for (const name of RPIV_SPECIALISTS) {
			const entryStat = statSync(join(AGENTS_DIR, `${name}.md`));
			expect(entryStat.isFile()).toBe(true);
		}
	});
});

describe("buildAgentEnumDescription — flattens catalog into an LLM-facing bullet list", () => {
	const text = buildAgentEnumDescription();

	it("starts with a contextual header line before the bullet list", () => {
		expect(text.split("\n")[0]).toBe("Agent name (SINGLE mode) or target for management get/update/delete. Options:");
	});

	it("emits one '- <name>: <description>' bullet per specialist", () => {
		for (const entry of AGENT_CATALOG) {
			expect(text).toContain(`- ${entry.name}: ${entry.description}`);
		}
	});

	it("orders bullets by RPIV_SPECIALISTS declaration order", () => {
		const bullets = text.split("\n").slice(1);
		const names = bullets.map((line) => line.replace(/^- /, "").split(":")[0]);
		expect(names).toEqual([...RPIV_SPECIALISTS]);
	});
});
