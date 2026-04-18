# scripts/

## Monorepo Context
This is the rpiv-pi-internal scripts directory (post-install user-runnable migration). Distinct from the monorepo-root `<repo>/scripts/` which holds release-engineering tooling (`release.mjs`, `sync-versions.js` — see `<repo>/.rpiv/guidance/scripts/architecture.md`). Never confuse the two: `migrate.js` here is a one-off user utility; the root scripts orchestrate lockstep releases across all 6 packages.

## Responsibility
`migrate.js` — the standalone CLI that migrates in-place `.rpiv/guidance/architecture.md` files to the
`.rpiv/guidance/` shadow tree format. Actively invoked by the `migrate-to-guidance` skill.

## Dependencies
Node.js built-ins only — `fs`, `path`, `child_process`. Zero npm dependencies.

## Consumers
- **`migrate-to-guidance` skill**: runs `node scripts/migrate.js --project-dir "${CWD}"` directly

## Module Structure
```
migrate.js            — Standalone CLI: discovers .rpiv/guidance/architecture.md files, maps to .rpiv/guidance/ targets, writes output
```

## Architectural Boundaries
- **migrate.js writes all-or-nothing** — collects all target paths before writing; deletes originals only after all writes succeed
- **No npm dependencies** — keeps the migration tool runnable without `npm install`
- **stdout = JSON, stderr = diagnostics** — final report is machine-readable JSON on stdout; progress lines go to stderr with `[rpiv:migrate]` prefix

<important if="you are adding a new standalone CLI script to this layer">
## Adding a CLI Utility Script
1. Create `scripts/my-name.js`; write a `parseArgs(argv)` function for manual `argv` parsing (no third-party parser)
2. Use `// --- Section Name ---` comment dividers between logical phases
3. Write a `function main()` (sync) or `async function main()` (if async I/O needed)
4. Progress output: `process.stderr.write('[rpiv:my-name] …\n')`
5. Final machine-readable result: `process.stdout.write(JSON.stringify(report, null, 2))` — pretty-printed; all report fields always present, no optional keys
6. Call `main()` at the bottom; add `.catch` only for async main
</important>
