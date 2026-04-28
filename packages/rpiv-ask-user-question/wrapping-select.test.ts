import { visibleWidth } from "@mariozechner/pi-tui";
import { describe, expect, it } from "vitest";
import { WrappingSelect, type WrappingSelectItem, type WrappingSelectTheme } from "./wrapping-select.js";

const identityTheme: WrappingSelectTheme = {
	selectedText: (t) => t,
	description: (t) => t,
	scrollInfo: (t) => t,
};

// Numbering is preserved — rows render as "❯ N. label". The chat row's number is kept
// continuous with the active tab's options via setNumbering() (driven by ask-user-question.ts).
describe("WrappingSelect.setSelectedIndex", () => {
	it("clamps negative to 0", () => {
		const s = new WrappingSelect(
			[
				{ kind: "option", label: "a" },
				{ kind: "option", label: "b" },
			],
			10,
			identityTheme,
		);
		s.setSelectedIndex(-5);
		const lines = s.render(40);
		expect(lines[0]).toContain("❯ 1. a");
	});
	it("clamps above-max to last", () => {
		const s = new WrappingSelect(
			[
				{ kind: "option", label: "a" },
				{ kind: "option", label: "b" },
			],
			10,
			identityTheme,
		);
		s.setSelectedIndex(99);
		const lines = s.render(40);
		expect(lines[1]).toContain("❯ 2. b");
	});
});

describe("WrappingSelect.appendInput + backspaceInput (unicode aware)", () => {
	it("strips control chars on append", () => {
		const s = new WrappingSelect([{ kind: "other", label: "a" }], 10, identityTheme);
		s.setSelectedIndex(0);
		s.appendInput("abc\x07\x1bdef");
		expect(s.getInputBuffer()).toBe("abcdef");
	});
	it("backspace removes one visual char (Array.from for unicode)", () => {
		const s = new WrappingSelect([{ kind: "other", label: "a" }], 10, identityTheme);
		s.setSelectedIndex(0);
		s.appendInput("a😀b");
		s.backspaceInput();
		expect(s.getInputBuffer()).toBe("a😀");
		s.backspaceInput();
		expect(s.getInputBuffer()).toBe("a");
	});
	it("backspace on empty buffer is a no-op", () => {
		const s = new WrappingSelect([{ kind: "other", label: "a" }], 10, identityTheme);
		s.backspaceInput();
		expect(s.getInputBuffer()).toBe("");
	});
});

describe("WrappingSelect.render — visible window", () => {
	const items: WrappingSelectItem[] = Array.from({ length: 20 }, (_, i) => ({
		kind: "option" as const,
		label: `row-${i + 1}`,
	}));

	it("renders all items when count <= maxVisible", () => {
		const s = new WrappingSelect(items.slice(0, 3), 10, identityTheme);
		const lines = s.render(40);
		expect(lines.filter((l) => l.includes("row-")).length).toBe(3);
	});

	it("shows scroll indicator when items exceed maxVisible", () => {
		const s = new WrappingSelect(items, 5, identityTheme);
		s.setSelectedIndex(10);
		const lines = s.render(40);
		expect(lines.some((l) => l.includes("(11/20)"))).toBe(true);
	});

	it("centers window around selectedIndex", () => {
		const s = new WrappingSelect(items, 5, identityTheme);
		s.setSelectedIndex(10);
		const lines = s.render(40);
		expect(lines.some((l) => /\brow-9\b/.test(l))).toBe(true);
		expect(lines.some((l) => /\brow-11\b/.test(l))).toBe(true);
		expect(lines.some((l) => /\brow-1\b/.test(l))).toBe(false);
	});

	it("returns empty array for zero items", () => {
		const s = new WrappingSelect([], 5, identityTheme);
		expect(s.render(40)).toEqual([]);
	});
});

describe("WrappingSelect.render — inline input when kind:'other' + focused", () => {
	it("renders inline input row with cursor when kind:'other' item focused", () => {
		const s = new WrappingSelect([{ kind: "other", label: "pick" }], 1, identityTheme);
		s.setSelectedIndex(0);
		s.setFocused(true);
		s.appendInput("hi");
		const lines = s.render(40);
		expect(lines[0]).toContain("hi");
		expect(lines[0]).toContain("▌");
	});
	it("renders label (not input) when kind:'other' but NOT focused", () => {
		const s = new WrappingSelect([{ kind: "other", label: "pick" }], 1, identityTheme);
		s.setFocused(false);
		s.appendInput("buf");
		const lines = s.render(40);
		expect(lines[0]).toContain("pick");
		expect(lines[0]).not.toContain("▌");
	});

	it("truncates inline input row to terminal width", () => {
		const s = new WrappingSelect([{ kind: "other", label: "pick" }], 1, identityTheme);
		s.setSelectedIndex(0);
		s.setFocused(true);
		s.appendInput("this is a really long input that exceeds the width");
		const narrowWidth = 20;
		const lines = s.render(narrowWidth);
		expect(visibleWidth(lines[0])).toBeLessThanOrEqual(narrowWidth);
	});

	// rowPrefix "❯ 1. " = 5 cols, +16 chars input, +1 col cursor = 22 cols → 2 over.
	// Reproduces the user-reported "overflows by a column or two" symptom that crashed pi.
	it("clips when input pushes the row just past width (off-by-one boundary)", () => {
		const s = new WrappingSelect([{ kind: "other", label: "pick" }], 1, identityTheme);
		s.setSelectedIndex(0);
		s.setFocused(true);
		s.appendInput("a".repeat(16));
		const width = 20;
		const lines = s.render(width);
		expect(visibleWidth(lines[0])).toBeLessThanOrEqual(width);
	});

	it("clips inline input row when input is much longer than width", () => {
		const s = new WrappingSelect([{ kind: "other", label: "pick" }], 1, identityTheme);
		s.setSelectedIndex(0);
		s.setFocused(true);
		s.appendInput("x".repeat(200));
		const width = 10;
		const lines = s.render(width);
		expect(visibleWidth(lines[0])).toBeLessThanOrEqual(width);
	});

	// Each 😀 is 2 cols wide, so unclipped overflow scales with grapheme width.
	it("clips inline input row containing wide (emoji) characters", () => {
		const s = new WrappingSelect([{ kind: "other", label: "pick" }], 1, identityTheme);
		s.setSelectedIndex(0);
		s.setFocused(true);
		s.appendInput("😀".repeat(30));
		const width = 20;
		const lines = s.render(width);
		expect(visibleWidth(lines[0])).toBeLessThanOrEqual(width);
	});

	// totalItemsForNumbering=1000 → numberWidth=4 → rowPrefix "❯    1. " = 8 cols.
	// Pins down that truncation uses full `width`, not just post-prefix contentWidth.
	it("clips inline input row when number column inflates the prefix", () => {
		const s = new WrappingSelect([{ kind: "other", label: "pick" }], 1, identityTheme, {
			totalItemsForNumbering: 1000,
		});
		s.setSelectedIndex(0);
		s.setFocused(true);
		s.appendInput("hello world");
		const width = 12;
		const lines = s.render(width);
		expect(visibleWidth(lines[0])).toBeLessThanOrEqual(width);
	});

	it("renders inline input row within width when input is empty", () => {
		const s = new WrappingSelect([{ kind: "other", label: "pick" }], 1, identityTheme);
		s.setSelectedIndex(0);
		s.setFocused(true);
		const width = 12;
		const lines = s.render(width);
		expect(visibleWidth(lines[0])).toBeLessThanOrEqual(width);
	});
});

describe("WrappingSelect.render — number column padding", () => {
	it("pads numbers to width of total count", () => {
		const items: WrappingSelectItem[] = Array.from({ length: 12 }, (_, i) => ({
			kind: "option" as const,
			label: `r${i + 1}`,
		}));
		const s = new WrappingSelect(items, 20, identityTheme);
		const lines = s.render(40);
		expect(lines[0]).toContain(" 1. ");
		expect(lines[9]).toContain("10. ");
	});
	it("uses numberStartOffset for numbering (so chat row reads as `(N+1). Chat about this`)", () => {
		const s = new WrappingSelect([{ kind: "option", label: "chat" }], 1, identityTheme, {
			numberStartOffset: 5,
			totalItemsForNumbering: 10,
		});
		const lines = s.render(40);
		expect(lines[0]).toContain(" 6. chat");
	});
	it("setNumbering(offset, total) updates numbering in place (driven by tab switches)", () => {
		const s = new WrappingSelect([{ kind: "option", label: "chat" }], 1, identityTheme, {
			numberStartOffset: 0,
			totalItemsForNumbering: 1,
		});
		expect(s.render(40)[0]).toContain("❯ 1. chat");
		s.setNumbering(3, 4);
		expect(s.render(40)[0]).toContain("❯ 4. chat");
	});
});

describe("WrappingSelect.render — description block", () => {
	it("renders description lines under label", () => {
		const s = new WrappingSelect([{ kind: "option", label: "L", description: "desc-line" }], 2, identityTheme);
		const lines = s.render(40);
		expect(lines.some((l) => l.includes("desc-line"))).toBe(true);
	});
	it("omits description block when absent", () => {
		const s = new WrappingSelect([{ kind: "option", label: "L" }], 1, identityTheme);
		expect(s.render(40).length).toBe(1);
	});
});

// `setConfirmedIndex` powers the "✔ on previously-chosen row" indicator when the user
// navigates back to a tab they already answered. Pointer (`❯`) stays with the live cursor;
// the confirmed row gets the same accent+bold styling as the active row plus a trailing ` ✔`.
const markedTheme: WrappingSelectTheme = {
	selectedText: (t) => `<S>${t}</S>`,
	description: (t) => t,
	scrollInfo: (t) => t,
};

describe("WrappingSelect.setConfirmedIndex", () => {
	it("renders ` ✔` on the confirmed row in selectedText styling, no pointer", () => {
		const s = new WrappingSelect(
			[
				{ kind: "option", label: "Alpha" },
				{ kind: "option", label: "Beta" },
				{ kind: "option", label: "Gamma" },
			],
			10,
			markedTheme,
		);
		s.setSelectedIndex(0);
		s.setFocused(true);
		s.setConfirmedIndex(1);
		const lines = s.render(40);
		expect(lines[0]).toContain("❯ 1. Alpha");
		expect(lines[1]).toContain("  2. Beta ✔");
		expect(lines[1]).toContain("<S>");
		expect(lines[1]).toContain("</S>");
		expect(lines[1]).not.toContain("❯");
		expect(lines[2]).toBe("  3. Gamma");
	});
	it("renders both ❯ and ✔ when cursor lands on the confirmed row (e.g. prior answer was row 0)", () => {
		const s = new WrappingSelect(
			[
				{ kind: "option", label: "Alpha" },
				{ kind: "option", label: "Beta" },
			],
			10,
			markedTheme,
		);
		s.setSelectedIndex(1);
		s.setFocused(true);
		s.setConfirmedIndex(1);
		const lines = s.render(40);
		expect(lines[1]).toContain("❯ 2. Beta ✔");
		expect(lines[1]).toContain("<S>");
	});
	it("undefined clears the marker (default behavior preserved)", () => {
		const s = new WrappingSelect(
			[
				{ kind: "option", label: "A" },
				{ kind: "option", label: "B" },
			],
			10,
			markedTheme,
		);
		s.setConfirmedIndex(1);
		s.setConfirmedIndex(undefined);
		const lines = s.render(40);
		expect(lines.join("\n")).not.toContain("✔");
	});
	it("labelOverride replaces the static label (e.g. `Hello ✔` on kind:'other' row)", () => {
		const s = new WrappingSelect(
			[
				{ kind: "option", label: "Alpha" },
				{ kind: "option", label: "Beta" },
				{ kind: "other", label: "Type something." },
			],
			10,
			markedTheme,
		);
		s.setSelectedIndex(0);
		s.setFocused(true);
		s.setConfirmedIndex(2, "Hello");
		const lines = s.render(40);
		expect(lines[2]).toContain("Hello ✔");
		expect(lines[2]).not.toContain("Type something.");
		expect(lines[2]).toContain("<S>");
	});
	it("when focused on kind:'other' row, inline-input rendering wins over confirmed marker", () => {
		const s = new WrappingSelect(
			[
				{ kind: "option", label: "Alpha" },
				{ kind: "other", label: "Type something." },
			],
			10,
			markedTheme,
		);
		s.setSelectedIndex(1);
		s.setFocused(true);
		s.setConfirmedIndex(1, "Hello");
		s.appendInput("World");
		const lines = s.render(40);
		expect(lines[1]).toContain("World");
		expect(lines[1]).toContain("▌");
		expect(lines[1]).not.toContain("✔");
	});
	it("clamps index to valid range", () => {
		const s = new WrappingSelect(
			[
				{ kind: "option", label: "A" },
				{ kind: "option", label: "B" },
			],
			10,
			markedTheme,
		);
		s.setSelectedIndex(0);
		s.setFocused(true);
		s.setConfirmedIndex(99);
		const lines = s.render(40);
		expect(lines[1]).toContain("B ✔");
	});
	it("respects width — wrappable label + ` ✔` does not exceed width per line", () => {
		// Use identityTheme so the test theme markers don't inflate visibleWidth.
		const wrappable = "alpha beta gamma delta epsilon zeta eta theta";
		const s = new WrappingSelect(
			[
				{ kind: "option", label: "A" },
				{ kind: "option", label: wrappable },
			],
			10,
			identityTheme,
		);
		s.setSelectedIndex(0);
		s.setFocused(true);
		s.setConfirmedIndex(1);
		const width = 20;
		const lines = s.render(width);
		for (const line of lines) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
		expect(lines.some((l) => l.includes("✔"))).toBe(true);
	});
});

describe("WrappingSelect.setInputBuffer", () => {
	it("sets the buffer to the given text", () => {
		const s = new WrappingSelect([{ kind: "other", label: "x" }], 1, identityTheme);
		s.setInputBuffer("Hello");
		expect(s.getInputBuffer()).toBe("Hello");
	});
	it("strips control chars on set (parity with appendInput)", () => {
		const s = new WrappingSelect([{ kind: "other", label: "x" }], 1, identityTheme);
		s.setInputBuffer("ab\x07c\x1bd");
		expect(s.getInputBuffer()).toBe("abcd");
	});
	it("appendInput continues from the set buffer", () => {
		const s = new WrappingSelect([{ kind: "other", label: "x" }], 1, identityTheme);
		s.setInputBuffer("Hello");
		s.appendInput("!");
		expect(s.getInputBuffer()).toBe("Hello!");
	});
});

describe("WrappingSelectItem.kind contract — exhaustive", () => {
	const allKinds: WrappingSelectItem[] = [
		{ kind: "option", label: "opt" },
		{ kind: "other", label: "Type something." },
		{ kind: "chat", label: "Chat about this" },
		{ kind: "next", label: "Next" },
	];

	it.each(allKinds)("shouldRenderAsInlineInput is true only for kind 'other' when active", (item) => {
		const s = new WrappingSelect([item], 1, identityTheme);
		s.setSelectedIndex(0);
		s.setFocused(true);
		const lines = s.render(20);
		const isOther = item.kind === "other";
		const hasInputCursor = lines.some((l) => l.includes("▌"));
		expect(hasInputCursor).toBe(isOther);
	});
});
