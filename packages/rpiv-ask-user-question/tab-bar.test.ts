import { makeTheme } from "@juicesharp/rpiv-test-utils";
import type { Theme } from "@mariozechner/pi-coding-agent";
import { visibleWidth } from "@mariozechner/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { TabBar, type TabBarConfig } from "./tab-bar.js";
import type { QuestionAnswer } from "./types.js";

const theme = makeTheme() as unknown as Theme;

function cfg(over: Partial<TabBarConfig> = {}): TabBarConfig {
	return {
		questions: over.questions ?? [
			{ header: "Scope", question: "Which scope?" },
			{ header: "Priority", question: "How urgent?" },
			{ header: "Tests", question: "Include tests?" },
		],
		answers: over.answers ?? new Map<number, QuestionAnswer>(),
		activeTabIndex: over.activeTabIndex ?? 0,
		totalTabs: over.totalTabs ?? 4,
	};
}

function makeAnswer(over: Partial<QuestionAnswer> = {}): QuestionAnswer {
	return {
		questionIndex: over.questionIndex ?? 0,
		question: over.question ?? "Q",
		kind: over.kind ?? "option",
		answer: over.answer ?? "A",
	};
}

describe("TabBar.render", () => {
	it("emits exactly 2 lines (tab bar + blank spacer)", () => {
		const tb = new TabBar(cfg(), theme);
		const lines = tb.render(80);
		expect(lines.length).toBe(2);
		expect(lines[1]).toBe("");
	});

	it("renders one indicator per question + a Submit tab", () => {
		const tb = new TabBar(cfg(), theme);
		const line = tb.render(80)[0];
		const empties = (line.match(/□/g) ?? []).length;
		expect(empties).toBe(3);
		expect(line).toContain("Submit");
		expect(line).toContain("←");
		expect(line).toContain("→");
	});

	it("flips □ → ■ for answered questions", () => {
		const answers = new Map<number, QuestionAnswer>([[1, makeAnswer({ questionIndex: 1 })]]);
		const tb = new TabBar(cfg({ answers }), theme);
		const line = tb.render(80)[0];
		expect(line.match(/■/g)?.length).toBe(1);
		expect(line.match(/□/g)?.length).toBe(2);
	});

	it("applies selectedBg styling to the active tab via theme.bg", () => {
		const spy = vi.spyOn(theme, "bg");
		const tb = new TabBar(cfg({ activeTabIndex: 1 }), theme);
		tb.render(80);
		expect(spy).toHaveBeenCalledWith("selectedBg", expect.stringContaining("Priority"));
		spy.mockRestore();
	});

	it("Submit shows success color when all answered, dim otherwise", () => {
		const spy = vi.spyOn(theme, "fg");
		const answersAll = new Map<number, QuestionAnswer>([
			[0, makeAnswer({ questionIndex: 0 })],
			[1, makeAnswer({ questionIndex: 1 })],
			[2, makeAnswer({ questionIndex: 2 })],
		]);
		const tbAll = new TabBar(cfg({ answers: answersAll, activeTabIndex: 0 }), theme);
		tbAll.render(80);
		expect(spy).toHaveBeenCalledWith("success", expect.stringContaining("Submit"));

		spy.mockClear();
		const tbPartial = new TabBar(cfg({ answers: new Map(), activeTabIndex: 0 }), theme);
		tbPartial.render(80);
		expect(spy).toHaveBeenCalledWith("dim", expect.stringContaining("Submit"));
		spy.mockRestore();
	});

	it("falls back to Q{n+1} when header is absent", () => {
		const tb = new TabBar(
			cfg({
				questions: [{ question: "first" }, { question: "second" }],
				totalTabs: 3,
			}),
			theme,
		);
		const line = tb.render(80)[0];
		expect(line).toContain("Q1");
		expect(line).toContain("Q2");
	});

	it("truncates rather than overflowing when 4 long headers exceed width", () => {
		const tb = new TabBar(
			cfg({
				questions: [
					{ header: "VeryLongHeaderOne", question: "" },
					{ header: "VeryLongHeaderTwo", question: "" },
					{ header: "VeryLongHeaderThree", question: "" },
					{ header: "VeryLongHeaderFour", question: "" },
				],
				totalTabs: 5,
			}),
			theme,
		);
		for (const w of [40, 60, 80, 120]) {
			const lines = tb.render(w);
			expect(visibleWidth(lines[0])).toBeLessThanOrEqual(w);
		}
	});
});
