import type { ChatRowViewProps } from "./chat-row-view.js";
import type { MultiSelectOptionsProps } from "./multi-select-options.js";
import type { OptionListViewProps } from "./option-list-view.js";
import type { PreviewPaneProps } from "./preview-pane.js";
import { ROW_INTENT_META } from "./row-intent.js";
import type { ActiveView } from "./stateful-view.js";
import type { SubmitPickerProps } from "./submit-picker.js";
import type { TabBarProps } from "./tab-bar.js";
import type { QuestionAnswer, QuestionData } from "./types.js";
import type { WrappingSelectItem } from "./wrapping-select.js";

/**
 * Canonical state for the questionnaire dialog. Single source of truth — both the
 * dispatcher (`handleQuestionnaireInput`) and the view layer (`buildDialog`,
 * `MultiSelectOptions.setState`, `SubmitPicker.setState`) read this same shape.
 */
export interface QuestionnaireState {
	currentTab: number;
	optionIndex: number;
	inputMode: boolean;
	notesVisible: boolean;
	chatFocused: boolean;
	answers: ReadonlyMap<number, QuestionAnswer>;
	multiSelectChecked: ReadonlySet<number>;
	/**
	 * Pre-answer notes side-band, keyed by tab index. OPTIONAL on the canonical type to
	 * preserve existing test-factory shapes (`dispatch.test.ts:43-63`,
	 * `multi-select-options.test.ts:11-23`, `submit-picker.test.ts:13-25`); the reducer
	 * treats `undefined` as an empty map. Decoupled from `answers` so adding notes does NOT
	 * make `answers.has(currentTab)` true (otherwise Submit-tab missing-check + `allAnswered()`
	 * would falsely report the question as answered). Merged into the answer at confirm time.
	 */
	notesByTab?: ReadonlyMap<number, string>;
	/**
	 * True iff the currently-focused option carries a non-empty `preview` string.
	 * Computed via `computeFocusedOptionHasPreview` below. Stored on state because it
	 * gates the `notes_enter` action and the "n to add notes" hint chip.
	 */
	focusedOptionHasPreview: boolean;
	/**
	 * Focused row in the Submit-tab picker (0 = Submit answers, 1 = Cancel). Default 0;
	 * reset on every tab switch.
	 */
	submitChoiceIndex: number;
}

/**
 * Per-tick context the dispatcher needs alongside the canonical state. Lives separately
 * from `QuestionnaireState` because these fields don't belong on the view-side state
 * (the view's `setState` consumers should not see `keybindings` or `inputBuffer`).
 */
export interface QuestionnaireRuntime {
	keybindings: { matches(data: string, name: string): boolean };
	inputBuffer: string;
	questions: readonly QuestionData[];
	isMulti: boolean;
	currentItem: WrappingSelectItem | undefined;
	items: readonly WrappingSelectItem[];
}

/**
 * Combined snapshot read by the dispatcher. The view receives the same object —
 * structural typing accepts the superset wherever a `QuestionnaireState` is expected
 * (covariance), so a single `snapshot()` call serves both consumers.
 */
export type QuestionnaireDispatchSnapshot = QuestionnaireState & QuestionnaireRuntime;

/**
 * Pure derivation: does the option focused by `(currentTab, optionIndex)` carry a
 * non-empty `preview` string? Mode gates (chat focus, notes mode, multiSelect) layer
 * on top via dispatch branches; this predicate is intentionally mode-agnostic.
 */
export function computeFocusedOptionHasPreview(
	questions: readonly QuestionData[],
	currentTab: number,
	optionIndex: number,
): boolean {
	const q = questions[currentTab];
	if (!q) return false;
	const opt = q.options[optionIndex];
	return !!opt && typeof opt.preview === "string" && opt.preview.length > 0;
}

/**
 * Numbering for the chat row's WrappingSelect, computed from the active tab's items.
 *
 * The chat row lives in its own one-item WrappingSelect; the host calls this on every tab
 * switch / selection update to keep the chat row's `N. ` label continuous with the visible
 * numbered rows of the active tab. The shape `{ offset, total }` mirrors `WrappingSelect.setNumbering(numberStartOffset, totalItemsForNumbering)` directly.
 */
export function chatNumberingFor(items: readonly WrappingSelectItem[]): {
	offset: number;
	total: number;
} {
	// Count only the visible-numbered rows. The Next sentinel renders without a number
	// (see MultiSelectOptions), so it must NOT advance the chat row's number — otherwise
	// chat reads as "6." next to options labeled 1-4. Sourced from `ROW_INTENT_META[kind].numbered`
	// so adding a new non-numbered kind is a single META edit.
	const count = items.filter((i) => ROW_INTENT_META[i.kind].numbered).length;
	return { offset: count, total: count + 1 };
}

/**
 * Which row in the active tab should be marked as "previously confirmed"? Drives the
 * `WrappingSelect` confirmed-row indicator (label + ` ✔`) when the user navigates back
 * to a question they already answered. Returns `undefined` when no marker should be drawn —
 * multi-select handles its own `[✔]` boxes via `multiSelectChecked`, `kind: "chat"` ends the
 * dialog so the row can never be re-entered, and a missing/non-matching answer (defensive)
 * silently skips the marker.
 */
export function selectConfirmedIndicator(
	questions: readonly QuestionData[],
	currentTab: number,
	answers: ReadonlyMap<number, QuestionAnswer>,
	items: readonly WrappingSelectItem[],
): { index: number; labelOverride?: string } | undefined {
	const q = questions[currentTab];
	if (!q || q.multiSelect === true) return undefined;
	const prior = answers.get(currentTab);
	if (!prior || prior.kind === "chat") return undefined;
	if (prior.kind === "custom") {
		const otherIndex = items.findIndex((it) => it.kind === "other");
		if (otherIndex < 0) return undefined;
		return { index: otherIndex, labelOverride: prior.answer ?? "" };
	}
	if (prior.kind !== "option" || typeof prior.answer !== "string") return undefined;
	const index = items.findIndex((it) => it.kind === "option" && it.label === prior.answer);
	if (index < 0) return undefined;
	return { index };
}

/**
 * Index of the preview pane to display for the current tab. The Submit tab (currentTab ===
 * questions.length) reuses the last question's pane purely for layout — the strategy
 * machinery picks the right body component independently. Defensive against `totalQuestions === 0`.
 */
export function selectActivePreviewPaneIndex(currentTab: number, totalQuestions: number): number {
	if (totalQuestions <= 0) return 0;
	return Math.min(currentTab, totalQuestions - 1);
}

/**
 * Items array for the active tab, with the same Submit-tab clamp as `selectActivePreviewPaneIndex`.
 * Falls back to an empty array if the index lands outside the items array (defensive).
 */
export function selectActiveTabItems(
	itemsByTab: ReadonlyArray<readonly WrappingSelectItem[]>,
	currentTab: number,
	totalQuestions: number,
): readonly WrappingSelectItem[] {
	const idx = selectActivePreviewPaneIndex(currentTab, totalQuestions);
	return itemsByTab[idx] ?? [];
}

/**
 * Discriminated focus selector — single source of truth for "which view
 * owns focus this tick?" Priority order is load-bearing: matches the
 * dispatcher cascade (`dispatch.ts:151-178`) and the reducer's defensive
 * clears (`apply-action.ts:104-126`).
 *
 * - `notes` — notes overlay is visible (highest priority — even on Submit tab).
 * - `submit` — currently on the Submit Tab (multi-question only).
 * - `chat` — chat row owns focus.
 * - `options` — default; the active tab's option list owns focus.
 *
 * Per-component `focused: boolean` flags are derived from one equality
 * check against this discriminant, replacing the four parallel reads at
 * `view-adapter.ts:84,104,106,115`.
 */
export function selectActiveView(
	state: { notesVisible: boolean; chatFocused: boolean; currentTab: number },
	totalQuestions: number,
): ActiveView {
	if (state.notesVisible) return "notes";
	if (state.currentTab === totalQuestions) return "submit";
	if (state.chatFocused) return "chat";
	return "options";
}

/**
 * Per-tick projection for a `MultiSelectOptions` instance. Pre-computes
 * `checked` and `active` per row + the `nextActive` flag so the component's
 * render body is pure styling.
 *
 * Broadcast-safe: every multi-select tab's MSO receives a projection per
 * tick (preserving `view-adapter.ts:108-112` pattern), but only the active
 * tab actually renders its body via `QuestionTabStrategy.bodyComponent`.
 * Non-active MSO instances see `focused === false` because activeView is
 * gated on `state.notesVisible` / `state.chatFocused` / Submit-tab — none
 * of which are true while in options mode on the active tab.
 */
export function selectMultiSelectProps(
	state: QuestionnaireState,
	question: QuestionData,
	activeView: ActiveView,
): MultiSelectOptionsProps {
	const focused = activeView === "options";
	const rows: { checked: boolean; active: boolean }[] = [];
	for (let i = 0; i < question.options.length; i++) {
		rows.push({
			checked: state.multiSelectChecked.has(i),
			active: focused && i === state.optionIndex,
		});
	}
	const nextActive = focused && state.optionIndex === question.options.length;
	return { rows, nextActive };
}

/**
 * Per-tick projection for the active tab's `OptionListView`. Reuses
 * `selectConfirmedIndicator` (no duplication) and adds the focus
 * derivation. Called only for the active pane index — non-active OLV
 * instances retain their last props until tab-switch (current behavior
 * preserved per research artifact: only the active tab's OLV is rendered
 * by `QuestionTabStrategy.bodyComponent`).
 */
export function selectOptionListProps(
	state: QuestionnaireState,
	items: readonly WrappingSelectItem[],
	questions: readonly QuestionData[],
	activeView: ActiveView,
): OptionListViewProps {
	const focused = activeView === "options";
	const confirmed = selectConfirmedIndicator(questions, state.currentTab, state.answers, items);
	return {
		selectedIndex: state.optionIndex,
		focused,
		...(confirmed ? { confirmed } : {}),
	};
}

/**
 * Per-tick projection for the SubmitPicker. Two rows fixed (Submit /
 * Cancel); only `active` per row varies. Focus derives from the
 * `activeView === "submit"` discriminant.
 */
export function selectSubmitPickerProps(
	state: QuestionnaireState,
	totalQuestions: number,
	activeView: ActiveView,
): SubmitPickerProps {
	const focused = activeView === "submit";
	void totalQuestions; // reserved arg for symmetry with other selectors
	return {
		rows: [
			{ active: focused && state.submitChoiceIndex === 0 },
			{ active: focused && state.submitChoiceIndex === 1 },
		],
	};
}

/**
 * Per-tick projection for `PreviewPane`. Eliminates the sibling-coupling
 * where `PreviewPane` formerly read `optionListView.getSelectedIndex()` /
 * `isFocused()` live during render. Both `OptionListView` and
 * `PreviewPane.setProps` now derive `selectedIndex` and `focused` from the
 * same canonical state per tick — the cross-component live read is gone.
 *
 * Called only for the active pane (per current adapter behavior — non-active
 * panes never render).
 */
export function selectPreviewPaneProps(state: QuestionnaireState, activeView: ActiveView): PreviewPaneProps {
	return {
		notesVisible: state.notesVisible,
		selectedIndex: state.optionIndex,
		focused: activeView === "options",
	};
}

/**
 * Per-tick projection for the TabBar. Hoists all per-render derivations
 * (`allAnswered`, `answered`, `isActive`, `submitActive`) out of `tab-bar.ts`
 * into the selector. Replaces the inline `+ 1` magic at `view-adapter.ts:127`
 * — the Submit slot is now an explicit `submit` field, not a hidden
 * `totalTabs` index.
 *
 * `Q{n}` fallback label is computed here once per tab; `header` reads
 * directly from question data.
 */
export function selectTabBarProps(
	state: QuestionnaireState,
	questions: ReadonlyArray<{ header?: string; question: string }>,
): TabBarProps {
	const tabs = questions.map((q, i) => ({
		label: q.header && q.header.length > 0 ? q.header : `Q${i + 1}`,
		answered: state.answers.has(i),
		active: i === state.currentTab,
	}));
	return {
		tabs,
		submit: {
			active: state.currentTab === questions.length,
			allAnswered: state.answers.size === questions.length && questions.length > 0,
		},
	};
}

/**
 * Per-tick projection for `ChatRowView`. Combines focus discriminant with
 * the numbering derivation (`chatNumberingFor` over the active tab's
 * items). Replaces the two adapter-side calls
 * (`chatList.setFocused(state.chatFocused)` at `view-adapter.ts:106` +
 * `chatList.setNumbering(...)` at `:120`) with one selector + one setProps.
 *
 * `activeView === "chat"` is observably equivalent to `state.chatFocused`
 * because the dispatcher cascade (`dispatch.ts:151-178`) and reducer's
 * defensive clears (`apply-action.ts:104-126`) ensure `chatFocused` and
 * `notesVisible`/Submit-tab cannot be true simultaneously.
 */
export function selectChatRowProps(
	state: QuestionnaireState,
	itemsByTab: ReadonlyArray<readonly WrappingSelectItem[]>,
	totalQuestions: number,
	activeView: ActiveView,
): ChatRowViewProps {
	const activeItems = selectActiveTabItems(itemsByTab, state.currentTab, totalQuestions);
	return {
		focused: activeView === "chat",
		numbering: chatNumberingFor(activeItems),
	};
}
