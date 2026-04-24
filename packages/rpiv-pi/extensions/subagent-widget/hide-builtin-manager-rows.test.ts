import { describe, expect, it, vi } from "vitest";
import {
	__resetManagerRowFilterForTests,
	INSTALLED_SENTINEL,
	installManagerRowFilter,
	LOAD_ENTRIES_SOURCE_FRAGMENT,
	type SkipReason,
} from "./hide-builtin-manager-rows.js";

interface AgentEntry {
	name: string;
}
interface AgentDataFixture {
	builtin: AgentEntry[];
	user: AgentEntry[];
	project: AgentEntry[];
}
interface ManagerLike {
	agentData: AgentDataFixture;
	_walkedBuiltin: string[];
}

// Synthetic constructor whose `loadEntries` mirrors the load-bearing shape
// of upstream agent-manager.ts:120-124 — references `this.agentData.builtin`
// (drift anchor) and walks it, recording names into a side-channel so tests
// can assert what would have been rendered.
function makeFixtureCtor(): new () => ManagerLike {
	function FixtureCtor(this: ManagerLike) {
		this.agentData = { builtin: [], user: [], project: [] };
		this._walkedBuiltin = [];
	}
	FixtureCtor.prototype.loadEntries = function (this: ManagerLike) {
		this._walkedBuiltin = [];
		// Keep the literal substring so the drift guard accepts this fixture.
		for (const config of this.agentData.builtin) {
			this._walkedBuiltin.push(config.name);
		}
	};
	return FixtureCtor as unknown as new () => ManagerLike;
}

describe("installManagerRowFilter", () => {
	it("filters PI_SUBAGENTS_BUILTINS rows from the walked list", () => {
		const Ctor = makeFixtureCtor();
		const result = installManagerRowFilter(Ctor);
		expect(result).toBe("installed");

		const instance = new Ctor();
		instance.agentData = {
			builtin: [{ name: "scout" }, { name: "planner" }, { name: "general-purpose" }, { name: "codebase-locator" }],
			user: [],
			project: [],
		};
		instance._walkedBuiltin = [];
		instance.constructor.prototype.loadEntries.call(instance);

		expect(instance._walkedBuiltin).toEqual(["general-purpose", "codebase-locator"]);
		__resetManagerRowFilterForTests();
	});

	it("filters on every invocation (covers refreshAgentData re-call)", () => {
		const Ctor = makeFixtureCtor();
		installManagerRowFilter(Ctor);
		const instance = new Ctor();

		instance.agentData = { builtin: [{ name: "scout" }, { name: "thoughts-locator" }], user: [], project: [] };
		instance.constructor.prototype.loadEntries.call(instance);
		expect(instance._walkedBuiltin).toEqual(["thoughts-locator"]);

		instance.agentData = { builtin: [{ name: "oracle" }, { name: "diff-auditor" }], user: [], project: [] };
		instance.constructor.prototype.loadEntries.call(instance);
		expect(instance._walkedBuiltin).toEqual(["diff-auditor"]);

		__resetManagerRowFilterForTests();
	});

	it("restores the unfiltered agentData reference after loadEntries returns", () => {
		const Ctor = makeFixtureCtor();
		installManagerRowFilter(Ctor);
		const instance = new Ctor();
		const unfiltered = {
			builtin: [{ name: "scout" }, { name: "general-purpose" }],
			user: [],
			project: [],
		};
		instance.agentData = unfiltered;
		instance.constructor.prototype.loadEntries.call(instance);

		expect(instance.agentData).toBe(unfiltered);
		expect(instance.agentData.builtin.map((c) => c.name)).toEqual(["scout", "general-purpose"]);
		__resetManagerRowFilterForTests();
	});

	it("is idempotent — second install returns 'skipped' with reason 'already-installed'", () => {
		const Ctor = makeFixtureCtor();
		const first = installManagerRowFilter(Ctor);
		const patched = (Ctor.prototype as { loadEntries: () => void }).loadEntries;

		const onSkip = vi.fn<(reason: SkipReason) => void>();
		const second = installManagerRowFilter(Ctor, { onSkip });
		expect(first).toBe("installed");
		expect(second).toBe("skipped");
		expect(onSkip).toHaveBeenCalledWith("already-installed");
		expect((Ctor.prototype as { loadEntries: () => void }).loadEntries).toBe(patched);
		expect((Ctor as { [INSTALLED_SENTINEL]?: boolean })[INSTALLED_SENTINEL]).toBe(true);

		__resetManagerRowFilterForTests();
	});

	it.each<[string, unknown, SkipReason]>([
		["missing constructor (undefined)", undefined, "missing-constructor"],
		["missing constructor (null)", null, "missing-constructor"],
		["missing prototype", { prototype: undefined }, "missing-prototype"],
		["missing loadEntries", { prototype: {} }, "missing-loadentries"],
		["loadEntries lacks drift anchor", { prototype: { loadEntries: () => 1 } }, "drift-detected"],
	])("fails soft on %s — onSkip(%s) and never throws", (_label, ctor, expectedReason) => {
		const onSkip = vi.fn<(reason: SkipReason) => void>();
		expect(() => installManagerRowFilter(ctor, { onSkip })).not.toThrow();
		expect(onSkip).toHaveBeenCalledExactlyOnceWith(expectedReason);
	});

	it("survives invocation when agentData.builtin is missing", () => {
		const Ctor = makeFixtureCtor();
		installManagerRowFilter(Ctor);
		const instance = new Ctor();
		instance.agentData = { builtin: undefined as unknown as AgentEntry[], user: [], project: [] };
		expect(() => instance.constructor.prototype.loadEntries.call(instance)).not.toThrow();
		__resetManagerRowFilterForTests();
	});
});

describe("real pi-subagents AgentManagerComponent contract", () => {
	// Canary: this is the only test that touches the live upstream module.
	// Failing here means upstream pi-subagents drifted between our pin and
	// our release — bump the dep, update LOAD_ENTRIES_SOURCE_FRAGMENT (or
	// retire the patch), and re-snapshot. At user runtime the patch fails
	// soft via onSkip; this test exists so we catch drift before shipping.
	it("loadEntries body still contains the load-bearing drift anchor", async () => {
		// Dynamic import: matches the runtime guarded import in renderer-override.ts
		// and avoids tsc resolving into the upstream .ts source via the path stub.
		const mod = (await import("pi-subagents/agent-manager")) as {
			AgentManagerComponent?: { prototype?: { loadEntries?: () => void } };
		};
		const proto = mod.AgentManagerComponent?.prototype;
		const fn = proto?.loadEntries;
		expect(typeof fn).toBe("function");
		expect(fn?.toString()).toContain(LOAD_ENTRIES_SOURCE_FRAGMENT);
	});
});
