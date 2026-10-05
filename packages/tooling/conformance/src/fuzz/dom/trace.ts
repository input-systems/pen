import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DomAuthorityCheck, SerializedSelectionRecord } from "../../types";
import type { FuzzStep } from "./actions";
import type { FuzzCheckName } from "./invariants";

/**
 * The DOM fuzzer's replayable trace (W3.R19 §3.15). A failing seed writes
 * `test-results/fuzz-dom/<engine>-<seed>.json`; `PEN_FUZZ_REPLAY` re-executes
 * its steps verbatim, with no generator involved.
 */
export type FuzzFailure = {
	/** Step index, or -1 for the check before the first step. */
	step: number;
	check: FuzzCheckName;
	details: unknown;
};

export type FuzzDomSnapshot = {
	activeElement: string;
	nativeSelection: string;
	s2: DomAuthorityCheck | null;
};

export type FuzzTrace = {
	seed: number;
	engine: string;
	fixture: string;
	opCount: number;
	forceFailAt: number | null;
	steps: FuzzStep[];
	failure: FuzzFailure | null;
	record: SerializedSelectionRecord | null;
	dom: FuzzDomSnapshot | null;
};

const CONFORMANCE_DIR = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../..",
);

export function traceFilePath(engine: string, name: string | number): string {
	return path.join(
		CONFORMANCE_DIR,
		"test-results",
		"fuzz-dom",
		`${engine}-${name}.json`,
	);
}

export function writeTrace(file: string, trace: FuzzTrace): void {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, `${JSON.stringify(trace, null, "\t")}\n`);
}

export function readTrace(file: string): FuzzTrace {
	const trace = JSON.parse(readFileSync(file, "utf8")) as FuzzTrace;
	if (!Array.isArray(trace.steps) || typeof trace.fixture !== "string") {
		throw new Error(`fuzz:dom replay: ${file} is not a fuzz trace`);
	}
	return trace;
}

function replayCommand(file: string, engine: string): string {
	return `PEN_FUZZ_REPLAY=${file} pnpm --filter @input/pen-conformance run fuzz:dom -- --project ${engine}`;
}

export function describeFailure(trace: FuzzTrace, file: string): string {
	const failure = trace.failure;
	const where = failure
		? `step ${failure.step} (${failure.check})`
		: "no failure";
	return [
		`fuzz:dom seed ${trace.seed} on ${trace.engine} failed at ${where}.`,
		`Trace: ${file}`,
		`Replay: ${replayCommand(file, trace.engine)}`,
		`Details: ${JSON.stringify(failure?.details ?? null)}`,
	].join("\n");
}
