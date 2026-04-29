import type { InputBuffer } from "../state/input-buffer.js";
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
} from "../state/questionnaire-state.js";
import type { QuestionData } from "../tool/types.js";
import type { ChatRowView } from "./components/chat-row-view.js";
import type { SubmitPicker } from "./components/submit-picker.js";
import type { TabBar } from "./components/tab-bar.js";
import type { WrappingSelectItem } from "./components/wrapping-select.js";
import type { DialogProps } from "./dialog-builder.js";
import type { StatefulView } from "./stateful-view.js";
import type { TabComponents } from "./tab-components.js";

export interface QuestionnairePropsAdapterConfig {
	tui: { requestRender(): void };
	questions: readonly QuestionData[];
	itemsByTab: ReadonlyArray<readonly WrappingSelectItem[]>;
	tabsByIndex: ReadonlyArray<TabComponents>;
	chatRow: ChatRowView;
	submitPicker: SubmitPicker | undefined;
	tabBar: TabBar | undefined;
	dialog: StatefulView<DialogProps>;
	inputBuffer: InputBuffer;
}

/**
 * View fan-out: drives every component setter from the canonical state via named selectors.
 * The `inputBuffer` cell is read per tick so `selectOptionListProps` sees the live value.
 */
export class QuestionnairePropsAdapter {
	private readonly tui: QuestionnairePropsAdapterConfig["tui"];
	private readonly questions: readonly QuestionData[];
	private readonly itemsByTab: ReadonlyArray<readonly WrappingSelectItem[]>;
	private readonly tabsByIndex: ReadonlyArray<TabComponents>;
	private readonly chatRow: ChatRowView;
	private readonly submitPicker: SubmitPicker | undefined;
	private readonly tabBar: TabBar | undefined;
	private readonly dialog: StatefulView<DialogProps>;
	private readonly inputBuffer: InputBuffer;

	constructor(config: QuestionnairePropsAdapterConfig) {
		this.tui = config.tui;
		this.questions = config.questions;
		this.itemsByTab = config.itemsByTab;
		this.tabsByIndex = config.tabsByIndex;
		this.chatRow = config.chatRow;
		this.submitPicker = config.submitPicker;
		this.tabBar = config.tabBar;
		this.dialog = config.dialog;
		this.inputBuffer = config.inputBuffer;
	}

	apply(state: QuestionnaireState): void {
		const totalQuestions = this.questions.length;
		const activeView = selectActiveView(state, totalQuestions);

		const paneIndex = selectActivePreviewPaneIndex(state.currentTab, totalQuestions);
		const activePreviewPane = this.tabsByIndex[paneIndex]?.preview ?? this.tabsByIndex[0]!.preview;

		this.dialog.setProps({ state, activePreviewPane });

		for (let i = 0; i < this.tabsByIndex.length; i++) {
			const tab = this.tabsByIndex[i]!;
			const q = this.questions[i];
			if (i === paneIndex) {
				tab.optionList.setProps(
					selectOptionListProps(
						state,
						this.itemsByTab[i] ?? [],
						this.questions,
						activeView,
						this.inputBuffer.get(),
					),
				);
				tab.preview.setProps(selectPreviewPaneProps(state, activeView));
			}
			if (tab.multiSelect && q) {
				tab.multiSelect.setProps(selectMultiSelectProps(state, q, activeView));
			}
		}

		this.chatRow.setProps(selectChatRowProps(state, this.itemsByTab, totalQuestions, activeView));

		if (this.submitPicker) {
			this.submitPicker.setProps(selectSubmitPickerProps(state, totalQuestions, activeView));
		}

		if (this.tabBar) {
			this.tabBar.setProps(selectTabBarProps(state, this.questions));
		}

		this.tui.requestRender();
	}
}
