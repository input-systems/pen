#!/usr/bin/env node
/**
 * OV3 gate (W35.G1). The React and Vue overlay primitives are bindings over
 * `@input/pen-dom`'s `RootOverlay`: they hold no measurement code and no
 * frame driver of their own. A binding is an overlay primitive when its
 * basename names a caret, a selection rect, or the overlay layout/paint hooks.
 * One that still measures is listed in `scripts/overlay-measure-free-allowlist.json`
 * with a reason and the requirement that removes it (`closedBy`). An entry
 * whose file no longer measures fails (I15), so the list only shrinks.
 *
 * Usage: node scripts/overlay-measure-free.mjs [--self-test]
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { listProductionSources } from "./lib/productionSources.mjs";

const REPO_ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const ROOTS = ["packages/rendering/react/src", "packages/rendering/vue/src"];
const ALLOWLIST_PATH = path.join(
	REPO_ROOT,
	"scripts/overlay-measure-free-allowlist.json",
);

/** Basenames of overlay bindings: carets, selection rects, overlay layout and paint-plan hooks. */
export const OVERLAY_BINDING = /(caret|selectionrect|overlaylayout|overlaypaint)/i;

/** Identifiers that measure layout or drive their own frame loop. */
export const MEASURING_NAMES = new Set([
	"measureWithRoot",
	"measureNow",
	"getBoundingClientRect",
	"getClientRects",
	"useOverlayLayout",
	"requestAnimationFrame",
	"MutationObserver",
	"ResizeObserver",
	"getComputedStyle",
	"caretRect",
	"rangeRects",
	"blockRect",
	"lineBoxes",
]);

function listSources(root) {
	return listProductionSources(REPO_ROOT, root, /\.(tsx?|vue)$/, { allowMissingRoot: true });
}

export function isOverlayBinding(file) {
	return OVERLAY_BINDING.test(path.basename(file));
}

/** Measuring identifiers referenced in `source` (comments and strings do not count). */
export function findMeasuringNames(file, source) {
	const sourceFile = ts.createSourceFile(
		file,
		source,
		ts.ScriptTarget.Latest,
		true,
		file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
	);
	const found = new Set();
	const visit = (node) => {
		if (ts.isIdentifier(node) && MEASURING_NAMES.has(node.text)) {
			found.add(node.text);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return [...found].sort();
}

/** Violations, orphaned and incomplete allowlist entries for a set of measuring bindings. */
export function evaluate(measuring, allowlist) {
	const listed = new Set(allowlist.map((entry) => entry.file));
	const violations = measuring.filter((hit) => !listed.has(hit.file));
	const live = new Set(measuring.map((hit) => hit.file));
	const orphaned = allowlist.filter((entry) => !live.has(entry.file));
	const incomplete = allowlist.filter(
		(entry) => !entry.file || !entry.reason || !entry.closedBy,
	);
	return { violations, orphaned, incomplete };
}

function scan(files, read) {
	return files
		.filter(isOverlayBinding)
		.map((file) => ({ file, names: findMeasuringNames(file, read(file)) }))
		.filter((hit) => hit.names.length > 0);
}

function selfTest() {
	const sources = new Map([
		[
			"packages/rendering/react/src/primitives/editor/caretOverlay.tsx",
			"export function A() { return measureWithRoot(root, () => 1); }",
		],
		[
			"packages/rendering/react/src/primitives/multiplayer/caretOverlay.tsx",
			"// getBoundingClientRect is only mentioned here\nexport const label = 'getBoundingClientRect';",
		],
		[
			"packages/rendering/vue/src/components/caretLayer.ts",
			"export function b(el) { return el.getBoundingClientRect(); }",
		],
		[
			"packages/rendering/react/src/primitives/editor/dragOverlay.tsx",
			"export function c(el) { return el.getBoundingClientRect(); }",
		],
	]);
	const hits = scan([...sources.keys()], (file) => sources.get(file));
	const failures = [];
	if (hits.length !== 2) {
		failures.push(
			`expected 2 measuring bindings (comments, strings and non-overlay files excluded), found ${hits.length}`,
		);
	}
	const result = evaluate(hits, [
		{
			file: "packages/rendering/react/src/primitives/editor/caretOverlay.tsx",
			reason: "seeded",
			closedBy: "W35.R9",
		},
		{
			file: "packages/rendering/react/src/primitives/multiplayer/caretOverlay.tsx",
			reason: "seeded",
			closedBy: "W35.R12",
		},
	]);
	if (
		result.violations.length !== 1 ||
		result.violations[0]?.file !==
			"packages/rendering/vue/src/components/caretLayer.ts"
	) {
		failures.push("an unlisted measuring binding must be a violation");
	}
	if (result.orphaned.length !== 1) {
		failures.push("an entry whose binding no longer measures must be orphaned");
	}
	if (evaluate([], [{ file: "x.tsx", reason: "seeded" }]).incomplete.length !== 1) {
		failures.push("an entry without closedBy must be incomplete");
	}
	if (failures.length > 0) {
		console.error(
			`overlay-measure-free self-test FAILED:\n  ${failures.join("\n  ")}`,
		);
		process.exit(1);
	}
	console.log(
		"overlay-measure-free self-test: an unlisted measuring binding fails, an orphaned entry fails, comments and non-overlay files do not count.",
	);
}

function main() {
	if (process.argv.includes("--self-test")) {
		selfTest();
		return;
	}
	const allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8")).entries;
	const files = ROOTS.flatMap(listSources);
	const hits = scan(files, (file) =>
		readFileSync(path.join(REPO_ROOT, file), "utf8"),
	);
	const { violations, orphaned, incomplete } = evaluate(hits, allowlist);
	for (const hit of violations) {
		console.error(
			`FAIL ${hit.file} measures (${hit.names.join(", ")}) (OV3). Register a contributor on getRootOverlay(root) instead, or allowlist it with a reason and closedBy.`,
		);
	}
	for (const entry of orphaned) {
		console.error(
			`FAIL allowlist entry ${entry.file} matches no measuring overlay binding (I15). Remove it.`,
		);
	}
	for (const entry of incomplete) {
		console.error(
			`FAIL allowlist entry needs file, reason and closedBy: ${JSON.stringify(entry)}`,
		);
	}
	if (violations.length + orphaned.length + incomplete.length > 0) {
		process.exit(1);
	}
	const bindings = files.filter(isOverlayBinding).length;
	console.log(
		`OK: ${bindings} overlay bindings scanned; ${hits.length} allowlisted still measure (OV3).`,
	);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
	main();
}
