import type { Component } from "@mariozechner/pi-tui";

/**
 * Generic state-driven component contract. Implementers consume the full canonical
 * state via `setState`; focus is set independently via `setFocused`.
 *
 * `QuestionnaireViewAdapter.apply()` iterates a registry of these and drives both
 * methods in one place, so adding a new state field only requires updating the state
 * shape and the components that read it.
 */
export interface StatefulComponent<S> extends Component {
	setState(state: S): void;
	setFocused(focused: boolean): void;
}
