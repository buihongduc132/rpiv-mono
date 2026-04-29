import type { StatefulView } from "./stateful-view.js";
import { WrappingSelect, type WrappingSelectItem, type WrappingSelectTheme } from "./wrapping-select.js";

/**
 * Maximum number of option rows visible in the WrappingSelect window. Lifted here from
 * `preview-pane.ts` so the cap travels with the option-list owner.
 */
export const MAX_VISIBLE_OPTIONS = 10;

export interface OptionListViewConfig {
	items: readonly WrappingSelectItem[];
	theme: WrappingSelectTheme;
}

/**
 * Per-tick projection of OptionListView state. Wraps the three setter
 * concerns (selected index, focused, confirmed indicator) into one prop bag
 * so the adapter calls `setProps` once per tick instead of three setters.
 */
export interface OptionListViewProps {
	selectedIndex: number;
	focused: boolean;
	/** Optional previously-confirmed indicator. Omit when no marker should be drawn. */
	confirmed?: { index: number; labelOverride?: string };
}

/**
 * Sole owner of the option list's interactive state. Wraps a single
 * `WrappingSelect`. Implements the hybrid `StatefulView<P>` + ImperativeView
 * contract:
 *
 * - `setProps` (PropsView path) — fans out reducer-driven state
 *   (`selectedIndex`, `focused`, `confirmed?`) to the inner WrappingSelect.
 *   Called once per `viewAdapter.apply()` tick.
 * - Imperative input-buffer methods (`setInputBuffer` / `appendInput` /
 *   `backspaceInput` / `clearInputBuffer`) — called by the runtime side-band
 *   (`questionnaire-session.ts:206-210, :237-240`) to mutate per-keystroke
 *   buffer state without a reducer pass. Per research Q5.
 * - Read-back getters (`getSelectedIndex` / `isFocused` / `getInputBuffer`)
 *   — `getInputBuffer` is read by the dispatcher snapshot
 *   (`questionnaire-session.ts:249`); `getSelectedIndex` / `isFocused` are
 *   read by `PreviewPane` until Phase 7 eliminates the sibling-coupling.
 */
export class OptionListView implements StatefulView<OptionListViewProps> {
	private readonly select: WrappingSelect;
	private selectedIndex = 0;
	private focused = true;

	constructor(config: OptionListViewConfig) {
		// Reserve a slot for the chat row in the WrappingSelect's number-padding so
		// the column width is identical whether or not the user navigates into chat
		// (chat row uses items.length + 1).
		this.select = new WrappingSelect(config.items, Math.min(config.items.length, MAX_VISIBLE_OPTIONS), config.theme, {
			numberStartOffset: 0,
			totalItemsForNumbering: config.items.length + 1,
		});
	}

	setProps(props: OptionListViewProps): void {
		this.selectedIndex = props.selectedIndex;
		this.focused = props.focused;
		this.select.setSelectedIndex(props.selectedIndex);
		this.select.setFocused(props.focused);
		this.select.setConfirmedIndex(props.confirmed?.index, props.confirmed?.labelOverride);
	}

	// ----- ImperativeView surface (input buffer) -----

	setInputBuffer(text: string): void {
		this.select.setInputBuffer(text);
	}

	getInputBuffer(): string {
		return this.select.getInputBuffer();
	}

	appendInput(text: string): void {
		this.select.appendInput(text);
	}

	backspaceInput(): void {
		this.select.backspaceInput();
	}

	clearInputBuffer(): void {
		this.select.clearInputBuffer();
	}

	// ----- Read-back getters -----

	getSelectedIndex(): number {
		return this.selectedIndex;
	}

	isFocused(): boolean {
		return this.focused;
	}

	// ----- Component surface -----

	handleInput(_data: string): void {}

	invalidate(): void {
		this.select.invalidate();
	}

	render(width: number): string[] {
		return this.select.render(width);
	}
}
