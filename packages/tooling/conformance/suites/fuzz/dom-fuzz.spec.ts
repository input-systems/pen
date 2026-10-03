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
/** The PR fixture; the self-test and the recorded defects run on it. */
const FIXTURE = "fuzz-mixed";
const config = resolveDomFuzzConfig(process.env);

/**
 * A seed that finds a product defect is recorded here, as `knownDefect`
 * (see the README ledger). Each symptom is the shrunk trace's first failure
 * (`PEN_FUZZ_SHRINK=1`), verbatim; the unshrunk seed fails the same check.
 * Seeds 23, 37 and 41 were closed by W3 step 22 (stamped code blocks map
 * text offsets, the pointer path re-projects at pointerup, non-text records
 * complete without a text read-back, unit-block gaps map back, a text record
 * activates its block when the editor owns focus).
 */
const KNOWN_FUZZ_DEFECTS: Readonly<Record<number, KnownDefect>> = {};

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
		`fuzz:dom seeds ${config.seedLabel} × ${config.steps} steps on ${config.fixtures.join(", ")} (${config.actionSet} actions)`,
	);
	for (const fixture of config.fixtures) {
		for (const seed of config.seeds) {
			const suffix = fixture === FIXTURE ? "" : ` (${fixture})`;
			const knownDefect =
				fixture === FIXTURE && config.actionSet === "pr" ? KNOWN_FUZZ_DEFECTS[seed] : undefined;
			scenario(
				`S2/S5/S6: DOM selection fuzz, seed ${seed}${suffix}`,
				async (s, page) => {
					const engine = test.info().project.name;
					const file = traceFilePath(engine, fixture === FIXTURE ? seed : `${fixture}-${seed}`);
					const trace = await runAndReport(
						s,
						page,
						{
							seed,
							engine,
							fixture,
							steps: config.steps,
							forceFailAt: config.forceFailAt,
							actionSet: config.actionSet,
						},
						file,
					);
					expect(
						trace.failure,
						trace.failure ? describeFailure(trace, file) : "",
					).toBeNull();
				},
				{ axe: false, knownDefect },
			);
		}
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
