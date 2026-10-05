import { globSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function posixGlob(pattern: string): string[] {
	return globSync(pattern, { cwd: repoRoot })
		.map((entry) => entry.split(path.sep).join("/"))
		.sort();
}

// Explicit include, pinned against the workspace `*.properties.test.ts` set
// (spec/rules/reliability.md: pin the list against the source).
// Each file must honour PEN_FUZZ_NIGHTLY, PEN_FUZZ_SEED (incl. hyphenated
// nightly seeds), and PEN_FUZZ_OP_COUNT. A new properties file fails this
// config at load until it is added here *and* given that plumbing.
const propertiesInclude = [
	"packages/core/src/__tests__/unknownContent.dur3.properties.test.ts",
	"packages/extensions/undo/src/__tests__/commitEvent.i1.properties.test.ts",
	"packages/rendering/dom/src/field-editor/__tests__/rebaseTextDiffOps.c2.properties.test.ts",
	"packages/tooling/bench/src/__tests__/cacheAudit.properties.test.ts",
	"packages/tooling/test/src/__tests__/col4.npeer.properties.test.ts",
	"packages/tooling/test/src/__tests__/col4.perCommit.properties.test.ts",
];

const discoveredProperties = posixGlob("packages/**/*.properties.test.ts");
const propertiesSorted = [...propertiesInclude].sort();
if (
	discoveredProperties.length === 0 ||
	discoveredProperties.join("\n") !== propertiesSorted.join("\n")
) {
	throw new Error(
		`vitest.nightly include is not the workspace property-suite set (${discoveredProperties.length} discovered, ${propertiesInclude.length} listed).\n` +
			`discovered:\n${discoveredProperties.join("\n") || "(none)"}\n` +
			`include:\n${propertiesSorted.join("\n")}`,
	);
}

// v3 GATE 1.7: AN fuzz at its nightly count. Not a properties file — the pin
// above would reject it. Empty match is the reserved slot; when the suite
// lands it is included without editing this list.
const anFuzzGlob = "packages/**/*an-fuzz*.test.ts";
const anFuzzInclude = posixGlob(anFuzzGlob);
console.log(
	`an-fuzz nightly glob ${anFuzzGlob} matched ${anFuzzInclude.length}:\n${anFuzzInclude.join("\n") || "(none)"}`,
);

const include = [...propertiesInclude, ...anFuzzInclude];

console.log(
	`nightly property include: ${propertiesInclude.length} files\n${propertiesInclude.join("\n")}\nPEN_FUZZ_NIGHTLY=${process.env.PEN_FUZZ_NIGHTLY ?? "(unset)"} PEN_FUZZ_SEED=${process.env.PEN_FUZZ_SEED ?? "(default)"}`,
);

export default defineConfig({
	root: repoRoot,
	test: {
		name: "nightly-properties",
		include,
		// unknownContent: DUR3 unknown-block passthrough (80 cases).
		// commitEvent: I1 one commit per state change (2000 steps).
		// col4.npeer: COL4 structural interleavings at 3 and 5 peers (2000 cases each).
		// rebaseTextDiffOps.c2: C2 composition rebase against two Y.Docs (20,000 cases).
		// cacheAudit: caches A–G against their naive recompute (200 seeds × 30 ops).
		// col4.perCommit: COL4 per-commit repair (2,000 cases per peer count).
		// an-fuzz: AN1–AN5 / AN14, which sets its own budget from its op
		// count and so is not governed by this default.
		testTimeout: 1_800_000,
	},
});
