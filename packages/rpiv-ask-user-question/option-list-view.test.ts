import { makeTheme } from "@juicesharp/rpiv-test-utils";
import type { Theme } from "@mariozechner/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { MAX_VISIBLE_OPTIONS, OptionListView, type OptionListViewProps } from "./option-list-view.js";
import type { WrappingSelectItem } from "./wrapping-select.js";

const baseTheme = makeTheme() as unknown as Theme;
const selectTheme = {
	selectedText: (t: string) => baseTheme.fg("accent", baseTheme.bold(t)),
	description: (t: string) => baseTheme.fg("muted", t),
	scrollInfo: (t: string) => baseTheme.fg("dim", t),
};

function makeView(items: WrappingSelectItem[]): OptionListView {
	return new OptionListView({ items, theme: selectTheme });
}

function props(over: Partial<OptionListViewProps> = {}): OptionListViewProps {
	return {
		selectedIndex: over.selectedIndex ?? 0,
		focused: over.focused ?? true,
		...(over.confirmed ? { confirmed: over.confirmed } : {}),
	};
}

const sampleItems: WrappingSelectItem[] = [
	{ kind: "option", label: "Alpha" },
	{ kind: "option", label: "Beta" },
	{ kind: "option", label: "Gamma" },
];

describe("OptionListView — selectedIndex SOT", () => {
	it("getSelectedIndex defaults to 0", () => {
		const v = makeView(sampleItems);
		expect(v.getSelectedIndex()).toBe(0);
	});

	it("setProps({selectedIndex}) updates the value queryable via getSelectedIndex", () => {
		const v = makeView(sampleItems);
		v.setProps(props({ selectedIndex: 2 }));
		expect(v.getSelectedIndex()).toBe(2);
	});

	it("setProps({selectedIndex}) value is reflected in render() row activation (cursor on row 3)", () => {
		const v = makeView(sampleItems);
		v.setProps(props({ selectedIndex: 2, focused: true }));
		const lines = v.render(40);
		const activeRow = lines.find((l) => l.includes("Gamma"));
		expect(activeRow).toBeDefined();
		expect(activeRow!.includes("❯")).toBe(true);
	});
});

describe("OptionListView — focused SOT", () => {
	it("isFocused defaults to true", () => {
		const v = makeView(sampleItems);
		expect(v.isFocused()).toBe(true);
	});

	it("setProps({focused: false}) makes isFocused() return false; render no longer shows the active pointer", () => {
		const v = makeView(sampleItems);
		v.setProps(props({ selectedIndex: 0, focused: false }));
		expect(v.isFocused()).toBe(false);
		const lines = v.render(40);
		expect(lines.every((l) => !l.startsWith("❯"))).toBe(true);
	});

	it("setProps({focused: true}) restores the active pointer at row 0", () => {
		const v = makeView(sampleItems);
		v.setProps(props({ selectedIndex: 0, focused: true }));
		const lines = v.render(40);
		expect(lines[0]?.includes("❯")).toBe(true);
	});
});

describe("OptionListView — input buffer proxies", () => {
	const otherItems: WrappingSelectItem[] = [
		{ kind: "option", label: "Alpha" },
		{ kind: "other", label: "Type something." },
	];

	it("getInputBuffer returns empty string by default", () => {
		const v = makeView(otherItems);
		expect(v.getInputBuffer()).toBe("");
	});

	it("setInputBuffer + getInputBuffer round-trip", () => {
		const v = makeView(otherItems);
		v.setInputBuffer("Hello");
		expect(v.getInputBuffer()).toBe("Hello");
	});

	it("appendInput grows the buffer; backspaceInput shrinks; clearInputBuffer empties", () => {
		const v = makeView(otherItems);
		v.appendInput("Hi");
		expect(v.getInputBuffer()).toBe("Hi");
		v.appendInput("!");
		expect(v.getInputBuffer()).toBe("Hi!");
		v.backspaceInput();
		expect(v.getInputBuffer()).toBe("Hi");
		v.clearInputBuffer();
		expect(v.getInputBuffer()).toBe("");
	});

	it("inline input render reflects input buffer when row is active", () => {
		const v = makeView(otherItems);
		v.setProps(props({ selectedIndex: 1, focused: true }));
		v.setInputBuffer("typed");
		const lines = v.render(40);
		expect(lines.some((l) => l.includes("typed"))).toBe(true);
		expect(lines.some((l) => l.includes("▌"))).toBe(true);
	});
});

describe("OptionListView — confirmed-index passthrough", () => {
	it("setProps({confirmed: { index: 1 }}) renders ' ✔' on row 2", () => {
		const v = makeView(sampleItems);
		v.setProps(props({ selectedIndex: 0, focused: true, confirmed: { index: 1 } }));
		const lines = v.render(40);
		expect(lines.some((l) => l.includes("Beta ✔"))).toBe(true);
	});

	it("omitting confirmed in setProps clears the marker", () => {
		const v = makeView(sampleItems);
		v.setProps(props({ confirmed: { index: 1 } }));
		v.setProps(props());
		const lines = v.render(40);
		expect(lines.join("\n").includes("✔")).toBe(false);
	});
});

describe("OptionListView — visible-window cap", () => {
	it("MAX_VISIBLE_OPTIONS is 10", () => {
		expect(MAX_VISIBLE_OPTIONS).toBe(10);
	});
});
