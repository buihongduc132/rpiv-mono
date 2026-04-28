import type { Theme } from "@mariozechner/pi-coding-agent";
import { type Component, type MarkdownTheme, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import {
	MAX_PREVIEW_HEIGHT_SIDE_BY_SIDE,
	MAX_PREVIEW_HEIGHT_STACKED,
	MarkdownContentCache,
	NOTES_AFFORDANCE_OVERHEAD,
} from "./markdown-content-cache.js";
import {
	BORDER_HORIZONTAL_OVERHEAD,
	BORDER_INNER_PADDING_HORIZONTAL,
	BORDER_VERTICAL_OVERHEAD,
	computeBoxDimensions,
	renderBorderedBox,
} from "./preview-box-renderer.js";
import {
	bodyWidths,
	columnWidths,
	decideLayout,
	PREVIEW_PADDING_LEFT,
	type PreviewLayoutMode,
	STACKED_GAP_ROWS,
} from "./preview-layout-decider.js";
import type { QuestionData } from "./types.js";
import { WrappingSelect, type WrappingSelectItem, type WrappingSelectTheme } from "./wrapping-select.js";

export {
	MAX_PREVIEW_HEIGHT_SIDE_BY_SIDE,
	MAX_PREVIEW_HEIGHT_STACKED,
	NO_PREVIEW_TEXT,
	NOTES_AFFORDANCE_OVERHEAD,
} from "./markdown-content-cache.js";
// ----- Re-exports for test imports — keep `./preview-pane.js` as the public surface -----
export {
	BORDER_HORIZONTAL_OVERHEAD,
	BORDER_INNER_PADDING_HORIZONTAL,
	BORDER_VERTICAL_OVERHEAD,
	BOX_MIN_CONTENT_WIDTH,
	renderBorderedBox,
	stripFenceMarkers,
} from "./preview-box-renderer.js";
export {
	PREVIEW_COLUMN_GAP,
	PREVIEW_LEFT_COLUMN_MAX_WIDTH,
	PREVIEW_MIN_WIDTH,
	PREVIEW_PADDING_LEFT,
	STACKED_GAP_ROWS,
} from "./preview-layout-decider.js";

// ----- Constants owned by the composer itself -----
export const MAX_VISIBLE_OPTIONS = 10;
/** Affordance text shown below the bordered preview when focused on a preview-bearing option. */
export const NOTES_AFFORDANCE_TEXT = "Notes: press n to add notes";

export interface PreviewPaneConfig {
	items: readonly WrappingSelectItem[];
	question: QuestionData;
	theme: Theme;
	markdownTheme: MarkdownTheme;
	getTerminalWidth: () => number;
}

export class PreviewPane implements Component {
	private readonly question: QuestionData;
	private readonly theme: Theme;
	private readonly getTerminalWidth: () => number;
	private readonly options: WrappingSelect;
	private readonly cache: MarkdownContentCache;
	private selectedIndex = 0;
	private focused = false;
	private notesVisible = false;

	constructor(config: PreviewPaneConfig) {
		this.question = config.question;
		this.theme = config.theme;
		this.getTerminalWidth = config.getTerminalWidth;
		this.cache = new MarkdownContentCache(config.question, config.theme, config.markdownTheme);

		const selectTheme: WrappingSelectTheme = {
			selectedText: (t) => this.theme.fg("accent", this.theme.bold(t)),
			description: (t) => this.theme.fg("muted", t),
			scrollInfo: (t) => this.theme.fg("dim", t),
		};
		// Reserve a slot for the chat row so the number column is wide enough whether or
		// not the user navigates into chat. Chat row uses (items.length + 1).
		this.options = new WrappingSelect(config.items, Math.min(config.items.length, MAX_VISIBLE_OPTIONS), selectTheme, {
			numberStartOffset: 0,
			totalItemsForNumbering: config.items.length + 1,
		});
	}

	setSelectedIndex(index: number): void {
		this.selectedIndex = index;
		this.options.setSelectedIndex(index);
	}

	setFocused(focused: boolean): void {
		this.focused = focused;
		this.options.setFocused(focused);
	}

	setNotesVisible(visible: boolean): void {
		this.notesVisible = visible;
	}

	setConfirmedIndex(index: number | undefined, labelOverride?: string): void {
		this.options.setConfirmedIndex(index, labelOverride);
	}

	setInputBuffer(text: string): void {
		this.options.setInputBuffer(text);
	}

	invalidateCache(): void {
		this.cache.invalidate();
	}

	getInputBuffer(): string {
		return this.options.getInputBuffer();
	}

	appendInput(text: string): void {
		this.options.appendInput(text);
	}

	backspaceInput(): void {
		this.options.backspaceInput();
	}

	clearInputBuffer(): void {
		this.options.clearInputBuffer();
	}

	handleInput(_data: string): void {}

	invalidate(): void {
		this.invalidateCache();
		this.options.invalidate();
	}

	render(width: number): string[] {
		if (this.question.multiSelect === true) return this.options.render(width);
		// Spec: hide the preview pane entirely when no option carries a `preview`.
		if (!this.cache.hasAnyPreview()) return this.options.render(width);

		const mode = decideLayout(this.getTerminalWidth(), width);
		if (mode === "side-by-side") return this.renderSideBySide(width);

		// Stacked: options + blank gap + preview block.
		return [
			...this.options.render(width),
			...Array(STACKED_GAP_ROWS).fill(""),
			...this.renderPreviewLines(width, mode),
		];
	}

	naturalHeight(width: number): number {
		if (this.question.multiSelect === true) return this.options.render(width).length;
		if (!this.cache.hasAnyPreview()) return this.options.render(width).length;
		const mode = decideLayout(this.getTerminalWidth(), width);
		const { optionsWidth, previewWidth } = bodyWidths(width, mode);
		const optionsHeight = this.options.render(optionsWidth).length;
		const previewBlock = this.previewBlockHeight(previewWidth, this.selectedIndex, mode);
		if (mode === "side-by-side") return Math.max(optionsHeight, previewBlock);
		return optionsHeight + STACKED_GAP_ROWS + previewBlock;
	}

	maxNaturalHeight(width: number): number {
		if (this.question.multiSelect === true) return this.options.render(width).length;
		if (!this.cache.hasAnyPreview()) return this.options.render(width).length;
		const mode = decideLayout(this.getTerminalWidth(), width);
		const { optionsWidth, previewWidth } = bodyWidths(width, mode);
		const optionsHeight = this.options.render(optionsWidth).length;
		let maxPreviewBlock = 0;
		for (let i = 0; i < this.question.options.length; i++) {
			const h = this.previewBlockHeight(previewWidth, i, mode);
			if (h > maxPreviewBlock) maxPreviewBlock = h;
		}
		if (mode === "side-by-side") return Math.max(optionsHeight, maxPreviewBlock);
		return optionsHeight + STACKED_GAP_ROWS + maxPreviewBlock;
	}

	/**
	 * Height of the preview block for a given option at a given outer column width.
	 * Layout `mode` is THREADED in (not re-derived from `width`) — eliminates the
	 * bug class where derivation from a column width (already < pane width post-split)
	 * capped height too short.
	 */
	private previewBlockHeight(width: number, optionIndex: number, mode: PreviewLayoutMode): number {
		const cap = mode === "side-by-side" ? MAX_PREVIEW_HEIGHT_SIDE_BY_SIDE : MAX_PREVIEW_HEIGHT_STACKED;
		const contentBudget = Math.max(1, cap - BORDER_VERTICAL_OVERHEAD - NOTES_AFFORDANCE_OVERHEAD);
		const innerWidth = Math.max(1, width - BORDER_HORIZONTAL_OVERHEAD - 2 * BORDER_INNER_PADDING_HORIZONTAL);
		const rawRows = this.cache.bodyFor(optionIndex, innerWidth).length;
		const contentRows = Math.min(rawRows, contentBudget);
		return BORDER_VERTICAL_OVERHEAD + contentRows + NOTES_AFFORDANCE_OVERHEAD;
	}

	private renderSideBySide(width: number): string[] {
		const { leftWidth, rightWidth, gap } = columnWidths(width);
		const leftLines = this.options.render(leftWidth);
		const rightLines = this.renderPaddedPreviewLines(rightWidth, "side-by-side");
		const rows = Math.max(leftLines.length, rightLines.length);
		const gapStr = " ".repeat(gap);
		const out: string[] = [];
		for (let i = 0; i < rows; i++) {
			const leftRaw = leftLines[i] ?? "";
			const rightRaw = rightLines[i] ?? "";
			const leftClamped = truncateToWidth(leftRaw, leftWidth, "");
			const leftPad = " ".repeat(Math.max(0, leftWidth - visibleWidth(leftClamped)));
			const joined = `${leftClamped}${leftPad}${gapStr}${rightRaw}`;
			out.push(truncateToWidth(joined, width, ""));
		}
		return out;
	}

	private renderPaddedPreviewLines(colWidth: number, mode: PreviewLayoutMode): string[] {
		const contentLines = this.renderPreviewLines(Math.max(1, colWidth - PREVIEW_PADDING_LEFT), mode);
		const pad = " ".repeat(PREVIEW_PADDING_LEFT);
		return contentLines.map((l) => (l === "" ? "" : `${pad}${l}`));
	}

	private renderPreviewLines(width: number, mode: PreviewLayoutMode): string[] {
		const cap = mode === "side-by-side" ? MAX_PREVIEW_HEIGHT_SIDE_BY_SIDE : MAX_PREVIEW_HEIGHT_STACKED;
		const contentBudget = Math.max(1, cap - BORDER_VERTICAL_OVERHEAD - NOTES_AFFORDANCE_OVERHEAD);
		const maxInnerWidth = Math.max(1, width - BORDER_HORIZONTAL_OVERHEAD - 2 * BORDER_INNER_PADDING_HORIZONTAL);

		const raw = this.cache.bodyFor(this.selectedIndex, maxInnerWidth);
		const truncated = raw.length > contentBudget;
		const hidden = truncated ? raw.length - contentBudget : 0;
		const contentLines = truncated ? raw.slice(0, contentBudget) : raw;

		const { boxWidth } = computeBoxDimensions(contentLines, maxInnerWidth);

		const colorFn = (s: string) => this.theme.fg("accent", s);
		const boxedLines = renderBorderedBox(contentLines, boxWidth, colorFn, hidden);

		// Notes affordance row — reserved CONSTANTLY when hasAnyPreview (height stability
		// of the affordance row's offset relative to the box). Text appears only when
		// focused on a preview-bearing option AND not in notes mode.
		const showAffordance = this.focused && !this.notesVisible && this.cache.has(this.selectedIndex);
		const affordance = showAffordance ? this.theme.fg("muted", NOTES_AFFORDANCE_TEXT) : "";
		return [...boxedLines, "", affordance];
	}
}
