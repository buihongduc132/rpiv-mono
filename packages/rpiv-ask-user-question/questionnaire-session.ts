import { getMarkdownTheme, type Theme } from "@mariozechner/pi-coding-agent";
import { getKeybindings, Input } from "@mariozechner/pi-tui";
import { buildDialog, type DialogComponent } from "./dialog-builder.js";
import { handleQuestionnaireInput } from "./dispatch.js";
import { MultiSelectOptions } from "./multi-select-options.js";
import { PreviewPane } from "./preview-pane.js";
import {
	chatNumberingFor,
	computeFocusedOptionHasPreview,
	type QuestionnaireDispatchSnapshot,
} from "./questionnaire-state.js";
import { SubmitPicker } from "./submit-picker.js";
import { TabBar } from "./tab-bar.js";
import type { QuestionAnswer, QuestionData, QuestionnaireResult, QuestionParams } from "./types.js";
import { WrappingSelect, type WrappingSelectItem, type WrappingSelectTheme } from "./wrapping-select.js";

const CHAT_ABOUT_THIS_LABEL = "Chat about this";
const BACKSPACE_CHARS = new Set(["\x7f", "\b"]);
const ESC_SEQUENCE_PREFIX = "\x1b";

export interface QuestionnaireSessionConfig {
	tui: { terminal: { columns: number }; requestRender(): void };
	theme: Theme;
	params: QuestionParams;
	itemsByTab: WrappingSelectItem[][];
	done: (result: QuestionnaireResult) => void;
}

export interface QuestionnaireSessionComponent {
	render(width: number): string[];
	invalidate(): void;
	handleInput(data: string): void;
}

/**
 * Closes the action → state loop for the questionnaire dialog. Pure dispatcher
 * (`handleQuestionnaireInput`) emits actions; this class owns the state and applies
 * each action via a single-purpose `handle*` method, then re-projects state into all
 * view components via `applyState()`.
 *
 * Mirrors the `rpiv-todo` reducer + thin-controller pattern.
 */
export class QuestionnaireSession {
	private currentTab = 0;
	private optionIndex = 0;
	private inputMode = false;
	private notesVisible = false;
	private chatFocused = false;
	private submitChoiceIndex = 0;
	private readonly answers = new Map<number, QuestionAnswer>();
	private multiSelectChecked = new Set<number>();
	/**
	 * Transient pre-answer notes side-band. Decoupled from `answers` so adding notes
	 * does NOT make `answers.has(currentTab)` true (otherwise Submit-tab missing-check
	 * + `allAnswered()` would falsely report the question as answered). Merged into the
	 * answer at confirm time.
	 */
	private readonly notesByTab = new Map<number, string>();

	private readonly questions: readonly QuestionData[];
	private readonly isMulti: boolean;
	private readonly itemsByTab: WrappingSelectItem[][];
	private readonly previewPanes: PreviewPane[];
	private readonly multiSelectOptionsByTab: ReadonlyArray<MultiSelectOptions | undefined>;
	private readonly submitPicker: SubmitPicker | undefined;
	private readonly tabBar: TabBar | undefined;
	private readonly chatList: WrappingSelect;
	private readonly notesInput: Input;
	private readonly dialog: DialogComponent;

	private readonly tui: QuestionnaireSessionConfig["tui"];
	private readonly done: QuestionnaireSessionConfig["done"];

	readonly component: QuestionnaireSessionComponent;

	constructor(config: QuestionnaireSessionConfig) {
		this.tui = config.tui;
		this.done = config.done;
		this.questions = config.params.questions;
		this.isMulti = this.questions.length > 1;
		this.itemsByTab = config.itemsByTab;

		const selectTheme: WrappingSelectTheme = {
			selectedText: (t) => config.theme.fg("accent", config.theme.bold(t)),
			description: (t) => config.theme.fg("muted", t),
			scrollInfo: (t) => config.theme.fg("dim", t),
		};
		// Chat row lives in its own one-item WrappingSelect. Numbering offset/total updated
		// on every tab switch via `applyState()` so the chat row renders as
		// `(N+1). Chat about this`, where N is the active tab's items.length.
		this.chatList = new WrappingSelect([{ label: CHAT_ABOUT_THIS_LABEL, isChat: true }], 1, selectTheme);
		this.notesInput = new Input();

		const markdownTheme = getMarkdownTheme();
		const getTerminalWidth = () => this.tui.terminal.columns;

		this.previewPanes = this.questions.map(
			(q, i) =>
				new PreviewPane({
					items: this.itemsByTab[i]!,
					question: q,
					theme: config.theme,
					markdownTheme,
					getTerminalWidth,
				}),
		);

		const initialState = this.snapshot();
		this.multiSelectOptionsByTab = this.questions.map((q) =>
			q.multiSelect ? new MultiSelectOptions(config.theme, q, initialState) : undefined,
		);
		this.submitPicker = this.isMulti ? new SubmitPicker(config.theme, initialState) : undefined;
		this.tabBar = this.isMulti
			? new TabBar(
					{
						questions: this.questions,
						answers: new Map(),
						activeTabIndex: 0,
						totalTabs: this.questions.length + 1,
					},
					config.theme,
				)
			: undefined;

		this.dialog = buildDialog({
			theme: config.theme,
			questions: this.questions,
			state: this.snapshot(),
			previewPane: this.previewPanes[0]!,
			tabBar: this.tabBar,
			notesInput: this.notesInput,
			chatList: this.chatList,
			isMulti: this.isMulti,
			multiSelectOptionsByTab: this.multiSelectOptionsByTab,
			submitPicker: this.submitPicker,
			getBodyHeight: (w) => this.computeGlobalContentHeight(w),
			getCurrentBodyHeight: (w) => this.computeCurrentContentHeight(w),
		});

		this.component = {
			render: (w) => this.dialog.render(w),
			invalidate: () => this.dialog.invalidate(),
			handleInput: (data) => this.dispatch(data),
		};

		this.applyState();
	}

	/**
	 * Single dispatch entry point. Two-pass when `notesVisible` is active — once to
	 * probe for `notes_exit`, then forward to the Input on every other key. The
	 * head-guard pattern is load-bearing (any non-Esc/Enter key must reach
	 * `Input.handleInput`).
	 */
	dispatch(data: string): void {
		if (this.notesVisible) {
			const preAction = handleQuestionnaireInput(data, this.snapshot());
			if (preAction.kind === "notes_exit") {
				this.commitNotes();
				this.notesVisible = false;
				this.notesInput.focused = false;
				this.applyState();
				return;
			}
			this.notesInput.handleInput(data);
			this.tui.requestRender();
			return;
		}

		const action = handleQuestionnaireInput(data, this.snapshot());
		switch (action.kind) {
			case "nav":
				this.handleNav(action.nextIndex);
				return;
			case "tab_switch":
				this.handleTabSwitch(action.nextTab);
				return;
			case "confirm":
				this.handleConfirm(action.answer, action.autoAdvanceTab);
				return;
			case "toggle":
				this.handleToggle(action.index);
				return;
			case "multi_confirm":
				this.handleMultiConfirm(action.selected, action.autoAdvanceTab);
				return;
			case "cancel":
				this.handleCancel();
				return;
			case "notes_enter":
				this.handleNotesEnter();
				return;
			case "notes_exit":
				this.handleNotesExit();
				return;
			case "focus_chat":
				this.handleFocusChat();
				return;
			case "focus_options":
				this.handleFocusOptions(action.optionIndex);
				return;
			case "submit_nav":
				this.handleSubmitNav(action.nextIndex);
				return;
			case "submit":
				this.handleSubmit();
				return;
			case "ignore":
				this.handleIgnore(data);
				return;
		}
	}

	snapshot(): QuestionnaireDispatchSnapshot {
		return {
			currentTab: this.currentTab,
			optionIndex: this.optionIndex,
			inputMode: this.inputMode,
			notesVisible: this.notesVisible,
			chatFocused: this.chatFocused,
			answers: this.answers,
			multiSelectChecked: this.multiSelectChecked,
			focusedOptionHasPreview: computeFocusedOptionHasPreview(this.questions, this.currentTab, this.optionIndex),
			submitChoiceIndex: this.submitChoiceIndex,
			keybindings: getKeybindings(),
			inputBuffer: this.previewPanes[this.currentTab]?.getInputBuffer() ?? "",
			questions: this.questions,
			isMulti: this.isMulti,
			currentItem: this.currentItem(),
			items: this.items(),
		};
	}

	private handleNav(nextIndex: number): void {
		this.optionIndex = nextIndex;
		this.inputMode = !!this.currentItem()?.isOther;
		const pane = this.previewPanes[this.currentTab];
		if (!this.inputMode) {
			pane?.clearInputBuffer();
		} else {
			// Entering the `isOther` row: if the prior answer was custom text, restore the
			// typed text so the user can edit/confirm without retyping. Mirrors the notes
			// restoration precedent. Idempotent — `setInputBuffer` overwrites.
			const prior = this.answers.get(this.currentTab);
			if (prior?.wasCustom && typeof prior.answer === "string") {
				pane?.setInputBuffer(prior.answer);
			}
		}
		this.applyState();
	}

	private handleTabSwitch(nextTab: number): void {
		this.switchTab(nextTab);
	}

	private handleConfirm(rawAnswer: QuestionAnswer, autoAdvanceTab: number | undefined): void {
		let answer = rawAnswer;
		if (!answer.wasChat && !answer.wasCustom && answer.answer) {
			const q = this.questions[answer.questionIndex];
			const matched = q?.options.find((o) => o.label === answer.answer);
			if (matched?.preview && matched.preview.length > 0) {
				answer = { ...answer, preview: matched.preview };
			}
		}
		const pendingNotes = this.notesByTab.get(answer.questionIndex);
		if (pendingNotes && pendingNotes.length > 0) {
			answer = { ...answer, notes: pendingNotes };
		}
		this.answers.set(answer.questionIndex, answer);
		if (autoAdvanceTab !== undefined) this.switchTab(autoAdvanceTab);
		else this.submitFinal();
	}

	private handleToggle(index: number): void {
		if (this.multiSelectChecked.has(index)) this.multiSelectChecked.delete(index);
		else this.multiSelectChecked.add(index);
		// Persist on every toggle so tab-switching away (without Enter on Next) doesn't
		// drop the in-progress selection. Submit-tab summary + tab-back restore both read
		// from `answers`, so this single write keeps both views consistent.
		this.persistMultiSelectAnswer();
		this.applyState();
	}

	private handleMultiConfirm(selected: string[], autoAdvanceTab: number | undefined): void {
		const q = this.questions[this.currentTab];
		if (!q) return;
		const pendingNotes = this.notesByTab.get(this.currentTab);
		this.answers.set(this.currentTab, {
			questionIndex: this.currentTab,
			question: q.question,
			answer: null,
			selected,
			...(pendingNotes && pendingNotes.length > 0 ? { notes: pendingNotes } : {}),
		});
		this.syncMultiSelectFromAnswers();
		if (autoAdvanceTab !== undefined) this.switchTab(autoAdvanceTab);
		else this.submitFinal();
	}

	private handleCancel(): void {
		this.done({ answers: this.orderedAnswers(), cancelled: true });
	}

	private handleNotesEnter(): void {
		this.notesVisible = true;
		this.notesInput.focused = true;
		this.notesInput.setValue(this.answers.get(this.currentTab)?.notes ?? "");
		this.applyState();
	}

	private handleNotesExit(): void {
		this.commitNotes();
		this.notesVisible = false;
		this.notesInput.focused = false;
		this.applyState();
	}

	private handleFocusChat(): void {
		this.chatFocused = true;
		this.applyState();
	}

	private handleFocusOptions(optionIndex: number | undefined): void {
		this.chatFocused = false;
		// When the dispatcher carries a target index, update optionIndex too — that drives
		// the continuous chat ↔ options cycle (DOWN-from-chat → 0, UP-from-chat → items-1).
		// Without it, focus simply returns to wherever the user was (legacy contract).
		if (optionIndex !== undefined) {
			this.optionIndex = optionIndex;
			this.inputMode = !!this.currentItem()?.isOther;
			if (!this.inputMode) {
				this.previewPanes[this.currentTab]?.clearInputBuffer();
			}
		}
		this.applyState();
	}

	private handleSubmitNav(nextIndex: 0 | 1): void {
		this.submitChoiceIndex = nextIndex;
		this.applyState();
	}

	private handleSubmit(): void {
		this.submitFinal();
	}

	private handleIgnore(data: string): void {
		if (!this.inputMode) return;
		const pane = this.previewPanes[this.currentTab];
		if (!pane) return;
		if (BACKSPACE_CHARS.has(data)) {
			pane.backspaceInput();
			this.tui.requestRender();
		} else if (data && !data.startsWith(ESC_SEQUENCE_PREFIX)) {
			pane.appendInput(data);
			this.tui.requestRender();
		}
	}

	private items(): WrappingSelectItem[] {
		return this.itemsByTab[this.currentTab] ?? [];
	}

	private currentItem(): WrappingSelectItem | undefined {
		if (this.chatFocused) return { label: CHAT_ABOUT_THIS_LABEL, isChat: true };
		const arr = this.items();
		if (this.optionIndex < arr.length) return arr[this.optionIndex];
		return { label: CHAT_ABOUT_THIS_LABEL, isChat: true };
	}

	private switchTab(nextTab: number): void {
		this.currentTab = nextTab;
		this.optionIndex = 0;
		this.inputMode = false;
		this.notesVisible = false;
		this.chatFocused = false;
		this.submitChoiceIndex = 0;
		this.notesInput.focused = false;
		this.notesInput.setValue(this.notesByTab.get(this.currentTab) ?? this.answers.get(this.currentTab)?.notes ?? "");
		this.syncMultiSelectFromAnswers();
		const paneIndex = Math.min(this.currentTab, this.questions.length - 1);
		const nextPane = this.previewPanes[paneIndex] ?? this.previewPanes[0]!;
		this.dialog.setPreviewPane(nextPane);
		this.applyState();
	}

	private submitFinal(): void {
		this.done({ answers: this.orderedAnswers(), cancelled: false });
	}

	private orderedAnswers(): QuestionAnswer[] {
		const out: QuestionAnswer[] = [];
		for (let i = 0; i < this.questions.length; i++) {
			const a = this.answers.get(i);
			if (a) out.push(a);
		}
		return out;
	}

	private persistMultiSelectAnswer(): void {
		const q = this.questions[this.currentTab];
		if (!q?.multiSelect) return;
		const selected: string[] = [];
		for (let i = 0; i < q.options.length; i++) {
			if (this.multiSelectChecked.has(i)) selected.push(q.options[i]!.label);
		}
		if (selected.length === 0) {
			this.answers.delete(this.currentTab);
			return;
		}
		const pendingNotes = this.notesByTab.get(this.currentTab);
		this.answers.set(this.currentTab, {
			questionIndex: this.currentTab,
			question: q.question,
			answer: null,
			selected,
			...(pendingNotes && pendingNotes.length > 0 ? { notes: pendingNotes } : {}),
		});
	}

	/**
	 * Pure derivation: which row in the active tab should be marked as "previously confirmed"?
	 * Drives the `WrappingSelect` confirmed-row indicator (label + ` ✔` in accent styling) when
	 * the user navigates back to a question they already answered. Returns `undefined` when no
	 * marker should be drawn — multi-select handles its own `[✔]` boxes via `multiSelectChecked`,
	 * `wasChat` ends the dialog so it can never be re-entered, and a missing/non-matching answer
	 * (defensive) silently skips the marker.
	 */
	private confirmedIndexForCurrentTab(): { index: number; labelOverride?: string } | undefined {
		const q = this.questions[this.currentTab];
		if (!q || q.multiSelect === true) return undefined;
		const prior = this.answers.get(this.currentTab);
		if (!prior || prior.wasChat) return undefined;
		const items = this.itemsByTab[this.currentTab] ?? [];
		if (prior.wasCustom) {
			const otherIndex = items.findIndex((it) => it.isOther === true);
			if (otherIndex < 0) return undefined;
			return { index: otherIndex, labelOverride: prior.answer ?? "" };
		}
		if (typeof prior.answer !== "string") return undefined;
		const index = items.findIndex((it) => !it.isOther && !it.isChat && !it.isNext && it.label === prior.answer);
		if (index < 0) return undefined;
		return { index };
	}

	private syncMultiSelectFromAnswers(): void {
		const q = this.questions[this.currentTab];
		if (!q?.multiSelect) {
			this.multiSelectChecked = new Set();
			return;
		}
		const saved = this.answers.get(this.currentTab);
		const labels = saved?.selected ?? [];
		const indices = new Set<number>();
		for (let i = 0; i < q.options.length; i++) {
			if (labels.includes(q.options[i]!.label)) indices.add(i);
		}
		this.multiSelectChecked = indices;
	}

	private commitNotes(): void {
		const trimmed = this.notesInput.getValue().trim();
		if (!this.questions[this.currentTab]) return;
		if (trimmed.length === 0) {
			this.notesByTab.delete(this.currentTab);
			const prev = this.answers.get(this.currentTab);
			if (prev?.notes) {
				const next = { ...prev };
				delete (next as { notes?: string }).notes;
				this.answers.set(this.currentTab, next);
			}
			return;
		}
		this.notesByTab.set(this.currentTab, trimmed);
		const prev = this.answers.get(this.currentTab);
		if (prev) this.answers.set(this.currentTab, { ...prev, notes: trimmed });
	}

	private computeGlobalContentHeight(width: number): number {
		let max = 0;
		for (let i = 0; i < this.questions.length; i++) {
			const q = this.questions[i];
			const h = q?.multiSelect
				? (this.multiSelectOptionsByTab[i]?.naturalHeight(width) ?? 0)
				: (this.previewPanes[i]?.maxNaturalHeight(width) ?? 0);
			if (h > max) max = h;
		}
		return Math.max(1, max);
	}

	private computeCurrentContentHeight(width: number): number {
		const idx = Math.min(this.currentTab, this.questions.length - 1);
		const q = this.questions[idx];
		if (!q) return 0;
		const h = q.multiSelect
			? (this.multiSelectOptionsByTab[idx]?.naturalHeight(width) ?? 0)
			: (this.previewPanes[idx]?.naturalHeight(width) ?? 0);
		return Math.max(0, h);
	}

	/**
	 * Mirror current state into all `setState`-style component setters in one place.
	 * Replaces `refreshDialog + applySelection` from the old closure.
	 */
	private applyState(): void {
		const snap = this.snapshot();
		this.dialog.setState(snap);

		const optionsFocused = !this.notesVisible && !this.chatFocused;

		const pane = this.previewPanes[Math.min(this.currentTab, this.questions.length - 1)] ?? this.previewPanes[0];
		if (pane) {
			pane.setSelectedIndex(this.optionIndex);
			pane.setFocused(optionsFocused);
			pane.setNotesVisible(this.notesVisible);
			const confirmed = this.confirmedIndexForCurrentTab();
			pane.setConfirmedIndex(confirmed?.index, confirmed?.labelOverride);
		}
		this.chatList.setFocused(this.chatFocused);

		// StatefulComponent<DialogState> registry — both setState and setFocused driven
		// in one place. Replaces the historical fan-out where MSO.setState was lazy in
		// dialog-builder.ts while MSO.setFocused was applySelection's responsibility.
		for (const mso of this.multiSelectOptionsByTab) {
			if (!mso) continue;
			mso.setState(snap);
			mso.setFocused(optionsFocused);
		}
		if (this.submitPicker) {
			this.submitPicker.setState(snap);
			this.submitPicker.setFocused(this.currentTab === this.questions.length);
		}

		const activeTabItems = this.itemsByTab[Math.min(this.currentTab, this.questions.length - 1)] ?? [];
		const numbering = chatNumberingFor(activeTabItems);
		this.chatList.setNumbering(numbering.offset, numbering.total);

		if (this.tabBar) {
			this.tabBar.setConfig({
				questions: this.questions,
				answers: new Map(this.answers),
				activeTabIndex: this.currentTab,
				totalTabs: this.questions.length + 1,
			});
		}

		this.tui.requestRender();
	}
}
