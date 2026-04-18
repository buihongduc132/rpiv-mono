# rpiv-web-tools

## Monorepo Context
Sibling Pi extension in `rpiv-mono` (npm workspaces). Lockstep version with all `@juicesharp/rpiv-*` packages — never bump independently; use `node scripts/release.mjs <bump|x.y.z>` from repo root. Listed in `extensions/rpiv-core/siblings.ts` so `/rpiv-setup` installs it. Peer-pinned in `packages/rpiv-pi/package.json` as `"*"`. Provides `web_search`/`web_fetch` consumed by the `web-search-researcher` agent in `rpiv-pi/agents/`.

## Responsibility
Single-file Pi extension exposing two tools (`web_search`, `web_fetch`) and one slash command (`/web-search-config`). Search is backed exclusively by the Brave Search REST API; fetch is a generic HTTP client with HTML-to-text conversion and truncation-with-temp-file-spill for context-safe payload sizes.

## Dependencies
- **`@mariozechner/pi-coding-agent`** (peer): `ExtensionAPI`, `truncateHead`, `formatSize`, `DEFAULT_MAX_LINES`, `DEFAULT_MAX_BYTES`
- **`@mariozechner/pi-tui`** (peer): `Text` rendering primitive
- **`@sinclair/typebox`** (peer): tool parameter schemas
- **Brave Search REST**: `https://api.search.brave.com/res/v1/web/search` with `X-Subscription-Token` header
- Node built-ins: `node:fs`, `node:os`, `node:path` (config persistence + temp-file spill)

## Consumers
- **Pi extension host**: loads via `pi.extensions: ["./index.ts"]`
- **`rpiv-pi`**: lists in `peerDependencies` and `siblings.ts`; `agents/web-search-researcher.md` declares `web_search, web_fetch` in its tool allowlist

## Module Structure
```
index.ts        — Single file: API key resolution, searchBrave client, htmlToText helper,
                  loadConfig/saveConfig, tool registrations, /web-search-config command.
                  Section banners (// === web_search tool ===) keep navigation manageable.
README.md       — User-facing docs
```

## API Key Resolution (env wins over config)
```typescript
const CONFIG_PATH = join(homedir(), ".config", "rpiv-web-tools", "config.json");

function resolveApiKey(): string | undefined {
    const envKey = process.env.BRAVE_SEARCH_API_KEY;
    if (envKey?.trim()) return envKey.trim();
    const config = loadConfig();
    if (config.apiKey?.trim()) return config.apiKey.trim();
    return undefined;
}

function saveConfig(config: WebToolsConfig): void {
    mkdirSync(dirname(CONFIG_PATH), { recursive: true });
    writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
    try { chmodSync(CONFIG_PATH, 0o600); } catch { /* best effort */ }
}
```

## Outbound API Call Shape (URL builder, AbortSignal, normalized result)
```typescript
async function searchBrave(query: string, maxResults: number, signal?: AbortSignal) {
    const apiKey = resolveApiKey();
    if (!apiKey) throw new Error("BRAVE_SEARCH_API_KEY is not set. Run /web-search-config to configure...");
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query); url.searchParams.set("count", String(maxResults));
    const res = await fetch(url.toString(), {
        method: "GET",
        headers: { Accept: "application/json", "Accept-Encoding": "gzip", "X-Subscription-Token": apiKey },
        signal,                                              // propagate cancellation
    });
    if (!res.ok) throw new Error(`Brave Search API error (${res.status}): ${await res.text()}`);
    const data = await res.json();
    return { query, results: (data.web?.results ?? []).map(r => ({  // normalize vendor JSON
        title: r.title ?? "", url: r.url ?? "", snippet: r.description ?? "",
    })) };
}
```

## Truncate-Then-Spill Pattern (for large payloads)
```typescript
const truncation = truncateHead(resultText, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
if (truncation.truncated) {
    const tempDir = await mkdtemp(join(tmpdir(), "rpiv-fetch-"));
    const tempFile = join(tempDir, "content.txt");
    await writeFile(tempFile, resultText, "utf8");      // full content spills here
    details.fullOutputPath = tempFile;
    output += `\n\n[Content truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines ... Full content saved to: ${tempFile}]`;
}
```

## Architectural Boundaries
- **NO retry/backoff/throttle** — Brave's 429 surfaces as a thrown error to the agent
- **NO hand-concatenated query strings** — always `new URL(...)` + `searchParams.set`
- **Vendor JSON normalized at the boundary** — internal `SearchResult` shape isolates the rest of the file from vendor changes
- **Hard failures throw `Error`** — the host turns it into a tool-error message; never return success-shaped envelopes for failures
- **Config file mode 0o600** — secrets at rest; `loadConfig` returns `{}` on parse failure (never crashes)
- **`web_fetch` text-only** — `image/`, `video/`, `audio/` content types throw `Unsupported content type`

<important if="you are adding a new web tool to this extension">
## Adding a Tool
1. Decide auth source: reuse `resolveApiKey()` for another Brave endpoint, else add `resolveXxxKey()` + new env var name + `WebToolsConfig` field
2. Add the API client in its own `// === xxx ===` banner section, mirroring `searchBrave`: `URL` + `searchParams.set`, forward `AbortSignal`, throw `Error(\`<Vendor> API error (${status}): ${body}\`)` on `!res.ok`
3. Define internal `XxxResult`/`XxxResponse` interfaces; normalize vendor JSON before returning
4. `pi.registerTool({ name (snake_case), label (Title Case), description, promptSnippet, promptGuidelines, parameters: Type.Object({...}), execute, renderCall, renderResult })`
5. In `execute`: emit one `onUpdate?.({ content, details })` progress frame; return `{ content: [{ type: "text", text: <markdown> }], details: <typed object> }`; spill large output to `mkdtemp(join(tmpdir(), "rpiv-<tool>-"))` and record `details.fullOutputPath`
6. In `renderResult`: branch on `isPartial` then `expanded`; use only `theme.fg("success"|"warning"|"muted"|"dim"|"accent"|"toolTitle", ...)` — never raw ANSI
7. Update file-header docstring (top of `index.ts`) with new env var, config field, slash command
</important>
