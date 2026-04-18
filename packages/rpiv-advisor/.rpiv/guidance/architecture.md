# rpiv-advisor

## Monorepo Context
Sibling Pi extension in `rpiv-mono` (npm workspaces). Lockstep version with all `@juicesharp/rpiv-*` packages — never bump independently; use `node scripts/release.mjs <bump|x.y.z>` from repo root. Listed in `extensions/rpiv-core/siblings.ts` so `/rpiv-setup` installs it. Peer-pinned in `packages/rpiv-pi/package.json` as `"*"`.

## Responsibility
Single-tool Pi extension implementing the advisor-strategy pattern: registers an `advisor` tool (zero parameters) and `/advisor` slash command. When the executor calls `advisor()`, it serializes the current conversation branch and forwards it to a separately-configured reviewer model (typically Opus). Tool is registered at load but kept inactive until a model is selected; selection persists at `~/.config/rpiv-advisor/advisor.json` (chmod 0600).

## Dependencies
- **`@mariozechner/pi-coding-agent`** (peer): `ExtensionAPI`, `convertToLlm`, `serializeConversation`, `DynamicBorder`
- **`@mariozechner/pi-ai`** (peer): `completeSimple`, `Model`, `StopReason`, `Usage`, `ThinkingLevel`, `supportsXhigh`
- **`@mariozechner/pi-tui`** (peer): `Container`, `SelectList`, `Spacer`, `Text`
- **`@sinclair/typebox`** (peer): empty parameter schema

## Consumers
- **Pi extension host**: loads via `pi.extensions: ["./index.ts"]`; default export takes `ExtensionAPI`
- **`rpiv-pi`**: lists `@juicesharp/rpiv-advisor` in `peerDependencies` and `extensions/rpiv-core/siblings.ts`

## Module Structure
```
index.ts            — Thin composer (28 lines): registerAdvisorTool + registerAdvisorCommand + registerAdvisorBeforeAgentStart + restoreAdvisorState on session_start
advisor.ts          — Constants, config persistence, system-prompt loader, executeAdvisor, tool/command registration, before_agent_start gating
advisor-ui.ts       — Two TUI pickers (model + effort) sharing one buildSelectPanel
prompts/
  advisor-system.txt — Plain-text system prompt loaded once at module init
```

## Tool Registration (Zero-Parameter + Curated Prompt Metadata)
```typescript
export function registerAdvisorTool(pi: ExtensionAPI): void {
    pi.registerTool({
        name: "advisor",
        label: "Advisor",
        description: ADVISOR_DESCRIPTION,        // long-form, when to escalate
        promptSnippet: ADVISOR_PROMPT_SNIPPET,   // one-line headline
        promptGuidelines: ADVISOR_PROMPT_GUIDELINES, // 6 enforceable rules
        parameters: Type.Object({}),             // zero params — branch comes from ctx.sessionManager
        async execute(_id, _params, signal, onUpdate, ctx) {
            return executeAdvisor(ctx, signal, onUpdate);
        },
    });
}
```

## Registered-but-Inactive Activation Gating
```typescript
// before_agent_start strips advisor from active tools when no model selected.
// Tool stays registered (visible to /advisor command) but invisible to the LLM.
pi.on("before_agent_start", async () => {
    if (!getAdvisorModel()) {
        const active = pi.getActiveTools();
        if (active.includes(ADVISOR_TOOL_NAME)) {
            pi.setActiveTools(active.filter((n) => n !== ADVISOR_TOOL_NAME));
        }
    }
});
```

## System Prompt Loading (ESM-safe, once at init)
```typescript
// new URL(..., import.meta.url) resolves relative to THIS file — works from
// source, dist, or node_modules. Sync read at module top-level. trimEnd()
// keeps prompt-cache prefix byte-identical.
export const ADVISOR_SYSTEM_PROMPT = readFileSync(
    fileURLToPath(new URL("./prompts/advisor-system.txt", import.meta.url)),
    "utf-8",
).trimEnd();
```

## Side-Call Shape (executor branch → reviewer model)
```typescript
const branch = ctx.sessionManager.getBranch();
const agentMessages = branch
    .filter((e): e is SessionEntry & { type: "message" } => e.type === "message")
    .map((e) => e.message);
const conversationText = serializeConversation(convertToLlm(agentMessages));
const userMessage = { role: "user", content: [{ type: "text",
    text: `## Conversation So Far\n\n${conversationText}` }], timestamp: Date.now() };
const response = await completeSimple(advisor,
    { systemPrompt: ADVISOR_SYSTEM_PROMPT, messages: [userMessage] },
    { apiKey, headers, signal, reasoning: effort });
// Branch on response.stopReason: "aborted" | "error" | empty text | success
```

## Architectural Boundaries
- **NO main-transcript writes** — advisor reply is returned as the tool result; never appended via sendMessage
- **NO tools for the advisor** — system prompt forbids tool calls; `completeSimple` is single-shot
- **Sentinel values** for selector choices: `__no_advisor__`, `__off__` (collision-proof vs `provider:modelId` keys)
- **Config file mode 0o600** — best-effort chmod; never throws on FS that lacks chmod

<important if="you are tweaking the advisor's system prompt">
## Tweaking the System Prompt
1. Edit `prompts/advisor-system.txt` — plain text, reviewable as a diff
2. Keep contract clauses ("NEVER call tools", "NEVER produce user-facing output") — `executeAdvisor` does no post-filtering
3. `.trimEnd()` strips trailing newline only; internal blank lines preserved
4. No code change needed — restart Pi to pick up new prompt
5. Behavioral changes about *when* the executor calls advisor go in `ADVISOR_PROMPT_GUIDELINES` (advisor.ts), not the prompt file
</important>

<important if="you are adding a new advisor variant (e.g., critic)">
## Adding a Variant
1. Add a new prompt file under `prompts/` (e.g., `critic-system.txt`); load it next to `ADVISOR_SYSTEM_PROMPT`
2. Parameterize `executeAdvisor(ctx, signal, onUpdate, systemPrompt)` and add a sibling `executeCritic`
3. Clone `registerAdvisorTool` as `registerCriticTool` with its own `name`/`label`/description/snippet/guidelines
4. Wire in `index.ts` and extend the `before_agent_start` gating to strip `"critic"` independently
5. Extend `AdvisorConfig` with `criticModelKey?: string` — `loadAdvisorConfig` returns `{}` on parse failure so old configs stay forward-compatible
6. Bump version via `node scripts/release.mjs <bump>` from repo root and add CHANGELOG entry under `[Unreleased]`
</important>
