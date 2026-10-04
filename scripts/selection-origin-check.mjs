#!/usr/bin/env node
/**
 * S3 origins gate (W3.R11, W3.G7). Every pen-dom and pen-undo production
 * call to an editor selection setter passes an options argument naming its
 * origin. The exceptions — host-API forwarding and `FieldEditor.focus()`
 * re-targeting, which default to `programmatic` on purpose — are listed in
 * `scripts/selection-origin-allowlist.json` with a reason. An entry with no
 * matching call fails (I15), so the list only shrinks.
 *
 * Usage: node scripts/selection-origin-check.mjs [--self-test]
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
const ROOTS = ["packages/rendering/dom/src", "packages/extensions/undo/src"];
const ALLOWLIST_PATH = path.join(
	REPO_ROOT,
	"scripts/selection-origin-allowlist.json",
);

/** Setter name → the argument count that includes `options`. */
export const SETTER_ARITY = new Map([
	["setSelection", 2],
	["selectBlock", 2],
	["selectBlocks", 2],
	["selectCell", 4],
	["selectCellRange", 4],
	["selectText", 4],
	["selectTextRange", 3],
	["selectAll", 2],
]);

/** Only editor receivers are setters; a scheduler's `setSelection(record)` is not. */
const EDITOR_RECEIVER = /(^|\.)(_?editor|ed)$/;

function listSources(root) {
	return listProductionSources(REPO_ROOT, root, /\.tsx?$/);
}

function enclosingSymbol(node) {
	for (let current = node.parent; current; current = current.parent) {
		if (
			(ts.isFunctionDeclaration(current) ||
				ts.isMethodDeclaration(current) ||
				ts.isGetAccessorDeclaration(current) ||
				ts.isSetAccessorDeclaration(current) ||
				ts.isPropertyDeclaration(current) ||
				ts.isPropertyAssignment(current) ||
				ts.isVariableDeclaration(current)) &&
			current.name &&
			ts.isIdentifier(current.name)
		) {
			return current.name.text;
		}
	}
	return "(module)";
}

/** Setter calls in `source` that pass no options argument. */
export function findOriginlessCalls(file, source) {
	const sourceFile = ts.createSourceFile(
		file,
		source,
		ts.ScriptTarget.Latest,
		true,
	);
	const calls = [];
	const visit = (node) => {
		if (
			ts.isCallExpression(node) &&
			ts.isPropertyAccessExpression(node.expression)
		) {
			const setter = node.expression.name.text;
			const arity = SETTER_ARITY.get(setter);
			const receiver = node.expression.expression.getText(sourceFile);
			if (
				arity !== undefined &&
				EDITOR_RECEIVER.test(receiver) &&
				node.arguments.length < arity
			) {
				const { line } = sourceFile.getLineAndCharacterOfPosition(
					node.getStart(),
				);
				calls.push({
					file,
					symbol: enclosingSymbol(node),
					setter,
					line: line + 1,
				});
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return calls;
}

/** Violations and orphaned allowlist entries for a set of calls. */
export function evaluate(calls, allowlist) {
	const used = new Set();
	const violations = calls.filter((call) => {
		const index = allowlist.findIndex(
			(entry) =>
				entry.file === call.file &&
				entry.symbol === call.symbol &&
				entry.setter === call.setter,
		);
		if (index === -1) return true;
		used.add(index);
		return false;
	});
	const orphaned = allowlist.filter((_, index) => !used.has(index));
	const incomplete = allowlist.filter(
		(entry) =>
			!entry.file || !entry.symbol || !entry.setter || !entry.reason,
	);
	return { violations, orphaned, incomplete };
}

function selfTest() {
	const file = "packages/rendering/dom/src/seeded.ts";
	const calls = findOriginlessCalls(
		file,
		[
			"function a(editor) { editor.selectBlock('x'); }",
			"function b(editor) { editor.selectBlock('x', { origin: 'keyboard' }); }",
			"function c(scheduler) { scheduler.setSelection(record); }",
			"function d(ctx) { ctx.editor.selectText('x', 0, 0); }",
		].join("\n"),
	);
	const failures = [];
	if (calls.length !== 2)
		failures.push(`expected 2 originless calls, found ${calls.length}`);
	const result = evaluate(calls, [
		{ file, symbol: "a", setter: "selectBlock", reason: "seeded" },
		{ file, symbol: "gone", setter: "selectAll", reason: "seeded" },
	]);
	if (result.violations.length !== 1)
		failures.push("an unlisted call must be a violation");
	if (result.orphaned.length !== 1)
		failures.push("an unconsumed entry must be orphaned");
	if (failures.length > 0) {
		console.error(
			`selection-origin-check self-test FAILED:\n  ${failures.join("\n  ")}`,
		);
		process.exit(1);
	}
	console.log(
		"selection-origin-check self-test: an originless call fails, an unconsumed entry fails, a scheduler is not an editor.",
	);
}

function main() {
	if (process.argv.includes("--self-test")) {
		selfTest();
		return;
	}
	const allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8")).entries;
	const calls = ROOTS.flatMap((root) =>
		listSources(root).flatMap((file) =>
			findOriginlessCalls(
				file,
				readFileSync(path.join(REPO_ROOT, file), "utf8"),
			),
		),
	);
	const { violations, orphaned, incomplete } = evaluate(calls, allowlist);
	for (const call of violations) {
		console.error(
			`FAIL ${call.file}:${call.line} ${call.setter} in ${call.symbol} has no origin (S3). Pass { origin } or allowlist it with a reason.`,
		);
	}
	for (const entry of orphaned) {
		console.error(
			`FAIL allowlist entry ${entry.file} ${entry.symbol} ${entry.setter} matches no call (I15).`,
		);
	}
	for (const entry of incomplete) {
		console.error(
			`FAIL allowlist entry needs file, symbol, setter and reason: ${JSON.stringify(entry)}`,
		);
	}
	if (violations.length + orphaned.length + incomplete.length > 0) {
		process.exit(1);
	}
	console.log(
		`OK: ${calls.length} allowlisted originless setter calls; every other setter call names its origin (S3).`,
	);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
	main();
}
