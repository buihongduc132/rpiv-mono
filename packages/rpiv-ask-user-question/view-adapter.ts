import type { ChatRowView } from "./chat-row-view.js";
import type { DialogComponent } from "./dialog-builder.js";
import type { MultiSelectOptions } from "./multi-select-options.js";
import type { OptionListView } from "./option-list-view.js";
import type { PreviewPane } from "./preview-pane.js";
import {
	type QuestionnaireState,
	selectActivePreviewPaneIndex,
	selectActiveView,
	selectChatRowProps,
	selectMultiSelectProps,
	selectOptionListProps,
	selectPreviewPaneProps,
	selectSubmitPickerProps,
	selectTabBarProps,
} from "./questionnaire-state.js";
import type { SubmitPicker } from "./submit-picker.js";
import type { TabBar } from "./tab-bar.js";
import type { QuestionData } from "./types.js";
import type { WrappingSelectItem } from "./wrapping-select.js";

export interface QuestionnaireViewAdapterConfig {
	tui: { requestRender(): void };
	questions: readonly QuestionData[];
	itemsByTab: ReadonlyArray<readonly WrappingSelectItem[]>;
	optionListViewsByTab: ReadonlyArray<OptionListView>;
	previewPanes: readonly PreviewPane[];
	chatRow: ChatRowView;
	multiSelectOptionsByTab: ReadonlyArray<MultiSelectOptions | undefined>;
	submitPicker: SubmitPicker | undefined;
	tabBar: TabBar | undefined;
	dialog: DialogComponent;
}

/**
 * View fan-out: drives every component setter from the canonical state via named selectors.
 *
 * `OptionListView` receives a typed `OptionListViewProps` projection via `setProps` per tick
 * (`selectedIndex`, `focused`, optional `confirmed`) — replacing the legacy three-setter
 * triplet. `PreviewPane` receives a typed `PreviewPaneProps` projection via `setProps`
 * (`notesVisible`, `selectedIndex`, `focused`) — the cross-component live read of
 * `OptionListView` is gone.
 *
 * The adapter owns the components but never owns mutable state — every projection is read fresh
 * from the input `state` argument, so there is no risk of stale view-side data.
 */
export class QuestionnaireViewAdapter {
	private readonly tui: QuestionnaireViewAdapterConfig["tui"];
	private readonly questions: readonly QuestionData[];
	private readonly itemsByTab: ReadonlyArray<readonly WrappingSelectItem[]>;
	private readonly optionListViewsByTab: ReadonlyArray<OptionListView>;
	private readonly previewPanes: readonly PreviewPane[];
	private readonly chatRow: ChatRowView;
	private readonly multiSelectOptionsByTab: ReadonlyArray<MultiSelectOptions | undefined>;
	private readonly submitPicker: SubmitPicker | undefined;
	private readonly tabBar: TabBar | undefined;
	private readonly dialog: DialogComponent;

	constructor(config: QuestionnaireViewAdapterConfig) {
		this.tui = config.tui;
		this.questions = config.questions;
		this.itemsByTab = config.itemsByTab;
		this.optionListViewsByTab = config.optionListViewsByTab;
		this.previewPanes = config.previewPanes;
		this.chatRow = config.chatRow;
		this.multiSelectOptionsByTab = config.multiSelectOptionsByTab;
		this.submitPicker = config.submitPicker;
		this.tabBar = config.tabBar;
		this.dialog = config.dialog;
	}

	/**
	 * Project canonical state through selectors → component setters and request a render.
	 * Idempotent — calling twice with the same state produces the same setter sequence.
	 */
	apply(state: QuestionnaireState): void {
		const totalQuestions = this.questions.length;
		const activeView = selectActiveView(state, totalQuestions);

		const paneIndex = selectActivePreviewPaneIndex(state.currentTab, totalQuestions);
		const activePreviewPane = this.previewPanes[paneIndex] ?? this.previewPanes[0]!;

		this.dialog.setProps({ state, activePreviewPane });

		const view = this.optionListViewsByTab[paneIndex] ?? this.optionListViewsByTab[0];
		if (view) {
			view.setProps(selectOptionListProps(state, this.itemsByTab[paneIndex] ?? [], this.questions, activeView));
		}

		activePreviewPane.setProps(selectPreviewPaneProps(state, activeView));

		this.chatRow.setProps(selectChatRowProps(state, this.itemsByTab, totalQuestions, activeView));

		for (let i = 0; i < this.multiSelectOptionsByTab.length; i++) {
			const mso = this.multiSelectOptionsByTab[i];
			if (!mso) continue;
			const q = this.questions[i];
			if (!q) continue;
			mso.setProps(selectMultiSelectProps(state, q, activeView));
		}
		if (this.submitPicker) {
			this.submitPicker.setProps(selectSubmitPickerProps(state, totalQuestions, activeView));
		}

		if (this.tabBar) {
			this.tabBar.setProps(selectTabBarProps(state, this.questions));
		}

		this.tui.requestRender();
	}
}
