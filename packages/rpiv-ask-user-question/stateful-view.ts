import type { Component } from "@mariozechner/pi-tui";

/**
 * Generic prop-driven component contract. Replaces the legacy
 * `StatefulComponent<S>` (with `S = DialogState`) — that shape was always
 * undersized because per-component projection sub-shapes diverge:
 * `TabBar` needs construction-time + derived data; `OptionListView` needs
 * `confirmedIndex`/`labelOverride`/`inputBuffer`; `PreviewPane` needs one
 * boolean. No single canonical state slice fits.
 *
 * Under `StatefulView<P>`, every renderable owns its own `P` shape. The
 * adapter computes `P` from canonical state via per-component selectors and
 * pushes it via `setProps`. `setFocused` is gone — `focused: boolean` is a
 * field on `P` only where the component needs it.
 *
 * Side-band cells (`OptionListView` input buffer, `notesInput`) classify as
 * `ImperativeView` — they keep granular setters consumed by the runtime
 * directly (`runEffect` / `handleIgnoreInline`), bypassing this contract.
 * Their PropsView surface still uses `setProps` for the reducer-driven
 * slice of their state.
 */
export interface StatefulView<P> extends Component {
	setProps(props: P): void;
}

/**
 * Discriminated focus union — encodes the four-cell focus invariant
 * (`notesVisible`, submit-tab, `chatFocused`, options) that was previously
 * structural-only. Dispatcher cascade (`dispatch.ts:151-178`) and reducer's
 * defensive clears (`apply-action.ts:104-126`) enforce mutual exclusion;
 * this type makes it explicit so per-component `focused: boolean` flags
 * derive from one equality check against this discriminant rather than
 * four parallel boolean reads.
 *
 * Priority order: notes > submit > chat > options. Matches the dispatcher
 * cascade exactly so the union is observably equivalent to today's reads.
 */
export type ActiveView = "notes" | "chat" | "options" | "submit";
