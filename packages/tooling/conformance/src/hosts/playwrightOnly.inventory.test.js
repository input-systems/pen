/**
 * Honest inventory: `pnpm test` is the Node host glob. Playwright
 * scenarios and the DOM wrappers they call are a different population.
 * Leaving that implicit is how standing checks read as covered.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const hostsDir = fileURLToPath(new URL(".", import.meta.url));

function listFiles(root, predicate) {
	const found = [];
	function walk(dir) {
		for (const entry of readdirSync(dir)) {
			if (entry === "node_modules" || entry === "test-results") {
				continue;
			}
			const full = join(dir, entry);
			if (statSync(full).isDirectory()) {
				walk(full);
				continue;
			}
			if (predicate(entry, full)) {
				found.push(relative(packageRoot, full));
			}
		}
	}
	walk(root);
	return found.sort();
}

test("pnpm test is src/hosts/*.test.js; Playwright specs are a separate population", () => {
	const hostTests = listFiles(hostsDir, (name) => name.endsWith(".test.js"));
	const scenarioSpecs = listFiles(join(packageRoot, "scenarios"), (name) =>
		name.endsWith(".spec.ts"),
	);
	const suiteSpecs = listFiles(join(packageRoot, "suites"), (name) =>
		name.endsWith(".spec.ts"),
	);
	const playwrightSpecs = [...scenarioSpecs, ...suiteSpecs];

	assert.ok(
		hostTests.length > 0,
		`host glob src/hosts/*.test.js matched ${hostTests.length} files: ${hostTests.join(", ")}`,
	);
	assert.ok(
		playwrightSpecs.length > 0,
		`Playwright glob scenarios/**/*.spec.ts + suites/**/*.spec.ts matched ${playwrightSpecs.length} files`,
	);
	assert.equal(
		hostTests.includes("src/hosts/playwrightOnly.inventory.test.js"),
		true,
		`host population missing this file: ${hostTests.join(", ")}`,
	);

	const manifest = JSON.parse(
		readFileSync(join(packageRoot, "package.json"), "utf8"),
	);
	assert.match(manifest.scripts.test, /src\/hosts\/\*\.test\.js/);
	assert.doesNotMatch(manifest.scripts.test, /playwright/);
	assert.doesNotMatch(manifest.scripts.test, /scenarios/);
	assert.equal(manifest.scripts.test, manifest.scripts["test:node"]);
	assert.equal(manifest.scripts.test, manifest.scripts["test:hosts"]);
	assert.match(manifest.scripts["test:chromium"], /playwright test/);

	const readme = readFileSync(join(packageRoot, "README.md"), "utf8");
	assert.match(readme, /A green `pnpm test` is not conformance/);

	const workflow = readFileSync(
		join(packageRoot, "../../../.github/workflows/conformance.yml"),
		"utf8",
	);
	assert.match(
		workflow,
		/run test:\$\{\{ matrix\.engine \}\}/,
		"CI conformance-engine must invoke test:${{ matrix.engine }}, not only pnpm test",
	);
	// The matrix moved from an inline list to `include` rows so each leg could
	// carry a display label; what matters here is the engine coverage, not the
	// shape the coverage is written in.
	for (const engine of ["chromium", "webkit", "firefox"]) {
		assert.match(
			workflow,
			new RegExp(`engine: ${engine}\\b`),
			`CI conformance matrix must still cover ${engine}`,
		);
	}
	assert.doesNotMatch(
		workflow,
		/filter @input\/pen-conformance test(?:\s|$)/,
		"CI must not treat the Node host script as the Playwright gate",
	);

	console.log(
		`host glob src/hosts/*.test.js → ${hostTests.length} files:\n  ${hostTests.join("\n  ")}`,
	);
	console.log(
		`Playwright glob scenarios/**/*.spec.ts + suites/**/*.spec.ts → ${playwrightSpecs.length} files:\n  ${playwrightSpecs.join("\n  ")}`,
	);

	const hostSources = hostTests.map((rel) =>
		readFileSync(join(packageRoot, rel), "utf8"),
	);
	const hostImports = hostSources.join("\n");
	assert.doesNotMatch(
		hostImports,
		/from ["']\.\.\/standingAssertions["']/,
		"Node hosts must not import Playwright standingAssertions",
	);
	assert.doesNotMatch(
		hostImports,
		/from ["']\.\.\/axeSurface["']/,
		"Node hosts must not import Playwright axeSurface",
	);
	assert.doesNotMatch(
		hostImports,
		/from ["'].*harness\/src\/geometry["']/,
		"Node hosts must not import harness/src/geometry.ts",
	);
	assert.doesNotMatch(
		hostImports,
		/from ["'].*harness\/src\/session["']/,
		"Node hosts must not import harness/src/session.ts",
	);

	// Hardcoded on purpose: a derived count cannot detect drift, which is this
	// assertion's only job. The number is a shared resource across concurrent
	// work — any lane adding a spec must bump it, and two lanes adding specs in
	// the same round will both be right and still collide here (48 -> 56 on
	// 2026-08-24 was geometry/overlays staffing plus a concurrent selection
	// spec; 56 -> 63 later the same day was a seven-lane round adding AX6,
	// T3, T4, bidi, EM empty-blocks and two geometry specs at once; 63 -> 64
	// is CS10 moving getSelection engine-fidelity out of jsdom). The
	// message states actual vs expected so the fix does not require
	// re-deriving the count by hand.
	// Derived into the message rather than written twice: the literal and the
	// message had already drifted apart (56 asserted, "expected 55" reported),
	// which is the one failure this message exists to prevent.
	// 64 -> 65 on 2026-08-26 is v5 FE6 adding fe6-cell-parity, which asserts
	// the table-cell parity contract on all three engines: the declared-
	// supported capabilities work in a cell, and a mark toggle leaves the
	// document byte-identical while reporting cell-capability-unsupported.
	// 65 -> 66 on 2026-08-27 is RI5 adding ri5-soft-break, which runs unstyled
	// so the library's own inline `white-space: pre-wrap` is the only thing
	// that can put a stored `\n` on its own line.
	// 66 -> 67 the same day is RI5's other half, ri5-trailing-space-caret: a
	// trailing space has no advance width under `normal`, so the caret was
	// painted at the same x before and after one was typed.
	// 67 -> 68 is FE9: suites/input/fe9-editcontext-mapped-caret.spec.ts.
	// 68 -> 69 is FE10: suites/geometry/host-chrome-drag.spec.ts, where the
	// drag anchors beside the column rather than on a block, so the gesture
	// only exists if the host-chrome fallback opened it.
	// 69 -> 70 is G4/G5 in code blocks: scenarios/g5-code-block-lines.spec.ts,
	// where blank lines own line boxes and clicks map to text offsets.
	// 70 -> 72 is C2 real composition (suites/ime/c2-real-composition.spec.ts)
	// and R1 drag-window close (suites/selection/r1-drag-window.spec.ts), W0.
	// 72 -> 73 is SCALE1 scale fixtures: scenarios/scale-fixtures.spec.ts.
	// 73 -> 74 is the harness surfaces: scenarios/harness-surfaces.spec.ts.
	// 74 -> 75 is SCALE6 renderer counts: scenarios/scale-render.record.spec.ts.
	// 75 -> 76 is W3.R1 projection read-back: suites/selection/p-projection.spec.ts.
	// 76 -> 77 is the multi-click guard for W3.R5/W3.R12:
	// suites/selection/r-multi-click.spec.ts.
	// 77 -> 78 is W3.R8 keyed mount ack on three surfaces:
	// suites/selection/p4-vanilla-ack.spec.ts.
	// 78 -> 79 is W3.R19 the PR DOM fuzz job: suites/fuzz/dom-fuzz.spec.ts.
	// 79 -> 81 is W1's scale-render clocks (scenarios/scale-render.clocks.record.spec.ts)
	// and W3.R11's origins (suites/selection/s3-origins.spec.ts).
	// 81 -> 82 is W3.R16's focus targets: suites/selection/focus-sink.spec.ts.
	// 82 -> 83 is W35 step 2's customCaret mode: suites/overlays/custom-caret.spec.ts.
	// 83 -> 88 is W35 step 3's default overlay: suites/overlays/{o5-readonly,
	// g3-affinity,ax7-overlay-presentation,o-focus-composition,ov1-paint-counts}.spec.ts.
	// 88 -> 89 is W35.G7's atom and chip caret set: suites/overlays/o1-atoms.spec.ts.
	// 89 -> 90 is W5.R10's two-editor relay set: scenarios/col-two-editors.spec.ts.
	// 91 -> 94: suites/selection/r1-native-range.spec.ts (W3.G20), scenarios/ax1-list-editing.spec.ts (W6.G2), suites/selection/s2-states.spec.ts (W3.G19).
	// 94 -> 96: suites/selection/r1-context-menu-window.spec.ts (R1) and suites/input/fe9-editcontext-programmatic-caret.spec.ts (FE9).
	const expectedPlaywrightSpecs = 96;
	assert.equal(
		playwrightSpecs.length,
		expectedPlaywrightSpecs,
		`Playwright spec population drifted: expected ${expectedPlaywrightSpecs}, found ${playwrightSpecs.length}. Update this number if the change is intended. Specs: ${playwrightSpecs.join(", ")}`,
	);

	// Five of these six were empty until 2026-08-23, and an empty directory is
	// indistinguishable from a covered one in the total above. Lock each by name
	// so the suite cannot quietly shrink back to a single populated area.
	for (const area of [
		"bidi",
		"geometry",
		"ime",
		"input",
		"overlays",
		"selection",
	]) {
		const areaSpecs = suiteSpecs.filter((rel) =>
			rel.startsWith(`suites/${area}/`),
		);
		console.log(
			`suites/${area}/**/*.spec.ts → ${areaSpecs.length} files:\n  ${areaSpecs.join("\n  ")}`,
		);
		assert.ok(
			areaSpecs.length > 0,
			`suites/${area}/ must contain live spec files, not only .gitkeep`,
		);
	}
});
