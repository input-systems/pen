import assert from "node:assert/strict";
import { test } from "node:test";

import {
	claimsFromFiles,
	evaluate,
	extractTestTitles,
	hasFailures,
	inventoryFromDocs,
	parseScope,
} from "../rule-coverage.mjs";

const inventory = inventoryFromDocs([
	{
		doc: "rules/selection",
		text: "# Sel\n\n## R\n\n- XR1. Windows.\n- XS1. One writer.\n\n## Retired\n\n- XS9. Gone.\n",
	},
	{
		doc: "rules/facets",
		text: "## R\n\n- **XR1.** Providers.\n- XI2. RETIRED. Mapping.\n",
	},
]);

const config = {
	ambiguous: {
		XR: {
			"rules/selection": ["packages/rendering/"],
			"rules/facets": ["packages/core/"],
		},
	},
};

const s1File = {
	path: "packages/rendering/dom/a.test.ts",
	text: 'it("XS1: one writer", () => {});',
};

function check(files, scope, overrides = {}) {
	const read = claimsFromFiles(files, inventory, overrides.config ?? config);
	return evaluate({
		inventory: overrides.inventory ?? inventory,
		claims: read.claims,
		unconfigured: read.unconfigured,
		fileCount: files.length,
		scope,
	});
}

test("CH11: the inventory skips Retired sections and RETIRED bullets and reads bold IDs", () => {
	assert.deepEqual([...inventory.keys()].sort(), [
		"rules/facets#XR1",
		"rules/selection#XR1",
		"rules/selection#XS1",
	]);
});

test("CH11: a recorded claim passes and unclaimed rules are reported", () => {
	const result = check([s1File], ["rules/selection#XS1"]);
	assert.equal(hasFailures(result), false);
	assert.deepEqual(result.unclaimed, ["rules/facets#XR1", "rules/selection#XR1"]);
});

test("CH11: F1 a scope entry with no claiming test fails", () => {
	const result = check([{ path: "x.test.ts", text: "" }], ["rules/selection#XS1"]);
	assert.deepEqual(result.f1, ["rules/selection#XS1"]);
});

test("CH11: F2 a scope entry naming a retired ID fails (I15)", () => {
	const result = check([s1File], ["rules/selection#XS1", "rules/selection#XS9"]);
	assert.deepEqual(result.f2, ["rules/selection#XS9"]);
});

test("CH11: F3 an unrecorded claim fails", () => {
	assert.deepEqual(check([s1File], []).f3, ["rules/selection#XS1"]);
});

test("CH11: F4 an empty spec walk or test walk fails closed", () => {
	assert.ok(check([s1File], [], { inventory: new Map() }).f4.length > 0);
	assert.ok(check([], []).f4.length > 0);
});

test("CH11: F4 an unconfigured ambiguous family fails", () => {
	const result = check(
		[{ path: "packages/x/a.test.ts", text: 'test("XR1 ok", () => {});' }],
		[],
		{ config: {} },
	);
	assert.ok(result.f4.some((entry) => entry.includes("family XR")));
});

test("CH11: skip, todo and fixme titles do not claim; each() and template literals do", () => {
	const titles = extractTestTitles(
		'it.skip("XS1 a", f); test.todo("XS1 b"); describe.each([1, 2])("XS1 c %s", f); test.describe.fixme("XS1 d", f); scenario(`XS1 ${x} e`, f);',
	);
	assert.deepEqual(titles, ["XS1 c %s", "XS1   e"]);
});

test("CH11: file names do not claim", () => {
	const result = check([{ path: "packages/rendering/dom/XS1.test.ts", text: "" }], []);
	assert.deepEqual(result.f3, []);
});

test("CH11: a [selection] qualifier resolves an ambiguous ID", () => {
	const { claims } = claimsFromFiles(
		[{ path: "packages/core/x.test.ts", text: 'it("XR1 [selection]: window", f);' }],
		inventory,
		config,
	);
	assert.ok(claims.has("rules/selection#XR1"));
});

test("CH11: the test path resolves an ambiguous ID", () => {
	const { claims } = claimsFromFiles(
		[{ path: "packages/core/x.test.ts", text: 'it("XR1: provider", f);' }],
		inventory,
		config,
	);
	assert.ok(claims.has("rules/facets#XR1"));
});

test("CH11: scope comments and blank lines are ignored and keys keep their #", () => {
	assert.deepEqual(parseScope("# comment\nrules/selection#XS1\n\n"), ["rules/selection#XS1"]);
});
