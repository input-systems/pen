/**
 * W3.R19: the DOM fuzzer's Node-checkable halves. The generator must be a
 * pure function of the seed and the document view (a PR seed has to name
 * the same run on every machine), and the verdict must fail the checks the
 * Playwright spec relies on — including unchecked S2, which is not a hold.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { generateAction } from "../fuzz/dom/actions.ts";
import { evaluateFuzzReport } from "../fuzz/dom/invariants.ts";
import {
	createFuzzRng,
	parseFuzzSeed,
	PR_FUZZ_SEEDS,
	resolveDomFuzzConfig,
} from "../fuzz/dom/seed.ts";

const BLOCKS = [
	{ id: "a", type: "paragraph", length: 12, kind: "text" },
	{ id: "d", type: "divider", length: 0, kind: "structural" },
	{ id: "b", type: "paragraph", length: 4, kind: "text" },
	{ id: "c", type: "paragraph", length: 0, kind: "text" },
	{ id: "e", type: "paragraph", length: 7, kind: "text" },
	{ id: "f", type: "paragraph", length: 9, kind: "text" },
	{ id: "g", type: "paragraph", length: 3, kind: "text" },
	{ id: "h", type: "heading", length: 5, kind: "text" },
];

function run(seed, steps) {
	const rng = createFuzzRng(seed);
	return Array.from({ length: steps }, (_, i) =>
		generateAction(rng, { seed, i, blocks: BLOCKS }),
	);
}

function report(overrides = {}) {
	return {
		s2: { ok: true },
		s5: { ok: true },
		record: { version: 3, commitId: 2 },
		diagnostics: [],
		documents: {
			localErrors: [],
			remoteErrors: [],
			stateVectorsEqual: true,
		},
		blocks: BLOCKS,
		...overrides,
	};
}

test("fuzz:dom generator: one seed yields one action list, another seed a different one", () => {
	assert.deepEqual(run(11, 60), run(11, 60));
	assert.notDeepEqual(run(11, 60), run(23, 60));
	const kinds = new Set(run(11, 400).map((action) => action.kind));
	for (const kind of [
		"click",
		"drag",
		"arrow",
		"shift-arrow",
		"type",
		"enter",
		"backspace",
		"select-all",
		"undo",
		"redo",
		"remote",
	]) {
		assert.ok(
			kinds.has(kind),
			`400 steps of seed 11 never generated ${kind}`,
		);
	}
});

test("fuzz:dom generator: caret placements target text blocks within their length", () => {
	for (const action of run(37, 400)) {
		if (action.kind !== "enter" && action.kind !== "backspace") continue;
		const block = BLOCKS.find(
			(candidate) => candidate.id === action.args.blockId,
		);
		assert.equal(block?.kind, "text");
		assert.ok(
			action.args.offset === 0 || action.args.offset === block.length,
		);
	}
});

test("fuzz:dom seeds: PR seeds by default, one parsed seed when given, 24 derived seeds nightly", () => {
	assert.deepEqual(resolveDomFuzzConfig({}).seeds, [...PR_FUZZ_SEEDS]);
	assert.equal(resolveDomFuzzConfig({}).steps, 40);
	assert.deepEqual(resolveDomFuzzConfig({ PEN_FUZZ_SEED: "7" }).seeds, [7]);
	assert.equal(
		parseFuzzSeed("run-12-1").numeric,
		parseFuzzSeed("run-12-1").numeric,
	);
	const nightly = resolveDomFuzzConfig({
		PEN_FUZZ_NIGHTLY: "1",
		PEN_FUZZ_SEED: "run-12-1",
	});
	assert.equal(nightly.seeds.length, 24);
	assert.equal(nightly.steps, 250);
	assert.deepEqual(
		nightly.seeds,
		resolveDomFuzzConfig({
			PEN_FUZZ_NIGHTLY: "1",
			PEN_FUZZ_SEED: "run-12-1",
		}).seeds,
	);
	assert.equal(
		resolveDomFuzzConfig({
			PEN_FUZZ_OP_COUNT: "5",
			PEN_FUZZ_FORCE_FAIL_AT: "0",
		}).forceFailAt,
		0,
	);
});

test("S2/S6: fuzz:dom verdict fails unchecked S2, a decreasing record, standing diagnostics and divergent peers", () => {
	assert.equal(evaluateFuzzReport(report(), report()), null);
	assert.equal(
		evaluateFuzzReport(report({ s2: { ok: false, skipped: true } }), null)
			?.check,
		"S2",
	);
	assert.equal(
		evaluateFuzzReport(report({ s5: { ok: false, reason: "x" } }), null)
			?.check,
		"S5",
	);
	assert.equal(
		evaluateFuzzReport(
			report({ record: { version: 2, commitId: 2 } }),
			report(),
		)?.check,
		"S6",
	);
	assert.equal(
		evaluateFuzzReport(
			report({
				diagnostics: [{ code: "selection-projection-mismatch" }],
			}),
			null,
		)?.check,
		"diagnostics",
	);
	assert.equal(
		evaluateFuzzReport(
			report({ diagnostics: [{ code: "a11y-missing-label" }] }),
			null,
		),
		null,
	);
	assert.equal(
		evaluateFuzzReport(
			report({
				documents: {
					localErrors: [],
					remoteErrors: [],
					stateVectorsEqual: false,
				},
			}),
			null,
		)?.check,
		"document",
	);
});
