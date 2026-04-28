import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url));

describe("publish manifest", () => {
	it("`package.json` `files` array covers every top-level production .ts module", () => {
		const pkgRaw = readFileSync(resolve(PACKAGE_DIR, "package.json"), "utf8");
		const pkg = JSON.parse(pkgRaw) as { files?: string[] };
		const declared = new Set(pkg.files ?? []);

		const onDisk = readdirSync(PACKAGE_DIR, { withFileTypes: true })
			.filter((e) => e.isFile() && e.name.endsWith(".ts") && !e.name.endsWith(".test.ts"))
			.map((e) => e.name);

		const missing = onDisk.filter((f) => !declared.has(f));
		expect(missing).toEqual([]);
	});
});
