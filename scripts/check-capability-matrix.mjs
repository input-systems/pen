#!/usr/bin/env node
/**
 * GATE 5.3 / HB1: the capability matrix says something falsifiable.
 *
 * A matrix is only worth writing if a cell cannot quietly become a wish. This
 * walks `packages/docs/CAPABILITY-MATRIX.md` and holds every cell to the rules
 * HB1 and HB5 state:
 *
 * - the status is one of four words, so "mostly works" cannot appear;
 * - a cell that claims reach (`supported`, `bring-your-own-ui`) names a path,
 *   and that path exists — the failure mode being a cell that cites a test
 *   someone later renamed;
 * - at least one of those paths is a test, a conformance spec, or an example,
 *   so a cell cannot rest on a document that only says the capability works;
 * - no claim rests on `playground/`, because the playground is the one host
 *   whose wiring proves nothing about the others (HB5);
 * - the surface columns are exactly the four declared surfaces, in order, so a
 *   row cannot drop a column and read as if it had answered.
 *
 * It deliberately does not check that a `not-supported` cell has no path: those
 * cells carry prose explaining what to use instead, and naming a file there is
 * help, not a claim.
 *
 * `--self-test` checks an in-memory matrix whose claiming cell cites only a
 * document and expects it to fail, then checks the real matrix passes. Tests:
 * scripts/__tests__/capabilityMatrix.test.mjs (`node --test`).
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const matrixPath = join(repoRoot, "packages/docs/CAPABILITY-MATRIX.md");

const SURFACES = ["React", "Vue", "Vanilla", "Headless"];
const STATUSES = new Set([
	"supported",
	"bring-your-own-ui",
	"not-supported",
	"planned",
]);
/** The statuses that assert the capability reaches the surface. */
const CLAIMING = new Set(["supported", "bring-your-own-ui"]);

/** A repo-relative path in prose: a slashed path ending in a real extension. */
const PATH_RE = /\b(?:packages|playground|examples|scripts|spec)\/[\w./-]*[\w-]\.(?:ts|tsx|mts|mjs|js|jsx|vue|md|json|css)\b/g;

/**
 * HB5: a claim rests on something that runs. A path counts as evidence when it
 * is an example or a test / conformance spec; a document (`STYLING.md`, a
 * README) can explain a cell but cannot prove one.
 */
const EVIDENCE_RE = /(^examples\/)|\.(test|spec)\.(ts|tsx|js|mjs)$/;

const EVIDENCE_FAILURE = "must name a test, conformance spec, or example (HB5)";

const DELIMITER_CELL_RE = /^:?-+:?$/;

/** ` | ` splits cells, but a cell's prose may contain a pipe in code. */
function splitRow(line) {
	return line
		.replace(/^\s*\|/, "")
		.replace(/\|\s*$/, "")
		.split("|")
		.map((cell) => cell.trim());
}

function isCapabilityTableHeader(cells) {
	return (
		cells.length === SURFACES.length + 1 &&
		SURFACES.every((surface, index) => cells[index + 1] === surface)
	);
}

/**
 * Classifies one line: prose (ends a table), a capability header, a line to
 * skip (the delimiter, or a row of some other table), or a row to check.
 */
function classifyLine(line, inTable) {
	if (!line.trimStart().startsWith("|")) {
		return { kind: "prose" };
	}
	const cells = splitRow(line);
	if (isCapabilityTableHeader(cells)) {
		return { kind: "header" };
	}
	return { kind: isCapabilityRow(cells, inTable) ? "row" : "skip", cells };
}

/** A row inside a capability table that is not the delimiter under its header. */
function isCapabilityRow(cells, inTable) {
	return inTable && !cells.every((cell) => DELIMITER_CELL_RE.test(cell));
}

/** Failures for one named path: the playground ban and existence. */
function onePathFailures(path, where, pathExists) {
	const failures = [];
	if (path.startsWith("playground/")) {
		failures.push(
			`${where}: names ${path}; the playground is the reference host, not the proof (HB5)`,
		);
	}
	if (!pathExists(path)) {
		failures.push(`${where}: names ${path}, which does not exist`);
	}
	return failures;
}

/** Failures for the paths a claiming cell names, including naming none. */
function pathFailures(paths, where, status, pathExists) {
	if (paths.length === 0) {
		return [
			`${where}: \`${status}\` claims the capability reaches this surface but names no path proving it`,
		];
	}
	const failures = paths.flatMap((path) => onePathFailures(path, where, pathExists));
	if (!paths.some((path) => EVIDENCE_RE.test(path))) {
		failures.push(
			`${where}: \`${status}\` names only ${paths.join(", ")}; a claiming cell ${EVIDENCE_FAILURE}`,
		);
	}
	return failures;
}

/** The failure for a cell whose opening status is missing or unknown, else null. */
function statusFailure(status, where) {
	if (!status) {
		return `${where}: cell does not open with a \`status\``;
	}
	if (!STATUSES.has(status)) {
		return `${where}: status \`${status}\` is outside the vocabulary (${[...STATUSES].join(", ")})`;
	}
	return null;
}

function cellPaths(cell) {
	return cell.match(PATH_RE) ?? [];
}

/** Checks one cell: `{ claimed, failures }`. */
function checkCell(cell, where, pathExists) {
	const status = cell.match(/^`([^`]+)`/)?.[1];
	const invalid = statusFailure(status, where);
	if (invalid) {
		return { claimed: false, failures: [invalid] };
	}
	if (!CLAIMING.has(status)) {
		return { claimed: false, failures: [] };
	}
	return { claimed: true, failures: pathFailures(cellPaths(cell), where, status, pathExists) };
}

/** Checks one capability row's surface cells into `result`. */
function checkRow(cells, lineNumber, pathExists, result) {
	if (cells.length !== SURFACES.length + 1) {
		result.failures.push(
			`line ${lineNumber}: capability row has ${cells.length} cells, expected ${
				SURFACES.length + 1
			} (capability plus ${SURFACES.length} surfaces)`,
		);
		return;
	}
	result.capabilityRows += 1;
	SURFACES.forEach((surface, surfaceIndex) => {
		const where = `"${cells[0]}" × ${surface} (line ${lineNumber})`;
		const cell = checkCell(cells[surfaceIndex + 1], where, pathExists);
		result.claims += cell.claimed ? 1 : 0;
		result.failures.push(...cell.failures);
	});
}

/**
 * Walks one matrix source and returns every failure. `pathExists` is injected
 * so the self-test can check an in-memory matrix without touching the tree.
 */
export function checkMatrix(source, pathExists) {
	const result = { failures: [], capabilityRows: 0, claims: 0 };
	let inTable = false;
	source.split("\n").forEach((line, index) => {
		const classified = classifyLine(line, inTable);
		inTable = classified.kind !== "prose" && (inTable || classified.kind === "header");
		if (classified.kind === "row") {
			checkRow(classified.cells, index + 1, pathExists, result);
		}
	});
	if (result.capabilityRows === 0) {
		result.failures.push(
			"found no capability rows; the surface header must read exactly: | Capability | React | Vue | Vanilla | Headless |",
		);
	}
	return result;
}

export function existsInRepo(path) {
	return existsSync(join(repoRoot, path));
}

export function readRepoMatrix() {
	return readFileSync(matrixPath, "utf8");
}

const SELF_TEST_HEADER =
	"| Capability | React | Vue | Vanilla | Headless |\n| --- | --- | --- | --- | --- |";

/** An in-memory matrix whose one claiming Vue cell cites `vueCell`. */
export function selfTestMatrix(vueCell) {
	return `${SELF_TEST_HEADER}\n| Overlays | \`supported\` — \`examples/react/src/App.tsx\` | \`bring-your-own-ui\` — ${vueCell} | \`not-supported\` — layout | \`not-supported\` — layout |`;
}

/**
 * HB5: a claiming cell that names only a document fails the matrix check, the
 * same cell with a spec beside the document passes, and the real matrix
 * passes. Returns the unmet expectations; empty means the self-test passed.
 */
export function runSelfTests() {
	return SELF_TESTS.filter(([, passes]) => !passes()).map(([expectation]) => expectation);
}

const SELF_TESTS = [
	[
		"a claiming cell that names only a document must fail",
		() => {
			const { failures } = checkMatrix(
				selfTestMatrix("`packages/rendering/vue/STYLING.md`"),
				() => true,
			);
			return failures.length === 1 && failures[0].includes(EVIDENCE_FAILURE);
		},
	],
	[
		"a cell naming a spec next to a document must pass",
		() =>
			checkMatrix(
				selfTestMatrix(
					"`packages/rendering/vue/STYLING.md` and `packages/tooling/conformance/suites/overlays/o1.spec.ts`",
				),
				() => true,
			).failures.length === 0,
	],
	[
		"the real matrix must pass",
		() => checkMatrix(readRepoMatrix(), existsInRepo).failures.length === 0,
	],
];

function report({ failures, capabilityRows, claims }) {
	if (failures.length > 0) {
		console.error(`FAIL capability matrix (${failures.length}):`);
		for (const failure of failures) {
			console.error(`  ${failure}`);
		}
		process.exit(1);
	}
	console.log(
		`OK capability matrix: ${capabilityRows} capabilities × ${SURFACES.length} surfaces, ${claims} claims each naming an existing non-playground test, spec, or example`,
	);
}

function reportSelfTests(problems) {
	if (problems.length > 0) {
		console.error(`FAIL capability matrix self-test: ${problems.join("; ")}`);
		process.exit(1);
	}
	console.log(
		"OK capability matrix self-test: HB5: a claiming cell that names only a document fails the matrix check",
	);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	if (process.argv.includes("--self-test")) {
		reportSelfTests(runSelfTests());
	} else {
		report(checkMatrix(readRepoMatrix(), existsInRepo));
	}
}
