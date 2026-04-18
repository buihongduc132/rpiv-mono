# rpiv-ask-user-question

## Monorepo Context
Sibling Pi extension in `rpiv-mono` (npm workspaces). Lockstep version with all `@juicesharp/rpiv-*` packages — never bump independently; use `node scripts/release.mjs <bump|x.y.z>` from repo root. Listed in `extensions/rpiv-core/siblings.ts` so `/rpiv-setup` installs it. Peer-pinned in `packages/rpiv-pi/package.json` as `"*"`. Used heavily by `rpiv-pi` skills for developer checkpoints.

## Responsibility
Single-tool Pi extension exposing `ask_user_question` — surfaces a structured TUI option selector (with free-text "Other" fallback and a "chat about this" escape hatch) instead of plain-prose clarifying questions. Returns the user's selection or free-text answer.

## Dependencies
- **`@mariozechner/pi-coding-agent`** (peer): `ExtensionAPI`, `Theme`, `DynamicBorder`
- **`@mariozechner/pi-tui`** (peer): `Container`, `Spacer`, `Text`, `Component`, `getKeybindings`, `visibleWidth`, `wrapTextWithAnsi`
- **`@sinclair/typebox`** (peer): `Type` for tool parameter schema

## Consumers
- **Pi extension host**: loads via `pi.extensions: ["./index.ts"]`
- **`rpiv-pi` skills**: every `## Step N:` developer checkpoint that presents 2-4 concrete options (research/SKILL.md, plan/SKILL.md, annotate-guidance/SKILL.md, etc.)

## Module Structure
```
index.ts                — Thin shim: default export delegates to registerAskUserQuestionTool(pi)
ask-user-question.ts    — Schema, registration, execute lifecycle, dialog composition, input routing, response mapping
wrapping-select.ts      — Reusable WrappingSelect Component (numbered scrollable list + inline free-text mode)
```

## Tool Schema (TypeBox with sub-schema)
```typescript
const OptionSchema = Type.Object({
    label:       Type.String({ description: "Display label for the option" }),
    description: Type.Optional(Type.String({ description: "Optional description shown below label" })),
});

pi.registerTool({
    name: "ask_user_question", label: "Ask User Question",
    description: "Ask the user a structured question with selectable options.",
    promptSnippet: "Ask the user a structured question when requirements are ambiguous",
    promptGuidelines: [/* model-facing usage rules */],
    parameters: Type.Object({
        question: Type.String({ description: "The question to ask the user" }),
        header:   Type.Optional(Type.String({ description: "Section header for the question" })),
        options:  Type.Array(OptionSchema),
        // multiSelect declared in schema but execute() always uses single-select
        multiSelect: Type.Optional(Type.Boolean({ default: false })),
    }),
});
```

## Execute Lifecycle (Validate → ViewModel → ctx.ui.custom → Map Result)
```typescript
async execute(_id, params, _signal, _onUpdate, ctx) {
    if (!ctx.hasUI)             return buildToolResult(ERROR_NO_UI, ...);
    if (!params.options.length) return buildToolResult(ERROR_NO_OPTIONS, ...);

    const mainItems = buildMainItems(params.options);     // adds "Type something." Other row
    const chatItems = [{ label: CHAT_ABOUT_THIS_LABEL, isChat: true }];

    const choice = await ctx.ui.custom<WrappingSelectItem | null>((tui, theme, _kb, done) => {
        // Two WrappingSelect instances share one selectionIndex; numberStartOffset
        // + totalItemsForNumbering keep numbering continuous across the chat divider.
        return { render, invalidate, handleInput };
    });
    return buildResponse(choice, params);  // null | isOther | isChat | regular → tool result
}
```

## Component Pattern (Sentinel Discriminators + Container-Routed Input)
```typescript
export interface WrappingSelectItem {
    label: string;
    description?: string;
    isOther?: boolean;   // sentinel: inline free-text input row
    isChat?: boolean;    // sentinel: "chat about this" escape row
}

// Component contract is { render, invalidate, handleInput }. WrappingSelect's
// handleInput is intentionally empty — the OWNING container is the single
// source of truth for focus and keystroke routing. This avoids two components
// reacting to the same key.
handleInput(_data: string): void {}
```

## Architectural Boundaries
- **NO width math via `string.length`** — always `visibleWidth` / `wrapTextWithAnsi` for ANSI/wide-char correctness
- **NO inline strings in execute** — every user-facing token (DECLINE_MESSAGE, NAV_HINT, KEYBIND_*, BACKSPACE_CHARS, ESC_SEQUENCE_PREFIX) is a module-level const
- **NO subclassing for special rows** — sentinel boolean flags (`isOther`, `isChat`) discriminate; renderer + result handler branch on them
- **Tool-result envelope** always built via `buildToolResult(text, details)` so `content[0].text` and `details` cannot drift

<important if="you are adding a new question type (e.g., new sentinel row)">
## Adding a Sentinel Row
1. Extend `WrappingSelectItem` with a new optional boolean (e.g., `isSkip?`)
2. Hoist all user-facing strings as module-level const (e.g., `SKIP_LABEL`, `SKIP_MESSAGE`)
3. Inject the row alongside `chatItems` in `execute`; create a third `WrappingSelect` if it lives in its own visual section
4. Extend `applySelection` and `itemAt` to span all sub-ranges
5. Add a branch in `buildResponse` returning `buildToolResult(MSG, { ..., wasSkip: true })`
6. Add the matching optional flag to `ToolDetails`
7. Custom rendering for the row → add a branch in `WrappingSelect.renderItem`
</important>

<important if="you are customizing the selector UI">
## Customizing the Selector
- **Theme**: pass a different `WrappingSelectTheme` (3 string→string functions). Route through `theme.fg(...)`/`theme.bold(...)` — never hardcode ANSI
- **Glyphs**: `private static readonly` constants on `WrappingSelect` (`ACTIVE_POINTER`, `INACTIVE_POINTER`, `NUMBER_SEPARATOR`, `INPUT_CURSOR`)
- **Window size**: `MAX_VISIBLE_ROWS` constant; centering math in `computeVisibleWindow` adapts
- **Dialog layout**: `buildDialogContainer` — keep the `Container`+`Spacer`+`Text`+`DynamicBorder` vocabulary
- **Keys**: add a `KEYBIND_*` const, dispatch via `kb.matches(data, KEYBIND_NAME)`. Free-text rows MUST guard with `BACKSPACE_CHARS.has(data)` + `!data.startsWith(ESC_SEQUENCE_PREFIX)` before forwarding to `appendInput`
</important>
