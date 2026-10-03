import assert from "node:assert/strict";
import { test } from "node:test";

import {
	checkMatrix,
	existsInRepo,
	readRepoMatrix,
	runSelfTests,
	selfTestMatrix,
} from "../check-capability-matrix.mjs";

const always = () => true;

const HEADER =
	"| Capability | React | Vue | Vanilla | Headless |\n| --- | --- | --- | --- | --- |";

test("HB5: a claiming cell that names only a document fails the matrix check", () => {
	const result = checkMatrix(selfTestMatrix("`packages/rendering/vue/STYLING.md`"), always);
	assert.equal(result.failures.length, 1);
	assert.match(result.failures[0], /must name a test, conformance spec, or example/);
});

test("HB5: a document beside a conformance spec is evidence", () => {
	const result = checkMatrix(
		selfTestMatrix(
			"`packages/rendering/vue/STYLING.md` and `packages/tooling/conformance/suites/overlays/o1.spec.ts`",
		),
		always,
	);
	assert.deepEqual(result.failures, []);
	assert.equal(result.claims, 2);
});

test("HB5: a playground path or a missing path fails a claiming cell", () => {
	const playground = checkMatrix(selfTestMatrix("`playground/src/__tests__/a.test.ts`"), always);
	assert.match(playground.failures.join("\n"), /reference host, not the proof/);
	const missing = checkMatrix(
		selfTestMatrix("`packages/core/src/__tests__/a.test.ts`"),
		(path) => !path.startsWith("packages/core"),
	);
	assert.match(missing.failures.join("\n"), /does not exist/);
});

test("HB1: a status outside the vocabulary and a short row fail", () => {
	const result = checkMatrix(
		`${HEADER}\n| A | \`mostly\` | \`planned\` | \`planned\` | \`planned\` |\n| B | \`planned\` |\nprose\n| C | not a capability table |`,
		always,
	);
	const failures = result.failures.join("\n");
	assert.match(failures, /outside the vocabulary/);
	assert.match(failures, /capability row has 2 cells/);
	assert.equal(result.capabilityRows, 1);
});

test("HB1: a source with no capability header fails closed", () => {
	assert.match(checkMatrix("# nothing\n", always).failures[0], /found no capability rows/);
});

test("HB1 HB5: the committed matrix and the self-test pass", () => {
	assert.deepEqual(checkMatrix(readRepoMatrix(), existsInRepo).failures, []);
	assert.deepEqual(runSelfTests(), []);
});
