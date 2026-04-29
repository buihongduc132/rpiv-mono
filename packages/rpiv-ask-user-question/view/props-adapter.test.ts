import { describe, expect, it, vi } from "vitest";
import { InputBuffer } from "../state/input-buffer.js";
import type { QuestionnaireState } from "../state/questionnaire-state.js";
import type { QuestionAnswer, QuestionData } from "../tool/types.js";
import type { ChatRowView, ChatRowViewProps } from "./components/chat-row-view.js";
import type { MultiSelectView, MultiSelectViewProps } from "./components/multi-select-view.js";
import type { OptionListView, OptionListViewProps } from "./components/option-list-view.js";
import type { PreviewPane, PreviewPaneProps } from "./components/preview/preview-pane.js";
import type { SubmitPicker, SubmitPickerProps } from "./components/submit-picker.js";
import type { TabBar, TabBarProps } from "./components/tab-bar.js";
import type { WrappingSelectItem } from "./components/wrapping-select.js";
import type { DialogProps } from "./dialog-builder.js";
import { QuestionnairePropsAdapter } from "./props-adapter.js";
import type { StatefulView } from "./stateful-view.js";
import type { TabComponents } from "./tab-components.js";

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

function makeFixture(overQuestions?: QuestionData[]) {
	const questions = overQuestions ?? [makeQuestion(), makeQuestion()];
	const itemsByTab: WrappingSelectItem[][] = questions.map(() => [
		{ kind: "option", label: "A" },
		{ kind: "option", label: "B" },
	]);

	const stub = <P>(): StatefulView<P> => ({
		setProps: vi.fn(),
		render: () => [],
		invalidate: () => {},
		handleInput: () => {},
	});

	const tabsByIndex: TabComponents[] = questions.map((q) => ({
		optionList: stub<OptionListViewProps>() as unknown as OptionListView,
		preview: stub<PreviewPaneProps>() as unknown as PreviewPane,
		multiSelect: q.multiSelect ? (stub<MultiSelectViewProps>() as unknown as MultiSelectView) : undefined,
	}));

	const chatRow = stub<ChatRowViewProps>() as unknown as ChatRowView;
	const submitPicker = stub<SubmitPickerProps>() as unknown as SubmitPicker;
	const tabBar = stub<TabBarProps>() as unknown as TabBar;
	const dialog = stub<DialogProps>();
	const inputBuffer = new InputBuffer();
	const tui = { requestRender: vi.fn() };

	const adapter = new QuestionnairePropsAdapter({
		tui,
		questions,
		itemsByTab,
		tabsByIndex,
		chatRow,
		submitPicker,
		tabBar,
		dialog,
		inputBuffer,
	});
	return {
		adapter,
		tui,
		dialog,
		tabsByIndex,
		chatRow,
		submitPicker,
		tabBar,
		questions,
		inputBuffer,
	};
}

describe("QuestionnairePropsAdapter.apply", () => {
	it("calls dialog.setProps exactly once with state + activePreviewPane", () => {
		const { adapter, dialog, tabsByIndex } = makeFixture();
		const state = makeState();
		adapter.apply(state);
		const calls = (dialog.setProps as ReturnType<typeof vi.fn>).mock.calls;
		expect(calls.length).toBe(1);
		expect(calls[0]![0]).toEqual({ state, activePreviewPane: tabsByIndex[0]!.preview });
	});

	it("drives the active OptionListView via setProps and the active PreviewPane via setProps", () => {
		const { adapter, tabsByIndex } = makeFixture();
		const answers = new Map<number, QuestionAnswer>([
			[0, { questionIndex: 0, question: "Pick one", kind: "option", answer: "B" }],
		]);
		adapter.apply(makeState({ optionIndex: 1, answers }));
		expect(tabsByIndex[0]!.optionList.setProps).toHaveBeenLastCalledWith({
			selectedIndex: 1,
			focused: true,
			inputBuffer: "",
			confirmed: { index: 1 },
		});
		expect(tabsByIndex[0]!.preview.setProps).toHaveBeenLastCalledWith({
			notesVisible: false,
			selectedIndex: 1,
			focused: true,
		});
	});

	it("suppresses option focus when notes is visible or chat is focused", () => {
		const { adapter, tabsByIndex } = makeFixture();
		adapter.apply(makeState({ notesVisible: true }));
		expect(tabsByIndex[0]!.optionList.setProps).toHaveBeenLastCalledWith(expect.objectContaining({ focused: false }));
		adapter.apply(makeState({ chatFocused: true }));
		expect(tabsByIndex[0]!.optionList.setProps).toHaveBeenLastCalledWith(expect.objectContaining({ focused: false }));
	});

	it("focuses the submitPicker only when on the Submit tab", () => {
		const { adapter, submitPicker, questions } = makeFixture();
		adapter.apply(makeState({ currentTab: 0 }));
		expect(submitPicker.setProps).toHaveBeenLastCalledWith({
			rows: [{ active: false }, { active: false }],
		});
		adapter.apply(makeState({ currentTab: questions.length, submitChoiceIndex: 0 }));
		expect(submitPicker.setProps).toHaveBeenLastCalledWith({
			rows: [{ active: true }, { active: false }],
		});
		adapter.apply(makeState({ currentTab: questions.length, submitChoiceIndex: 1 }));
		expect(submitPicker.setProps).toHaveBeenLastCalledWith({
			rows: [{ active: false }, { active: true }],
		});
	});

	it("forwards selectTabBarProps projection to tabBar.setProps", () => {
		const { adapter, tabBar } = makeFixture();
		const answers = new Map<number, QuestionAnswer>([
			[0, { questionIndex: 0, question: "q", kind: "option", answer: "A" }],
		]);
		adapter.apply(makeState({ answers }));
		const arg = (tabBar.setProps as ReturnType<typeof vi.fn>).mock.calls[0]![0];
		expect(arg.tabs).toHaveLength(2);
		expect(arg.tabs[0]).toEqual({ label: "H", answered: true, active: true });
		expect(arg.tabs[1]).toEqual({ label: "H", answered: false, active: false });
		expect(arg.submit).toEqual({ active: false, allAnswered: false });
	});

	it("calls tui.requestRender exactly once", () => {
		const { adapter, tui } = makeFixture();
		adapter.apply(makeState());
		expect(tui.requestRender).toHaveBeenCalledTimes(1);
	});

	it("multi-select panes get setProps on every apply", () => {
		const questions = [makeQuestion({ multiSelect: true }), makeQuestion()];
		const { adapter, tabsByIndex } = makeFixture(questions);
		const state = makeState();
		adapter.apply(state);
		const mso = tabsByIndex[0]!.multiSelect!;
		expect(mso.setProps).toHaveBeenCalledTimes(1);
		const arg = (mso.setProps as ReturnType<typeof vi.fn>).mock.calls[0]![0];
		expect(arg).toMatchObject({ rows: expect.any(Array), nextActive: false });
		expect(arg.rows[0]).toMatchObject({ active: true, checked: false });
	});

	it("threads inputBuffer cell value through to OptionListView.setProps", () => {
		const { adapter, tabsByIndex, inputBuffer } = makeFixture();
		inputBuffer.set("typed");
		adapter.apply(makeState());
		expect(tabsByIndex[0]!.optionList.setProps).toHaveBeenLastCalledWith(
			expect.objectContaining({ inputBuffer: "typed" }),
		);
	});
});

describe("QuestionnairePropsAdapter.apply — preview pane resolution", () => {
	it("forwards the resolved pane to dialog.setProps via activePreviewPane", () => {
		const { adapter, dialog, tabsByIndex } = makeFixture();
		adapter.apply(makeState({ currentTab: 1 }));
		expect((dialog.setProps as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatchObject({
			activePreviewPane: tabsByIndex[1]!.preview,
		});
	});
});
