import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DATA_ATTRS, buildDataAttributes } from "../utils/dataAttributes";

const RENDERING_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const CATALOG = new Set<string>(Object.values(DATA_ATTRS));

function listProductionSources(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "__tests__") continue;
			files.push(...listProductionSources(path));
			continue;
		}
		if (
			/\.tsx?$/.test(entry.name) &&
			!/\.test\.tsx?$/.test(entry.name)
		) {
			files.push(path);
		}
	}
	return files;
}

function emittedNamesFromSource(source: string): {
	names: string[];
	dynamicCalls: number;
} {
	const names: string[] = [];
	let dynamicCalls = 0;
	let from = 0;
	while (true) {
		const start = source.indexOf("buildDataAttributes({", from);
		if (start === -1) break;
		const open = source.indexOf("{", start);
		let depth = 0;
		let close = open;
		for (let i = open; i < source.length; i++) {
			if (source[i] === "{") depth += 1;
			else if (source[i] === "}") {
				depth -= 1;
				if (depth === 0) {
					close = i;
					break;
				}
			}
		}
		const body = source.slice(open + 1, close);
		let resolvedAny = false;
		for (const line of body.split("\n")) {
			const trimmed = line.trim().replace(/,$/, "");
			if (!trimmed) continue;
			const computed = /^\[DATA_ATTRS\.(\w+)\]/.exec(trimmed);
			if (computed) {
				const value =
					DATA_ATTRS[computed[1] as keyof typeof DATA_ATTRS];
				if (typeof value !== "string") {
					throw new Error(
						`DATA_ATTRS.${computed[1]} is not in the catalog`,
					);
				}
				names.push(value);
				resolvedAny = true;
				continue;
			}
			if (/^\[name\]/.test(trimmed)) {
				dynamicCalls += 1;
				continue;
			}
			const quoted = /^["']([^"']+)["']/.exec(trimmed);
			if (quoted) {
				names.push(
					quoted[1].startsWith("data-")
						? quoted[1]
						: `data-${quoted[1]}`,
				);
				resolvedAny = true;
				continue;
			}
			const ident = /^([A-Za-z_$][\w$]*)/.exec(trimmed);
			if (ident) {
				names.push(`data-${ident[1]}`);
				resolvedAny = true;
			}
		}
		if (!resolvedAny && !/\[name\]/.test(body)) {
			throw new Error(`unreadable buildDataAttributes call: ${body}`);
		}
		from = close;
	}
	return { names, dynamicCalls };
}

describe("DATA_ATTRS catalog pin", () => {
	it("explicit DATA_ATTRS keys emit the same names as the unprefixed shorthand", () => {
		const shorthand = buildDataAttributes({
			focused: true,
			readonly: true,
			empty: true,
		});
		const explicit = buildDataAttributes({
			[DATA_ATTRS.focused]: true,
			[DATA_ATTRS.readonly]: true,
			[DATA_ATTRS.empty]: true,
		});
		expect(JSON.stringify(explicit)).toBe(JSON.stringify(shorthand));
		expect(Object.keys(explicit)).toEqual([
			DATA_ATTRS.focused,
			DATA_ATTRS.readonly,
			DATA_ATTRS.empty,
		]);
	});

	// setBooleanAttr passes a DATA_ATTRS value as `[name]`; the pin cannot
	// read that key statically and does not cover those two pen-dom call sites.
	// The React and Vue bindings emit through the same helper and are pinned here.
	it.each([
		{ pkg: "dom", dynamicCalls: 2 },
		{ pkg: "react", dynamicCalls: 0 },
		{ pkg: "vue", dynamicCalls: 0 },
	])(
		"every name pen-$pkg emits through buildDataAttributes is a DATA_ATTRS value",
		({ pkg, dynamicCalls: expectedDynamicCalls }) => {
			const unknown: string[] = [];
			let calls = 0;
			let dynamicCalls = 0;
			for (const file of listProductionSources(
				join(RENDERING_ROOT, pkg, "src"),
			)) {
				const source = readFileSync(file, "utf8");
				if (!source.includes("buildDataAttributes({")) continue;
				const extracted = emittedNamesFromSource(source);
				calls += 1;
				dynamicCalls += extracted.dynamicCalls;
				for (const name of extracted.names) {
					if (!CATALOG.has(name)) unknown.push(`${file}: ${name}`);
				}
			}
			expect(calls).toBeGreaterThan(0);
			expect(unknown).toEqual([]);
			expect(dynamicCalls).toBe(expectedDynamicCalls);
		},
	);
});
