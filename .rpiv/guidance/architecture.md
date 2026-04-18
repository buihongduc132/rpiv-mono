# rpiv-mono

Monorepo for Pi CLI plugins in the `@juicesharp/rpiv-*` family. Lockstep versions, single install, single publish pipeline. Targets Pi Agent CLI (`@mariozechner/pi-coding-agent`), not Claude Code.

# Architecture

```
rpiv-mono/
├── packages/
│   ├── rpiv-pi/                  — Umbrella: extension runtime + skills + agents (zero tools)
│   ├── rpiv-advisor/             — `advisor` tool + /advisor (escalate to stronger reviewer model)
│   ├── rpiv-ask-user-question/   — `ask_user_question` tool (structured TUI selector)
│   ├── rpiv-btw/                 — /btw side-question slash command (no main-transcript writes)
│   ├── rpiv-todo/                — `todo` tool + /todos + persistent overlay (Claude-Code parity)
│   └── rpiv-web-tools/           — `web_search` + `web_fetch` via Brave Search API
├── scripts/                      — release.mjs + sync-versions.js (lockstep release pipeline)
├── thoughts/shared/              — Pipeline artifacts: questions/, research/, designs/, plans/, reviews/
├── package.json                  — npm workspaces root (no per-package tsconfig.json; tsconfig.base.json only)
└── biome.json                    — Tabs, indent 3, line width 120
```

**Build model**: `noEmit: true` everywhere. Packages publish raw `.ts` files (Pi loads `.ts` directly via `pi.extensions` manifest). No `dist/`, no per-package tsconfig.json.

**Plugin discovery**: each package's `package.json` has a `pi` field — `pi.extensions: ["./index.ts"]` (or `["./extensions"]` for rpiv-pi) and optionally `pi.skills: ["./skills"]`. Pi loads the default-exported function with an `ExtensionAPI` instance.

**Sibling registry**: `packages/rpiv-pi/extensions/rpiv-core/siblings.ts` is the single source of truth — adding a sibling here propagates to `/rpiv-setup`, missing-plugin warnings, and presence detection (regex over `~/.pi/agent/settings.json`). No runtime imports of siblings (Phase 1 zero-cross-imports contract).

# Commands

| Command | Description |
|---|---|
| `npm install` | One install at root; workspace symlinks under `node_modules/` |
| `npm run check` | Biome (`--write --error-on-warnings`) + `tsc --noEmit -p tsconfig.base.json` |
| `npm test` | Forwarded to packages with a `test` script (none today) |
| `node scripts/release.mjs <patch\|minor\|major\|x.y.z>` | Cut a lockstep release — see `scripts/architecture.md` |
| `node scripts/sync-versions.js` | Verify lockstep + rewrite intra-monorepo deps to `^<version>` |

Husky `pre-commit` runs `npm run check` before every commit.

# Conventions

- **Lockstep versions**: every `packages/*/package.json` shares one `version` (currently 0.6.1). Enforced by `sync-versions.js` (exit 1 on drift).
- **Naming**: directory `rpiv-<feature>` → npm `@juicesharp/rpiv-<feature>`.
- **Sibling deps as `peerDependencies: "*"`**: `rpiv-pi` peer-pins every sibling and `pi-*` runtime; bundlers never include them.
- **`files` arrays** explicitly list `.ts` source + asset dirs (`prompts/`, `extensions/`, `skills/`, `agents/`); `.rpiv/` is NOT shipped — guidance is monorepo-side only.
- **`type: "module"` everywhere**; relative imports use `.js` extensions even from `.ts` source (NodeNext).

<important if="you are cutting or planning a release">
## Releasing
- All releases are local-only (no CI workflows). Use `node scripts/release.mjs` from monorepo root — never `npm version` in a package.
- Lockstep means all 6 packages get the same new version. Adding a 7th would also bump.
- Detailed pipeline: see `.rpiv/guidance/scripts/architecture.md`
</important>

<important if="you are adding a new sibling Pi extension package">
## Adding a Sibling Package (cross-layer checklist)
1. Create `packages/rpiv-<name>/` with a `package.json` matching the lockstep version, `pi.extensions: ["./index.ts"]`, and `peerDependencies` for `pi-coding-agent`/`pi-tui`/`pi-ai`/`typebox` as needed
2. Add the package's `files` array listing `.ts` source + any `prompts/` directory
3. Add the new sibling to `packages/rpiv-pi/extensions/rpiv-core/siblings.ts` — see `packages/rpiv-pi/.rpiv/guidance/extensions/rpiv-core/architecture.md` for the registry pattern
4. Pin in `packages/rpiv-pi/package.json` `peerDependencies` as `"*"`
5. Author `packages/rpiv-<name>/.rpiv/guidance/architecture.md` for the new layer
6. Run `node scripts/sync-versions.js` to wire intra-monorepo deps
7. Add a `CHANGELOG.md` with `## [Unreleased]` so `release.mjs` picks it up
</important>

<important if="you are touching tool registration, schemas, or session hooks anywhere in the monorepo">
## Cross-Package Pi Conventions
- Tool params via `@sinclair/typebox` `Type.Object({...})`; field `description` doubles as LLM-facing prompt copy
- Tool result envelope: `{ content: [{ type: "text", text }], details: <typed object> }` — `details` is what `reconstruct*State()` replays
- System prompts loaded once at module init via `readFileSync(fileURLToPath(new URL("./prompts/X.txt", import.meta.url))).trimEnd()` — ESM-safe, cache-stable
- Sibling-owned widget patterns: `setWidget(KEY, factory, { placement: "aboveEditor" })` register-once + `tui.requestRender()` on update — see `packages/rpiv-todo/.rpiv/guidance/architecture.md`
- For tool-specific patterns, consult the relevant package's `.rpiv/guidance/architecture.md`
</important>
