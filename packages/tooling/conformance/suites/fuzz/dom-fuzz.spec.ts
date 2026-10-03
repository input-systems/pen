import { existsSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { scenario, type KnownDefect } from "../../src/scenario";
import type { ScenarioApi } from "../../src/types";
import {
	runFuzzSession,
	shrinkFailure,
	type FuzzRunOptions,
} from "../../src/fuzz/dom/driver";
import { resolveDomFuzzConfig } from "../../src/fuzz/dom/seed";
import {
	describeFailure,
	readTrace,
	traceFilePath,
	writeTrace,
	type FuzzTrace,
} from "../../src/fuzz/dom/trace";

/**
 * DOM selection fuzz (W3.R19, `spec/rules/selection.md` S2/S5/S6). The PR
 * job is these four fixed seeds × 40 steps on `fuzz-mixed`; `fuzz:dom`
 * (`src/fuzz/dom/run.mjs`) sets the env for a chosen seed, the nightly soak,
 * or a trace replay.
 */
const FIXTURE = "fuzz-mixed";
const config = resolveDomFuzzConfig(process.env);

/**
 * A seed that finds a product defect is recorded here, as `knownDefect`
 * (see the README ledger). Each symptom is the shrunk trace's first failure
 * (`PEN_FUZZ_SHRINK=1`), verbatim; the unshrunk seed fails the same check.
 */
const KNOWN_FUZZ_DEFECTS: Readonly<Record<number, KnownDefect>> = {
	11: {
		rule: "S2",
		route: "pen-dom reader/caret: code block's structural role vs text authority (W3 lead; W3.R10)",
		symptom:
			"click fuzz-list-3@6, Shift+ArrowDown → authority focus fuzz-code@7, DOM focus fuzz-code@1: DOM selection is not equivalent to editor.selection",
	},
	23: {
		rule: "S2",
		route: "pen-dom projector on the expanded surface (W3 lead; W3.R1)",
		symptom:
			"drag fuzz-zwj@5 → fuzz-after-divider@12 across the divider → selection-projection-mismatch ×2 (trigger selection-change, then divergence; surface expanded)",
	},
	37: {
		rule: "S2",
		route: "pen-dom pointer path, drag out of a code block (W3 lead; W3.R12)",
		symptom:
			"drag fuzz-code@21 → fuzz-list-3@3 (upward) → authority fuzz-code@1..fuzz-list-3@3, DOM fuzz-code@1..fuzz-code@0: DOM selection is not equivalent to editor.selection",
	},
	41: {
		rule: "S2",
		route: "undo restoring a null selection: focus and projection (W3 lead; W3.R16)",
		symptom:
			"Mod-z right after load undoes a load-time commit (fuzz-title, fuzz-image, fuzz-list-1, fuzz-list-3) → selection null, focus on BODY, selection-projection-mismatch (version 2, trigger selection-change, surface text)",
	},
};

/**
 * The self-test plants an S2 violation at this step, on a seed whose earlier
 * steps hold on Chromium and WebKit, independent of `PEN_FUZZ_SEED`.
 */
const SELF_TEST_FAIL_AT = 3;
const SELF_TEST_SEED = 11;

function stepTimeout(steps: number): number {
	return Math.max(30_000, steps * 1_500);
}

async function attachTrace(
	name: string,
	file: string,
	trace: FuzzTrace,
): Promise<void> {
	writeTrace(file, trace);
	await test
		.info()
		.attach(name, { path: file, contentType: "application/json" });
}

async function runAndReport(
	s: ScenarioApi,
	page: Page,
	options: FuzzRunOptions,
	file: string,
): Promise<FuzzTrace> {
	const steps = options.replay?.length ?? options.steps;
	test.setTimeout(
		config.shrink ? stepTimeout(steps) * (steps + 1) : stepTimeout(steps),
	);
	const trace = await runFuzzSession(s, page, options);
	if (!trace.failure) {
		return trace;
	}
	await attachTrace("fuzz-dom-trace", file, trace);
	if (config.shrink) {
		const shrunk = await shrinkFailure(s, page, trace);
		await attachTrace(
			"fuzz-dom-trace-shrunk",
			file.replace(/\.json$/, ".min.json"),
			shrunk,
		);
	}
	return trace;
}

if (config.replayPath) {
	const replayPath = config.replayPath;
	scenario(
		`fuzz:dom replay ${replayPath}`,
		async (s, page) => {
			const recorded = readTrace(replayPath);
			const engine = test.info().project.name;
			const trace = await runAndReport(
				s,
				page,
				{
					...recorded,
					engine,
					steps: recorded.steps.length,
					replay: recorded.steps,
				},
				traceFilePath(engine, `replay-${recorded.seed}`),
			);
			console.log(
				`fuzz:dom replay of ${replayPath}: recorded ${JSON.stringify(recorded.failure)}`,
			);
			expect(
				trace.failure,
				trace.failure ? describeFailure(trace, replayPath) : "",
			).toBeNull();
		},
		{ axe: false },
	);
} else {
	console.log(
		`fuzz:dom seeds ${config.seedLabel} × ${config.steps} steps on ${FIXTURE}`,
	);
	for (const seed of config.seeds) {
		scenario(
			`S2/S5/S6: DOM selection fuzz, seed ${seed}`,
			async (s, page) => {
				const engine = test.info().project.name;
				const file = traceFilePath(engine, seed);
				const trace = await runAndReport(
					s,
					page,
					{
						seed,
						engine,
						fixture: FIXTURE,
						steps: config.steps,
						forceFailAt: config.forceFailAt,
					},
					file,
				);
				expect(
					trace.failure,
					trace.failure ? describeFailure(trace, file) : "",
				).toBeNull();
			},
			{ axe: false, knownDefect: KNOWN_FUZZ_DEFECTS[seed] },
		);
	}

	scenario(
		"fuzz:dom self-test: a forced S2 violation at step k fails with a replayable trace",
		async (s, page) => {
			const engine = test.info().project.name;
			const file = traceFilePath(engine, "self-test");
			const options = {
				seed: SELF_TEST_SEED,
				engine,
				fixture: FIXTURE,
				steps: SELF_TEST_FAIL_AT + 2,
				forceFailAt: SELF_TEST_FAIL_AT,
			};
			const planted = await runAndReport(s, page, options, file);
			expect(
				planted.failure,
				"the planted violation fails S2 at its step",
			).toMatchObject({
				step: SELF_TEST_FAIL_AT,
				check: "S2",
			});
			expect(existsSync(file), `the trace is written to ${file}`).toBe(
				true,
			);

			const recorded = readTrace(file);
			const replayed = await runFuzzSession(s, page, {
				...options,
				replay: recorded.steps,
			});
			expect(
				replayed.failure,
				"replaying the trace reproduces the failure",
			).toMatchObject({
				step: SELF_TEST_FAIL_AT,
				check: "S2",
			});
			expect(replayed.steps).toEqual(recorded.steps);
		},
		{ axe: false },
	);
}
