import type { MultiSelectView } from "./components/multi-select-view.js";
import type { OptionListView } from "./components/option-list-view.js";
import type { PreviewPane } from "./components/preview/preview-pane.js";

/** Per-question view components. `multiSelect` is undefined for single-select questions. */
export interface TabComponents {
	optionList: OptionListView;
	preview: PreviewPane;
	multiSelect?: MultiSelectView;
}
