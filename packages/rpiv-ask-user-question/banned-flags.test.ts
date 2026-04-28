import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url));

const BANNED = ["isOther", "isChat", "isNext", "wasCustom", "wasChat"] as const;
const SCAN_EXTS: readonly string[] = [".ts"];
const EXCLUDE_SUFFIXES: readonly string[] = [".test.ts"];

describe("banned legacy discriminator flags", () => {
	it("no production source references the pre-1.0.3 boolean flags", () => {
		const files = readdirSync(PACKAGE_DIR, { withFileTypes: true })
			.filter(
				(e) =>
					e.isFile() &&
					SCAN_EXTS.some((ext) => e.name.endsWith(ext)) &&
					!EXCLUDE_SUFFIXES.some((suf) => e.name.endsWith(suf)),
			)
			.map((e) => e.name);

		const offenders: string[] = [];
		for (const file of files) {
			const text = readFileSync(resolve(PACKAGE_DIR, file), "utf8");
			for (const flag of BANNED) {
				const re = new RegExp(`\\b${flag}\\b`);
				if (re.test(text)) offenders.push(`${file}: ${flag}`);
			}
		}
		expect(offenders).toEqual([]);
	});
});
