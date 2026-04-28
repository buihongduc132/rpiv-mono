import { describe, expect, it } from "vitest";
import { type ApplyContext, applyAction } from "./apply-action.js";
import type { QuestionnaireAction } from "./dispatch.js";
import type { QuestionnaireState } from "./questionnaire-state.js";
import type { QuestionAnswer, QuestionData } from "./types.js";
import type { WrappingSelectItem } from "./wrapping-select.js";

function makeQuestion(over: Partial<QuestionData> = {}): QuestionData {
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

function makeState(over: Partial<QuestionnaireState> = {}): QuestionnaireState {
	return {
		currentTab: over.currentTab ?? 0,
		optionIndex: over.optionIndex ?? 0,
		inputMode: over.inputMode ?? false,
		notesVisible: over.notesVisible ?? false,
		chatFocused: over.chatFocused ?? false,
		answers: over.answers ?? new Map(),
		multiSelectChecked: over.multiSelectChecked ?? new Set(),
		notesByTab: over.notesByTab,
		focusedOptionHasPreview: over.focusedOptionHasPreview ?? false,
		submitChoiceIndex: over.submitChoiceIndex ?? 0,
	};
}

function makeCtx(over: Partial<ApplyContext> = {}): ApplyContext {
	const questions = over.questions ?? [makeQuestion()];
	return {
		questions,
		itemsByTab: over.itemsByTab ?? questions.map(() => itemsRegular),
		pendingNotesValue: over.pendingNotesValue ?? "",
	};
}

describe("applyAction — nav", () => {
	it("regular nav emits clear_input_buffer", () => {
		const r = applyAction(makeState(), { kind: "nav", nextIndex: 1 }, makeCtx());
		expect(r.state.optionIndex).toBe(1);
		expect(r.state.inputMode).toBe(false);
		expect(r.effects).toEqual([{ kind: "clear_input_buffer" }]);
	});

	it("nav onto isOther row with prior wasCustom answer restores the buffer", () => {
		const answers = new Map<number, QuestionAnswer>([
			[0, { questionIndex: 0, question: "Pick one", answer: "Hello", wasCustom: true }],
		]);
		const ctx = makeCtx({ itemsByTab: [itemsWithOther] });
		const r = applyAction(makeState({ answers }), { kind: "nav", nextIndex: 2 }, ctx);
		expect(r.state.inputMode).toBe(true);
		expect(r.effects).toEqual([{ kind: "set_input_buffer", value: "Hello" }]);
	});

	it("nav onto isOther row with no prior wasCustom emits no input effect", () => {
		const ctx = makeCtx({ itemsByTab: [itemsWithOther] });
		const r = applyAction(makeState(), { kind: "nav", nextIndex: 2 }, ctx);
		expect(r.state.inputMode).toBe(true);
		expect(r.effects).toEqual([]);
	});
});

describe("applyAction — tab_switch", () => {
	it("emits set_active_preview_pane + set_notes_focused(false) + set_notes_value", () => {
		const r = applyAction(
			makeState(),
			{ kind: "tab_switch", nextTab: 1 },
			makeCtx({ questions: [makeQuestion(), makeQuestion()], itemsByTab: [itemsRegular, itemsRegular] }),
		);
		expect(r.state.currentTab).toBe(1);
		expect(r.state.optionIndex).toBe(0);
		expect(r.state.notesVisible).toBe(false);
		expect(r.state.chatFocused).toBe(false);
		expect(r.effects).toEqual([
			{ kind: "set_active_preview_pane", paneIndex: 1 },
			{ kind: "set_notes_focused", focused: false },
			{ kind: "set_notes_value", value: "" },
		]);
	});

	it("Submit-tab clamps preview pane to last question index", () => {
		const r = applyAction(
			makeState(),
			{ kind: "tab_switch", nextTab: 2 },
			makeCtx({ questions: [makeQuestion(), makeQuestion()], itemsByTab: [itemsRegular, itemsRegular] }),
		);
		expect(r.effects[0]).toEqual({ kind: "set_active_preview_pane", paneIndex: 1 });
	});
});

describe("applyAction — confirm", () => {
	it("regular option without preview emits done with the answer", () => {
		const action: QuestionnaireAction = {
			kind: "confirm",
			answer: { questionIndex: 0, question: "Pick one", answer: "A", wasCustom: false },
		};
		const r = applyAction(makeState(), action, makeCtx());
		expect(r.state.answers.get(0)?.answer).toBe("A");
		expect(r.effects).toEqual([{ kind: "done", result: { answers: [r.state.answers.get(0)!], cancelled: false } }]);
	});

	it("regular option matching a preview-bearing option augments answer.preview", () => {
		const questions = [
			makeQuestion({
				options: [
					{ label: "A", description: "a", preview: "code" },
					{ label: "B", description: "b" },
				],
			}),
		];
		const action: QuestionnaireAction = {
			kind: "confirm",
			answer: { questionIndex: 0, question: "Pick one", answer: "A", wasCustom: false },
		};
		const r = applyAction(makeState(), action, makeCtx({ questions }));
		expect(r.state.answers.get(0)?.preview).toBe("code");
	});

	it("merges pendingNotes from notesByTab into the confirmed answer", () => {
		const action: QuestionnaireAction = {
			kind: "confirm",
			answer: { questionIndex: 0, question: "Pick one", answer: "A", wasCustom: false },
		};
		const state = makeState({ notesByTab: new Map([[0, "  side note  "]]) });
		const r = applyAction(state, action, makeCtx());
		expect(r.state.answers.get(0)?.notes).toBe("  side note  ");
	});

	it("autoAdvanceTab dispatches a tab_switch result instead of done", () => {
		const action: QuestionnaireAction = {
			kind: "confirm",
			answer: { questionIndex: 0, question: "Pick one", answer: "A" },
			autoAdvanceTab: 1,
		};
		const ctx = makeCtx({ questions: [makeQuestion(), makeQuestion()], itemsByTab: [itemsRegular, itemsRegular] });
		const r = applyAction(makeState(), action, ctx);
		expect(r.state.currentTab).toBe(1);
		expect(r.effects.some((e) => e.kind === "set_active_preview_pane")).toBe(true);
		expect(r.effects.some((e) => e.kind === "done")).toBe(false);
	});
});

describe("applyAction — toggle", () => {
	it("toggles index 0 on then off and persists into answers", () => {
		const ctx = makeCtx({ questions: [makeQuestion({ multiSelect: true })] });
		const r1 = applyAction(makeState(), { kind: "toggle", index: 0 }, ctx);
		expect(r1.state.multiSelectChecked.has(0)).toBe(true);
		expect(r1.state.answers.get(0)?.selected).toEqual(["A"]);
		const r2 = applyAction(r1.state, { kind: "toggle", index: 0 }, ctx);
		expect(r2.state.multiSelectChecked.has(0)).toBe(false);
		expect(r2.state.answers.has(0)).toBe(false);
	});
});

describe("applyAction — round-trip property [toggle, tab_switch, tab_switch_back] preserves multiSelectChecked (precedent f4fdd25)", () => {
	it("multiSelectChecked is reconstructed from answers on tab-back", () => {
		const questions = [makeQuestion({ multiSelect: true }), makeQuestion()];
		const ctx = makeCtx({ questions, itemsByTab: questions.map(() => itemsRegular) });

		let s = makeState();
		s = applyAction(s, { kind: "toggle", index: 0 }, ctx).state;
		s = applyAction(s, { kind: "toggle", index: 1 }, ctx).state;
		expect([...s.multiSelectChecked].sort()).toEqual([0, 1]);
		expect(s.answers.get(0)?.selected).toEqual(["A", "B"]);

		s = applyAction(s, { kind: "tab_switch", nextTab: 1 }, ctx).state;
		expect([...s.multiSelectChecked]).toEqual([]);

		s = applyAction(s, { kind: "tab_switch", nextTab: 0 }, ctx).state;
		expect([...s.multiSelectChecked].sort()).toEqual([0, 1]);
	});
});

describe("applyAction — multi_confirm", () => {
	it("persists answer + multiSelectChecked from action.selected", () => {
		const ctx = makeCtx({ questions: [makeQuestion({ multiSelect: true })] });
		const r = applyAction(makeState(), { kind: "multi_confirm", selected: ["A", "B"] }, ctx);
		expect(r.state.answers.get(0)?.selected).toEqual(["A", "B"]);
		expect([...r.state.multiSelectChecked].sort()).toEqual([0, 1]);
		expect(r.effects.some((e) => e.kind === "done")).toBe(true);
	});
});

describe("applyAction — cancel/submit", () => {
	it("cancel emits done with cancelled: true", () => {
		const r = applyAction(makeState(), { kind: "cancel" }, makeCtx());
		expect(r.effects).toEqual([{ kind: "done", result: { answers: [], cancelled: true } }]);
	});
	it("submit emits done with cancelled: false", () => {
		const r = applyAction(makeState(), { kind: "submit" }, makeCtx());
		expect(r.effects).toEqual([{ kind: "done", result: { answers: [], cancelled: false } }]);
	});
});

describe("applyAction — notes_enter / notes_exit", () => {
	it("notes_enter loads existing answer.notes into the input via set_notes_value", () => {
		const answers = new Map<number, QuestionAnswer>([
			[0, { questionIndex: 0, question: "q", answer: "A", notes: "old note" }],
		]);
		const r = applyAction(makeState({ answers }), { kind: "notes_enter" }, makeCtx());
		expect(r.state.notesVisible).toBe(true);
		expect(r.effects).toEqual([
			{ kind: "set_notes_value", value: "old note" },
			{ kind: "set_notes_focused", focused: true },
		]);
	});

	it("notes_exit with empty pendingNotesValue clears notesByTab + strips answer.notes", () => {
		const answers = new Map<number, QuestionAnswer>([
			[0, { questionIndex: 0, question: "q", answer: "A", notes: "old note" }],
		]);
		const state = makeState({ answers, notesByTab: new Map([[0, "old note"]]), notesVisible: true });
		const r = applyAction(state, { kind: "notes_exit" }, makeCtx({ pendingNotesValue: "" }));
		expect(r.state.notesVisible).toBe(false);
		expect(r.state.notesByTab?.has(0)).toBe(false);
		expect(r.state.answers.get(0)?.notes).toBeUndefined();
	});

	it("notes_exit with non-empty pendingNotesValue persists into both notesByTab and answer.notes", () => {
		const answers = new Map<number, QuestionAnswer>([[0, { questionIndex: 0, question: "q", answer: "A" }]]);
		const r = applyAction(
			makeState({ answers, notesVisible: true }),
			{ kind: "notes_exit" },
			makeCtx({ pendingNotesValue: "fresh" }),
		);
		expect(r.state.notesByTab?.get(0)).toBe("fresh");
		expect(r.state.answers.get(0)?.notes).toBe("fresh");
	});
});

describe("applyAction — focus_chat / focus_options / submit_nav / ignore", () => {
	it("focus_chat sets chatFocused", () => {
		const r = applyAction(makeState(), { kind: "focus_chat" }, makeCtx());
		expect(r.state.chatFocused).toBe(true);
		expect(r.effects).toEqual([]);
	});

	it("focus_options(optionIndex=0) clears chatFocused and emits clear_input_buffer", () => {
		const r = applyAction(makeState({ chatFocused: true }), { kind: "focus_options", optionIndex: 0 }, makeCtx());
		expect(r.state.chatFocused).toBe(false);
		expect(r.state.optionIndex).toBe(0);
		expect(r.effects).toEqual([{ kind: "clear_input_buffer" }]);
	});

	it("focus_options without optionIndex preserves cursor and emits no effect", () => {
		const r = applyAction(makeState({ chatFocused: true, optionIndex: 1 }), { kind: "focus_options" }, makeCtx());
		expect(r.state.optionIndex).toBe(1);
		expect(r.effects).toEqual([]);
	});

	it("submit_nav updates submitChoiceIndex with no effects", () => {
		const r = applyAction(makeState(), { kind: "submit_nav", nextIndex: 1 }, makeCtx());
		expect(r.state.submitChoiceIndex).toBe(1);
		expect(r.effects).toEqual([]);
	});

	it("ignore is identity (state unchanged, no effects)", () => {
		const s = makeState({ optionIndex: 2 });
		const r = applyAction(s, { kind: "ignore" }, makeCtx());
		expect(r.state).toEqual(s);
		expect(r.effects).toEqual([]);
	});
});
