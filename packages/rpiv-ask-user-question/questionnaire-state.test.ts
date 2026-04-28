import { describe, expect, it } from "vitest";
import {
	chatNumberingFor,
	computeFocusedOptionHasPreview,
	selectActivePreviewPaneIndex,
	selectActiveTabItems,
	selectConfirmedIndicator,
	selectOptionsFocused,
	selectSubmitPickerFocused,
} from "./questionnaire-state.js";
import type { QuestionAnswer, QuestionData } from "./types.js";
import type { WrappingSelectItem } from "./wrapping-select.js";

function q(over: Partial<QuestionData> = {}): QuestionData {
	return {
		question: over.question ?? "Pick one",
		header: over.header ?? "H",
		options: over.options ?? [
			{ label: "A", description: "a" },
			{ label: "B", description: "b" },
		],
		multiSelect: over.multiSelect,
	};
}

const itemsRegular: WrappingSelectItem[] = [{ label: "A" }, { label: "B" }];
const itemsWithOther: WrappingSelectItem[] = [
	{ label: "A" },
	{ label: "B" },
	{ label: "Type something.", isOther: true },
];

describe("selectConfirmedIndicator", () => {
	it("returns undefined when the question is multiSelect", () => {
		const answers = new Map<number, QuestionAnswer>([[0, { questionIndex: 0, question: "q", answer: "A" }]]);
		expect(selectConfirmedIndicator([q({ multiSelect: true })], 0, answers, itemsRegular)).toBeUndefined();
	});

	it("returns undefined when there is no prior answer for the tab", () => {
		expect(selectConfirmedIndicator([q()], 0, new Map(), itemsRegular)).toBeUndefined();
	});

	it("returns undefined when the prior answer was wasChat", () => {
		const answers = new Map<number, QuestionAnswer>([
			[0, { questionIndex: 0, question: "q", answer: "Chat about this", wasChat: true }],
		]);
		expect(selectConfirmedIndicator([q()], 0, answers, itemsRegular)).toBeUndefined();
	});

	it("returns the isOther index + labelOverride when the prior answer was wasCustom", () => {
		const answers = new Map<number, QuestionAnswer>([
			[0, { questionIndex: 0, question: "q", answer: "Hello", wasCustom: true }],
		]);
		expect(selectConfirmedIndicator([q()], 0, answers, itemsWithOther)).toEqual({ index: 2, labelOverride: "Hello" });
	});

	it("returns undefined when wasCustom but the items array has no isOther row", () => {
		const answers = new Map<number, QuestionAnswer>([
			[0, { questionIndex: 0, question: "q", answer: "Hello", wasCustom: true }],
		]);
		expect(selectConfirmedIndicator([q()], 0, answers, itemsRegular)).toBeUndefined();
	});

	it("returns the matching index for a regular label answer", () => {
		const answers = new Map<number, QuestionAnswer>([[0, { questionIndex: 0, question: "q", answer: "B" }]]);
		expect(selectConfirmedIndicator([q()], 0, answers, itemsRegular)).toEqual({ index: 1 });
	});

	it("returns undefined when the prior label matches no row (defensive)", () => {
		const answers = new Map<number, QuestionAnswer>([[0, { questionIndex: 0, question: "q", answer: "ZZ" }]]);
		expect(selectConfirmedIndicator([q()], 0, answers, itemsRegular)).toBeUndefined();
	});
});

describe("selectOptionsFocused", () => {
	it("is true when neither notes nor chat owns focus", () => {
		expect(selectOptionsFocused({ notesVisible: false, chatFocused: false })).toBe(true);
	});
	it("is false when notes is visible", () => {
		expect(selectOptionsFocused({ notesVisible: true, chatFocused: false })).toBe(false);
	});
	it("is false when chat is focused", () => {
		expect(selectOptionsFocused({ notesVisible: false, chatFocused: true })).toBe(false);
	});
	it("is false when both notes and chat would claim focus (defensive)", () => {
		expect(selectOptionsFocused({ notesVisible: true, chatFocused: true })).toBe(false);
	});
});

describe("selectActivePreviewPaneIndex", () => {
	it("returns currentTab when within range", () => {
		expect(selectActivePreviewPaneIndex(1, 3)).toBe(1);
	});
	it("clamps to the last question index when on the Submit tab", () => {
		expect(selectActivePreviewPaneIndex(3, 3)).toBe(2);
	});
	it("returns 0 when totalQuestions is 0 (defensive)", () => {
		expect(selectActivePreviewPaneIndex(0, 0)).toBe(0);
	});
});

describe("selectActiveTabItems", () => {
	it("returns the items for the current tab", () => {
		const a: WrappingSelectItem[] = [{ label: "A" }];
		const b: WrappingSelectItem[] = [{ label: "B" }];
		expect(selectActiveTabItems([a, b], 1, 2)).toBe(b);
	});
	it("clamps Submit-tab to the last question's items", () => {
		const a: WrappingSelectItem[] = [{ label: "A" }];
		expect(selectActiveTabItems([a], 1, 1)).toBe(a);
	});
	it("falls back to an empty array when the index lands outside (defensive)", () => {
		expect(selectActiveTabItems([], 0, 0)).toEqual([]);
	});
});

describe("selectSubmitPickerFocused", () => {
	it("is true exactly when currentTab equals totalQuestions", () => {
		expect(selectSubmitPickerFocused(2, 2)).toBe(true);
	});
	it("is false on any question tab", () => {
		expect(selectSubmitPickerFocused(0, 2)).toBe(false);
		expect(selectSubmitPickerFocused(1, 2)).toBe(false);
	});
});

describe("preexisting selectors retained", () => {
	it("computeFocusedOptionHasPreview returns true when the focused option carries a preview", () => {
		const questions = [
			q({
				options: [
					{ label: "A", description: "a", preview: "code" },
					{ label: "B", description: "b" },
				],
			}),
		];
		expect(computeFocusedOptionHasPreview(questions, 0, 0)).toBe(true);
		expect(computeFocusedOptionHasPreview(questions, 0, 1)).toBe(false);
	});
	it("chatNumberingFor excludes isNext rows from the count", () => {
		const items: WrappingSelectItem[] = [{ label: "A" }, { label: "B" }, { label: "Next", isNext: true }];
		expect(chatNumberingFor(items)).toEqual({ offset: 2, total: 3 });
	});
});
