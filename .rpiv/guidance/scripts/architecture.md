# scripts/ (release engineering)

## Responsibility
Two-script release pipeline for the rpiv-mono lockstep monorepo. `release.mjs` orchestrates an end-to-end release (preflight → bump → CHANGELOG promote → commit + tag → publish → reinstate `[Unreleased]` → push). `sync-versions.js` enforces the lockstep invariant and rewrites intra-monorepo `dependencies`/`devDependencies` to `^<lockstep-version>`. Together they implement: a release is one atomic, reproducible monorepo-wide action.

## Dependencies
Node built-ins only (`node:child_process`, `node:fs`, `node:path`). Shells out to `git`, `npm`, `npx shx`. Reads `packages/rpiv-pi/package.json` as the canonical version oracle (`release.mjs:47`). No third-party packages.

## Consumers
- **Developers**: `npm run release:{patch|minor|major}` or `node scripts/release.mjs <x.y.z>`
- **Root npm scripts**: `version:*` chains call `sync-versions.js` after `npm version -ws`
- **No CI**: releases are local-only by design (no `.github/workflows/`)
- **Husky `pre-commit`**: runs `npm run check` (Biome + `tsc --noEmit`) — gates the clean-tree precondition `release.mjs` checks

## Module Structure
```
release.mjs          — 8-phase imperative pipeline (no exports, no try/catch at top — run() exits on failure)
sync-versions.js     — Lockstep invariant + intra-monorepo dep rewrite (no functions, idempotent)
```

## Lockstep Invariant Enforcement
```javascript
// sync-versions.js — refuses to sync when packages have drifted apart
const versions = new Set(Object.values(versionMap));
if (versions.size > 1) {
    console.error("\n❌ ERROR: Not all packages have the same version!");
    console.error("Expected lockstep versioning. Run one of:");
    console.error("  npm run version:patch | minor | major");
    process.exit(1);
}
// peerDependencies intentionally untouched (Phase 1 zero-cross-imports contract)
```

## Diff-Aware Write (Idempotent)
```javascript
// Tab indent + trailing newline — matches npm CLI's package.json format.
// Re-running on a synced repo writes nothing and exits 0.
for (const [depName, currentVersion] of Object.entries(pkg.data.dependencies)) {
    if (versionMap[depName]) {
        const newVersion = `^${versionMap[depName]}`;
        if (currentVersion !== newVersion) {
            pkg.data.dependencies[depName] = newVersion;
            updated = true; totalUpdates++;
        }
    }
}
if (updated) writeFileSync(pkg.path, `${JSON.stringify(pkg.data, null, "\t")}\n`);
```

## Wrapped execSync Runner
```javascript
// release.mjs — every shell-out goes through this. Echo + fail-fast unless ignoreError.
function run(cmd, options = {}) {
    console.log(`$ ${cmd}`);
    try {
        return execSync(cmd, { encoding: "utf-8",
                               stdio: options.silent ? "pipe" : "inherit", ...options });
    } catch (_e) {
        if (!options.ignoreError) { console.error(`Command failed: ${cmd}`); process.exit(1); }
        return null;
    }
}
```

## CHANGELOG Promotion + Reinstatement
- **Promote** (`release.mjs:106-122`): literal-string replace `## [Unreleased]` → `## [x.y.z] - YYYY-MM-DD`. Skip silently if section missing (heterogeneous packages tolerated).
- **Reinstate** (`release.mjs:124-136`): regex `/^(## \[)/m` injects `## [Unreleased]\n\n` above the FIRST `## [` heading. NOT idempotent — running twice yields two `[Unreleased]` headings; the release flow guarantees single invocation.

## Architectural Boundaries
- **NO third-party deps** — Node built-ins + shell-outs only; `compareVersions` is hand-rolled rather than depending on `semver`
- **`packages/rpiv-pi` is the canonical version oracle** — every other package follows; never read version from a different package
- **`peerDependencies` are intentionally untouched** by `sync-versions.js` — Phase 1 zero-cross-imports contract; peer deps stay `"*"`
- **Fail-fast via `process.exit(1)`** — no thrown errors at top level; `run()` exits on shell failure
- **Lockstep is sacred** — `getVersion()` reads only `packages/rpiv-pi/package.json` because `sync-versions.js` guarantees parity
- **Filesystem-driven discovery** — both scripts use `readdirSync("packages")`; new packages auto-pick-up with no script edits

<important if="you are cutting a new release">
## Cutting a Release
1. Ensure clean tree (`git status` shows no changes); `release.mjs` exits 1 otherwise
2. Pick: `node scripts/release.mjs <patch|minor|major>` (delegates to `npm run version:*`) OR `node scripts/release.mjs 1.2.3` (must be strictly greater than current)
3. The script: bumps versions across all workspaces (lockstep), promotes every `packages/*/CHANGELOG.md` `[Unreleased]` → `[x.y.z] - YYYY-MM-DD`, commits, tags `v<version>`, runs `npm publish -ws --access public`, reinstates `[Unreleased]`, commits, pushes `main` + tag
4. On any mid-flight failure, the script `process.exit(1)`s — review state manually before retrying (no automatic rollback)
5. Explicit-version path additionally deletes `node_modules` + `package-lock.json` and reinstalls — guarantees lockfile honesty
</important>

<important if="you are adding a new package to the monorepo">
## Adding a Package
1. Create `packages/<new-pkg>/package.json` with `version` matching all other packages
2. Optionally add `CHANGELOG.md` containing `## [Unreleased]` — release script auto-detects via `existsSync` filter
3. Run `node scripts/sync-versions.js` to wire any intra-monorepo deps to `^<lockstep-version>`
4. Discovery is automatic — both scripts use `readdirSync("packages")`; no script edits needed
5. If the package is a Pi sibling extension, also add: a `siblings.ts` entry in `rpiv-pi/extensions/rpiv-core/`, and a `peerDependencies` entry in `rpiv-pi/package.json` pinned to `"*"`
</important>
