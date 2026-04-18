# rpiv-todo

## Monorepo Context
Sibling Pi extension in `rpiv-mono` (npm workspaces). Lockstep version with all `@juicesharp/rpiv-*` packages — never bump independently; use `node scripts/release.mjs <bump|x.y.z>` from repo root. Listed in `extensions/rpiv-core/siblings.ts` so `/rpiv-setup` installs it. Peer-pinned in `packages/rpiv-pi/package.json` as `"*"`.

## Responsibility
Claude-Code-parity task management for Pi. Registers a single `todo` tool (multiplexed into 6 actions: create/update/list/get/delete/clear), the `/todos` slash command, and a persistent `TodoOverlay` widget mounted above the editor. State is reconstructed by replaying the session branch — no disk persistence.

## Dependencies
- **`@mariozechner/pi-coding-agent`** (peer): `ExtensionAPI`, `ExtensionUIContext`, `Component`, theme/render primitives
- **`@mariozechner/pi-ai`** (peer): `StringEnum` for action/status enums
- **`@mariozechner/pi-tui`** (peer): `truncateToWidth`, `Text` rendering
- **`@sinclair/typebox`** (peer): tool parameter schema

## Consumers
- **Pi extension host**: loads via `pi.extensions: ["./index.ts"]`
- **`rpiv-pi`**: lists in `peerDependencies` and `siblings.ts`

## Module Structure
```
index.ts          — Composer + 5 lifecycle hooks (session_start/compact/tree/shutdown, tool_execution_end)
todo.ts           — Constants, Task/TaskDetails types, VALID_TRANSITIONS table, applyTaskMutation reducer, reconstructTodoState, tool + /todos registrars
todo-overlay.ts   — TodoOverlay class (setUICtx/update/dispose), 12-line collapse with drop-completed-first overflow
```

## Pure Reducer + Branch-Replay Persistence
```typescript
// State lives in module-level vars; getTodos() is read-only accessor.
let tasks: Task[] = []; let nextId = 1;

// Pure reducer — every action funneled through here so invariants live in one place.
export function applyTaskMutation(state, action, params): ReducerResult {
    switch (action) { /* create | update | list | get | delete | clear */ }
}

// execute() is a 4-line trampoline.
async execute(_id, params, _signal, _onUpdate, _ctx) {
    const result = applyTaskMutation({ tasks, nextId }, params.action, params);
    tasks = result.state.tasks; nextId = result.state.nextId;
    return { content: result.content, details: result.details };  // details = full snapshot
}

// Replay rehydrates from session branch — last-writer-wins.
export function reconstructTodoState(ctx) {
    tasks = []; nextId = 1;
    for (const entry of ctx.sessionManager.getBranch()) {
        if (entry.type !== "message") continue;
        const msg = entry.message;
        if (msg.role !== "toolResult" || msg.toolName !== "todo") continue;
        if (!isTaskDetails(msg.details)) continue;
        tasks = msg.details.tasks.map(t => ({ ...t }));   // clone — never alias branch data
        nextId = msg.details.nextId;
    }
}
```

## Persistent Widget Mount (Lazy, Idempotent, Auto-hide)
```typescript
// Lazy: constructed only at first session_start with UI.
let todoOverlay: TodoOverlay | undefined;
pi.on("session_start", async (_e, ctx) => {
    reconstructTodoState(ctx);
    if (ctx.hasUI) { todoOverlay ??= new TodoOverlay();
                     todoOverlay.setUICtx(ctx.ui); todoOverlay.update(); }
});

// Register-once factory; subsequent updates just call tui.requestRender().
this.uiCtx.setWidget(WIDGET_KEY, (tui, theme) => {
    this.tui = tui;
    return { render: (w) => this.renderWidget(theme, w),
             invalidate: () => { this.widgetRegistered = false; this.tui = undefined; } };
}, { placement: "aboveEditor" });
```

## State-Machine Table (Not a Switch)
```typescript
// Single source of truth — adding a status is a one-line edit.
const VALID_TRANSITIONS: Record<TaskStatus, ReadonlySet<TaskStatus>> = {
    pending:     new Set(["in_progress", "completed", "deleted"]),
    in_progress: new Set(["pending", "completed", "deleted"]),
    completed:   new Set(["deleted"]),
    deleted:     new Set(),  // tombstone — terminal
};
```

## Architectural Boundaries
- **NO `reconstructTodoState` from `tool_execution_end`** — `message_end` runs after, so branch is stale; widget reads live `getTodos()` instead
- **TOOL_NAME = `"todo"` and WIDGET_KEY = `"rpiv-todos"`** are preserved verbatim — renaming breaks session-history replay and persisted UI state
- **Delete is a tombstone** (`status: "deleted"`) — preserves ids so historic `blockedBy` references still resolve
- **NO disk persistence** — state derives entirely from session branch via `details` envelope

<important if="you are adding a new todo action">
## Adding an Action
1. Add to `TaskAction` union (todo.ts)
2. Add reducer branch in `applyTaskMutation` — use `errorResult()` for failures (errors are values, never throws)
3. Add to `StringEnum` literal in `TodoParams.action` schema
4. Hook renderers: `ACTION_GLYPH`, `STATUS_GLYPH`, `STATUS_COLOR`
5. If status-changing: extend `VALID_TRANSITIONS` table + overlay's `statusGlyph`/`formatTaskLine`
6. Update `/todos` command if a new section is needed
7. Add prompt-guideline bullet so the agent knows *when* to call it
</important>

<important if="you are customizing the overlay">
## Customizing the Overlay
- **Placement**: change `{ placement: "aboveEditor" }` to `"belowEditor"` in `setWidget`
- **Line cap**: `MAX_WIDGET_LINES` (default 12); overflow math adapts automatically
- **Glyphs**: `statusGlyph` palette is the only coupling site
- **Heading**: `headingColor`/`headingIcon`/`headingText` triple in `renderWidget`
- Theme always via `theme.fg(...)` — never raw ANSI; use `truncateToWidth` for every line
- Do NOT rename `WIDGET_KEY` — breaks compatibility with persisted UI state
</important>
