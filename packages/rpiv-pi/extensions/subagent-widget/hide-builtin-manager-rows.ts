// Hides the upstream pi-subagents built-in agent rows from the `/agents`
// manager overlay (and ctrl+shift+a). Companion to hide-builtin-subagents.ts,
// which hides the same names from the LLM-facing `subagent` tool surface.
//
// Strategy: monkey-patch `AgentManagerComponent.prototype.loadEntries` — the
// single chokepoint that converts agentData → rendered AgentEntry rows. The
// constructor calls it, refreshAgentData() calls it after every in-overlay
// mutation, so one patch covers both code paths.
//
// Fail-soft contract: never throw at user runtime. Drift, missing class, or
// missing method routes through the caller-supplied `onSkip` so Pi can
// surface a single warning notify and continue booting. The /agents overlay
// silently regains the upstream rows; the LLM-facing filter (Proxy in
// renderer-override.ts) is unaffected because it lives on a different layer.

import { PI_SUBAGENTS_BUILTINS } from "./hide-builtin-subagents.js";

const BUILTIN_NAMES_SET = new Set<string>(PI_SUBAGENTS_BUILTINS);

// Drift anchor: the load-bearing substring inside upstream
// agent-manager.ts:120-124 loadEntries. If upstream rewrites the method to
// stop reading agentData.builtin (rename, inline into ctor, route through a
// helper), this fragment disappears and we skip with reason "drift-detected"
// before mutating the prototype.
export const LOAD_ENTRIES_SOURCE_FRAGMENT = "this.agentData.builtin";

export const INSTALLED_SENTINEL = Symbol.for("rpiv-pi.manager-row-filter-installed");

export type InstallResult = "installed" | "skipped";

export type SkipReason =
	| "missing-constructor"
	| "missing-prototype"
	| "missing-loadentries"
	| "drift-detected"
	| "already-installed";

export interface InstallOptions {
	onSkip?: (reason: SkipReason) => void;
}

interface AgentDataLike {
	builtin?: Array<{ name?: unknown }>;
}

interface ManagerInstanceLike {
	agentData?: AgentDataLike;
}

interface ManagerCtorLike {
	prototype?: { loadEntries?: (this: ManagerInstanceLike) => void };
	[INSTALLED_SENTINEL]?: boolean;
}

interface PatchRecord {
	ctor: ManagerCtorLike;
	original: (this: ManagerInstanceLike) => void;
}

let installedPatch: PatchRecord | undefined;

function isFilteredBuiltin(entry: { name?: unknown }): boolean {
	return typeof entry.name === "string" && BUILTIN_NAMES_SET.has(entry.name);
}

export function installManagerRowFilter(managerCtor: unknown, options: InstallOptions = {}): InstallResult {
	const onSkip = options.onSkip ?? (() => {});
	const ctor = managerCtor as ManagerCtorLike | undefined | null;

	if (!ctor) {
		onSkip("missing-constructor");
		return "skipped";
	}
	if (ctor[INSTALLED_SENTINEL] === true) {
		onSkip("already-installed");
		return "skipped";
	}
	const proto = ctor.prototype;
	if (!proto) {
		onSkip("missing-prototype");
		return "skipped";
	}
	const original = proto.loadEntries;
	if (typeof original !== "function") {
		onSkip("missing-loadentries");
		return "skipped";
	}
	let source: string;
	try {
		source = original.toString();
	} catch {
		onSkip("drift-detected");
		return "skipped";
	}
	if (!source.includes(LOAD_ENTRIES_SOURCE_FRAGMENT)) {
		onSkip("drift-detected");
		return "skipped";
	}

	proto.loadEntries = function patchedLoadEntries(this: ManagerInstanceLike): void {
		// Defensive clone: never mutate the agentData reference we received.
		// Other manager screens (override-scope, edit) read agentData directly
		// and may rely on the unfiltered shape.
		const original = this.agentData;
		const builtin = Array.isArray(original?.builtin) ? original.builtin : [];
		const filteredBuiltin = builtin.filter((c) => !isFilteredBuiltin(c ?? {}));
		const filteredAgentData = { ...(original ?? {}), builtin: filteredBuiltin };
		this.agentData = filteredAgentData as AgentDataLike;
		try {
			(installedPatch?.original ?? (() => {})).call(this);
		} finally {
			// Restore the unfiltered view for downstream reads outside loadEntries.
			this.agentData = original;
		}
	};
	ctor[INSTALLED_SENTINEL] = true;
	installedPatch = { ctor, original };
	return "installed";
}

// Test-only: undo the prototype mutation so each test sees a fresh slate.
// Wired into test/setup.ts beforeEach. No-op when nothing is installed.
export function __resetManagerRowFilterForTests(): void {
	if (!installedPatch) return;
	const { ctor, original } = installedPatch;
	if (ctor.prototype) ctor.prototype.loadEntries = original;
	delete ctor[INSTALLED_SENTINEL];
	installedPatch = undefined;
}
