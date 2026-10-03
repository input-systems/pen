import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	evaluateBenchResult,
	getCriticalBenchFailures,
} from "../bench";
import type { BenchResult } from "../bench";
import {
	SCALE3_KEYSTROKE_DECORATION_COUNT_256_BENCH,
	SCALE3_KEYSTROKE_DOCUMENT_SIZE_100_BENCH,
	SCALE3_KEYSTROKE_DOCUMENT_SIZE_1000_BENCH,
	SCALE3_KEYSTROKE_EXTENSION_COUNT_PLUS8_BENCH,
	SCALE3_KEYSTROKE_REMOTE_CARET_COUNT_8_BENCH,
} from "../constants/benchmarks";
import {
	SCALE2_PLUS8_BASE_ID,
	SCALE2_PLUS8_ID,
	SCALE2_PLUS8_TOLERANCE_FLOOR_MS,
	SCALE2_PLUS8_TOLERANCE_RATIO,
	SCALE3_AXES,
	SCALE3_AXIS_BENCHES,
	SCALE3_BASELINES,
	SCALE3_MACHINE_CLASS,
	SCALE3_DECORATION_COUNT_POINTS,
	SCALE3_EXTENSION_COUNT_POINTS,
	SCALE3_REMOTE_CARET_COUNT_POINTS,
	SCALE3_PLUS_EXTENSIONS,
	SCALE3_SHIPPED_STACK,
	compareScale2Plus8Tolerance,
	formatScale2Plus8Tolerance,
	getScale3Baseline,
	scale2Plus8GateMs,
} from "../constants/scale3";
import {
	countScale3RemoteCarets,
	createScale3Editor,
	createScale3Extensions,
	scale3KeystrokeTarget,
} from "../fixtures/scale3Stack";
import {
	assertScale2Plus8Tolerance,
	createBenchSuites,
	loadBenchWaivers,
	resolvePackageWaiverFilePath,
} from "../run";
import { scale3Benchmarks } from "../suites/scale3.bench";

function slowedScale3Result(id: string, p50Ms: number): BenchResult {
	const baseline = getScale3Baseline(id);
	return {
		id,
		name: id,
		iterations: 50,
		totalMs: p50Ms * 50,
		averageMs: p50Ms,
		minMs: p50Ms,
		maxMs: p50Ms,
		p50Ms,
		p95Ms: p50Ms,
		opsPerSecond: 1000 / p50Ms,
		targetMs: baseline.gateP50Ms,
		isCritical: true,
	};
}

describe("SCALE3 realistic-stack keystroke", () => {
	it("SCALE3: names every bench and covers each declared axis at two points", () => {
		expect(scale3Benchmarks.every((bench) => bench.name.includes("SCALE3"))).toBe(
			true,
		);
		expect(SCALE3_AXES.map((spec) => spec.axis)).toEqual([
			"document-size",
			"extension-count",
			"decoration-count",
			"remote-caret-count",
			"synced-peer-count",
		]);
		for (const spec of SCALE3_AXES) {
			expect(spec.points.length).toBeGreaterThanOrEqual(2);
			expect(new Set(spec.points).size).toBe(spec.points.length);
		}

		const ids = scale3Benchmarks.map((bench) => bench.id);
		expect(ids).toEqual(SCALE3_BASELINES.map((baseline) => baseline.id));
		expect(ids).toContain(SCALE3_KEYSTROKE_DOCUMENT_SIZE_100_BENCH.id);
		expect(ids).toContain(SCALE3_KEYSTROKE_DOCUMENT_SIZE_1000_BENCH.id);
		expect(ids).toContain(SCALE3_KEYSTROKE_EXTENSION_COUNT_PLUS8_BENCH.id);
		expect(ids).toContain(SCALE3_KEYSTROKE_DECORATION_COUNT_256_BENCH.id);
		expect(ids).toContain(SCALE3_KEYSTROKE_REMOTE_CARET_COUNT_8_BENCH.id);

		expect(scale3Benchmarks.every((bench) => bench.axis != null)).toBe(true);
		expect(SCALE3_AXIS_BENCHES["document-size"]).toEqual([
			SCALE3_KEYSTROKE_DOCUMENT_SIZE_100_BENCH.id,
			SCALE3_KEYSTROKE_DOCUMENT_SIZE_1000_BENCH.id,
		]);
		expect(SCALE3_AXIS_BENCHES["extension-count"][1]).toBe(
			SCALE3_KEYSTROKE_EXTENSION_COUNT_PLUS8_BENCH.id,
		);
		expect(SCALE3_AXIS_BENCHES["decoration-count"][1]).toBe(
			SCALE3_KEYSTROKE_DECORATION_COUNT_256_BENCH.id,
		);
		expect(SCALE3_AXIS_BENCHES["remote-caret-count"][1]).toBe(
			SCALE3_KEYSTROKE_REMOTE_CARET_COUNT_8_BENCH.id,
		);
		// The synced-peer axis is count-gated (scale3.peers.test.ts), not a clock bench.
		expect(SCALE3_AXIS_BENCHES["synced-peer-count"]).toEqual([
			"scale3.keystroke.synced-peers.2",
			"scale3.keystroke.synced-peers.4",
			"scale3.keystroke.synced-peers.8",
		]);
	});

	it("SCALE3: older suites do not declare an axis they cannot vary", () => {
		const suites = createBenchSuites();
		for (const suite of suites) {
			if (suite.name === "SCALE3") {
				continue;
			}
			for (const bench of suite.benchmarks) {
				expect(bench.axis, suite.name).toBeUndefined();
			}
		}
	});

	it("SCALE3: documents the shipped stack as default preset plus no-op extras", () => {
		expect(SCALE3_SHIPPED_STACK).toEqual([
			"tools",
			"delta-stream",
			"undo",
			"rich-text-shortcuts",
			...SCALE3_PLUS_EXTENSIONS,
		]);
		expect(SCALE3_PLUS_EXTENSIONS).toEqual([
			"ai",
			"ai-suggestions",
			"ai-autocomplete",
			"search",
			"multiplayer",
		]);
	});

	it("SCALE3: JSON baselines stay aligned with the committed constants", async () => {
		const baselineFile = resolve(
			dirname(fileURLToPath(import.meta.url)),
			"../../baselines/scale3.json",
		);
		const document = JSON.parse(await readFile(baselineFile, "utf8")) as {
			machineClass: string;
			baselines: Array<{
				id: string;
				measuredP50Ms: number;
				gateP50Ms: number;
			}>;
		};

		expect(document.machineClass).toBe(SCALE3_MACHINE_CLASS);
		expect(document.baselines.map((entry) => entry.id)).toEqual(
			SCALE3_BASELINES.map((entry) => entry.id),
		);
		for (const baseline of SCALE3_BASELINES) {
			const json = document.baselines.find((entry) => entry.id === baseline.id);
			expect(json?.measuredP50Ms).toBe(baseline.measuredP50Ms);
			expect(json?.gateP50Ms).toBe(baseline.gateP50Ms);
		}
	});

	it("SCALE3: commits a baseline per bench with a machine-class note", () => {
		expect(SCALE3_MACHINE_CLASS).toMatch(/macos-arm64/);
		expect(SCALE3_MACHINE_CLASS).toMatch(/github-actions-ubuntu-latest/);

		for (const bench of scale3Benchmarks) {
			const baseline = getScale3Baseline(bench.id ?? "");
			expect(baseline.gateP50Ms).toBeGreaterThanOrEqual(baseline.measuredP50Ms);
			expect(baseline.machineClass).toBe(SCALE3_MACHINE_CLASS);
			expect(bench.targetMs).toBe(baseline.gateP50Ms);
			expect(bench.critical).toBe(true);
		}
	});

	it("SCALE3: applies one user keystroke on the envelope-sized stack", () => {
		const editor = createScale3Editor({ blockCount: 100 });
		const blockId = scale3KeystrokeTarget(100);
		const before = editor.getBlock(blockId).textContent().length;

		editor.apply(
			[{ type: "splice-text", blockId, from: 0,
				to: 0,
				insert: "x" }],
			{ origin: "user" },
		);

		expect(editor.getBlock(blockId).textContent().length).toBe(before + 1);
		expect(editor.document.blockOrder.length).toBe(100);
		void editor.destroy();
	});

	it("SCALE3: remote-caret-count.8 is eight caret decorations on one document", () => {
		const editor = createScale3Editor({
			blockCount: 100,
			remoteCaretCount: SCALE3_REMOTE_CARET_COUNT_POINTS[1],
		});
		expect(countScale3RemoteCarets(editor)).toBe(8);
		expect(editor.document.blockOrder.length).toBe(100);
		void editor.destroy();
	});

	it("SCALE3: decoration-count.256 and plus8 are counts, not clocks", () => {
		const editor = createScale3Editor({
			blockCount: 1000,
			decorationCount: SCALE3_DECORATION_COUNT_POINTS[1],
		});
		editor.requestDecorationUpdate();
		const marks = editor.getDecorations().decorations.filter(
			(decoration) =>
				decoration.type === "inline" &&
				decoration.attributes["data-pen-scale3-decoration"] === true,
		);
		expect(marks).toHaveLength(256);
		void editor.destroy();

		expect(
			createScale3Extensions({
				blockCount: 1000,
				extraDecoratingExtensions: 8,
			}),
		).toHaveLength(SCALE3_PLUS_EXTENSIONS.length + 8);
		expect(SCALE3_EXTENSION_COUNT_POINTS[1]).toBe(
			SCALE3_SHIPPED_STACK.length + 8,
		);
	});

	it("SCALE3: a deliberately slowed keystroke fails the committed baseline comparison", () => {
		const id = "scale3.keystroke.realistic-stack.document-size.1000";
		expect(SCALE3_KEYSTROKE_DOCUMENT_SIZE_1000_BENCH.id).toBe(id);
		const baseline = getScale3Baseline(id);
		const slowed = slowedScale3Result(id, baseline.gateP50Ms + 1);

		expect(evaluateBenchResult(slowed).meetsTarget).toBe(false);
		expect(getCriticalBenchFailures([slowed])).toEqual([slowed]);
	});

	it("SCALE3: a median at the committed gate still passes", () => {
		const id = "scale3.keystroke.realistic-stack.document-size.1000";
		const baseline = getScale3Baseline(id);
		const atGate = slowedScale3Result(id, baseline.gateP50Ms);

		expect(evaluateBenchResult(atGate).meetsTarget).toBe(true);
		expect(getCriticalBenchFailures([atGate])).toEqual([]);
	});

	it("SCALE2: eight no-op decorating extensions stay within the same-run tolerance", () => {
		expect(SCALE2_PLUS8_BASE_ID).toBe(
			"scale3.keystroke.realistic-stack.document-size.1000",
		);
		expect(SCALE2_PLUS8_ID).toBe(
			"scale3.keystroke.realistic-stack.extension-count.plus8",
		);
		expect(SCALE2_PLUS8_TOLERANCE_RATIO).toBe(2);
		expect(SCALE2_PLUS8_TOLERANCE_FLOOR_MS).toBe(15);
		expect(scale2Plus8GateMs(3.76)).toBe(18.76);

		const base = getScale3Baseline(SCALE2_PLUS8_BASE_ID);
		const plus8 = getScale3Baseline(SCALE2_PLUS8_ID);
		const committed = compareScale2Plus8Tolerance(
			plus8.measuredP50Ms,
			base.measuredP50Ms,
		);
		expect(committed.ok).toBe(true);
		expect(formatScale2Plus8Tolerance(committed)).toMatch(/within tolerance/);

		assertScale2Plus8Tolerance([
			slowedScale3Result(SCALE2_PLUS8_BASE_ID, base.measuredP50Ms),
			slowedScale3Result(SCALE2_PLUS8_ID, committed.gateP50Ms),
		]);

		const over = compareScale2Plus8Tolerance(
			committed.gateP50Ms + 0.01,
			base.measuredP50Ms,
		);
		expect(over.ok).toBe(false);
		expect(formatScale2Plus8Tolerance(over)).toMatch(/plus8/);
		expect(() =>
			assertScale2Plus8Tolerance([
				slowedScale3Result(SCALE2_PLUS8_BASE_ID, base.measuredP50Ms),
				slowedScale3Result(SCALE2_PLUS8_ID, committed.gateP50Ms + 0.01),
			]),
		).toThrow(/SCALE2 plus8 decorating extensions exceeded tolerance/);
	});

	it("SCALE3: waiver file is committed in the bench package", async () => {
		const waiverFile = await resolvePackageWaiverFilePath();
		expect(waiverFile).toBeDefined();

		const expected = resolve(
			dirname(fileURLToPath(import.meta.url)),
			"../../spec/benchWaivers.json",
		);
		await access(expected);
		expect(waiverFile).toBe(expected);
		await expect(loadBenchWaivers(expected)).resolves.toEqual([]);
	});
});
