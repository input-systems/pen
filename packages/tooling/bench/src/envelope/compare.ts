import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { attributeBenchResult, type BenchResult } from "../bench";
import {
	ENVELOPE_DRIFT_FLOOR_MS,
	ENVELOPE_DRIFT_RATIO,
	ENVELOPE_GATE_MIN_SIGNAL_MS,
	ENVELOPE_SAMPLE_SIZE,
	SCALE1_MACHINE_CLASS,
	SCALE1_MEASUREMENTS,
	envelopeGateP50Ms,
	envelopePointIsGated,
	type EnvelopeAxis,
	type EnvelopeRungId,
} from "../constants/scale1";
import { getScale1FixtureAudit } from "../fixtures/audit";
import {
	scale1EnvelopeBenchId,
	scale1EnvelopeFloorId,
} from "../suites/scale1.bench";
import { sameEnvelopeGateClass } from "./machine";

export type EnvelopeFloorKind = "empty-timer" | "empty-sync";
export type EnvelopeStatus = "envelope" | "provisional";

export interface EnvelopePointRecord {
	id: EnvelopeRungId;
	axis: EnvelopeAxis;
	metadataRungId: string | null;
	size: string;
	operation: string;
	count: number;
	countUnit: string;
	opsApplied: number;
	measuredP50Ms: number;
	floorP50Ms: number;
	floorKind: EnvelopeFloorKind;
	attributedP50Ms: number;
	p95Ms: number;
	maxMs: number;
	p95Ratio: number;
	gated: boolean;
	gateP50Ms: number | null;
}

/** One renderer row (W1.R9): a conformance `scale-render` clock, Pen-removed floor beside it. */
export interface EnvelopeRendererRow {
	readonly id: `renderer.${"react" | "vue" | "vanilla"}.${"1k" | "5k" | "10k" | "50k"}`;
	readonly surface: "react" | "vue" | "vanilla";
	readonly rootBlocks: number;
	readonly totalBlocks: number;
	readonly grade: "measured";
	/** `null` when the row timed out or is not recorded yet. */
	readonly mountP50Ms: number | null;
	readonly mountFloorP50Ms: number | null;
	readonly keystrokeToFrameP50Ms: number | null;
	readonly caretDownToFrameP50Ms: number | null;
	readonly mountTimedOut: boolean;
	readonly machineClass: string;
	readonly recordedAt: string;
	readonly source: `@input/pen-conformance baselines/scale-render.${string}.chromium.json`;
}

export interface EnvelopeRecord {
	ruleId: "SCALE1";
	spec: string;
	gateStatistic: "median";
	sampleSize: number;
	machineClass: string;
	producedOn: string;
	floorProducedOn: string;
	status: EnvelopeStatus;
	caveat: string;
	loadTaken: boolean;
	tolerance: {
		ratio: number;
		floorMs: number;
		minSignalMs: number;
		formula: string;
		justification: string;
		crossClass: string;
	};
	points: EnvelopePointRecord[];
	/** Generated from the conformance baselines by `importRenderer.ts`; never hand-edited. */
	renderer: readonly EnvelopeRendererRow[];
}

export interface EnvelopeDriftFailure {
	id: string;
	reason: "missing" | "missing-floor" | "timing" | "count";
	measuredP50Ms: number;
	attributedP50Ms: number;
	committedP50Ms: number;
	gateP50Ms: number;
	measuredCount: number;
	committedCount: number;
}

export interface EnvelopeDriftResult {
	ok: boolean;
	skippedTiming: boolean;
	skipReason: string | null;
	failures: EnvelopeDriftFailure[];
}

export const ENVELOPE_TOLERANCE_JUSTIFICATION =
	"Same-run p95/p50 on the committed macos-arm64 sample (n=21) peaked at 2.38× (100-block). The same-class gate is 3× attributed median for rungs whose attributed p50 is at least 0.5ms. Below that the clock is inside timer noise and a ratio cannot be attributed to Pen. The +1ms term applies only above that signal. P95 and Max are trend-only (CH8).";

export const ENVELOPE_CROSS_CLASS_POLICY =
	"Timing is not compared across machine classes. macos-arm64 medians are not a ubuntu-latest budget; a ratio picked to absorb that gap cannot catch a regression.";

export function envelopeBaselinePath(): string {
	return resolve(
		dirname(fileURLToPath(import.meta.url)),
		"../../baselines/envelope.json",
	);
}

export function envelopeTablePath(): string {
	return resolve(
		dirname(fileURLToPath(import.meta.url)),
		"../../ENVELOPE.md",
	);
}

export interface BuildEnvelopeRecordOptions {
	floorResults?: readonly BenchResult[];
	producedOn?: string;
	floorProducedOn?: string;
	machineClass?: string;
	status?: EnvelopeStatus;
	caveat?: string;
	/** The committed renderer rows, carried across a headless re-record. */
	renderer?: readonly EnvelopeRendererRow[];
}

export function buildEnvelopeRecord(
	results: readonly BenchResult[],
	options: BuildEnvelopeRecordOptions,
): EnvelopeRecord {
	const producedOn =
		options.producedOn ?? new Date().toISOString().slice(0, 10);
	const floorProducedOn = options.floorProducedOn ?? producedOn;
	const points = SCALE1_MEASUREMENTS.map((spec) => {
		const result = results.find(
			(entry) => entry.id === scale1EnvelopeBenchId(spec.id),
		);
		if (!result) {
			throw new Error(`SCALE1 result missing for ${spec.id}`);
		}
		const measuredP50Ms = roundMs(result.p50Ms);
		const floorP50Ms = roundMs(floorP50For(spec.id, result, options.floorResults));
		const attributedP50Ms = roundMs(
			attributeBenchResult({
				...result,
				p50Ms: measuredP50Ms,
				floorP50Ms,
			}),
		);
		const gated = envelopePointIsGated(attributedP50Ms);
		const audit = getScale1FixtureAudit(spec.id);
		if (
			audit.floorKind !== "empty-timer" &&
			audit.floorKind !== "empty-sync"
		) {
			throw new Error(
				`SCALE1 floor kind is not measurable for ${spec.id}`,
			);
		}
		return {
			id: spec.id,
			axis: spec.axis,
			metadataRungId: spec.metadataRungId,
			size: spec.size,
			operation: operationFor(spec.id),
			count: spec.point,
			countUnit: spec.unit,
			opsApplied: 1,
			measuredP50Ms,
			floorP50Ms,
			floorKind: audit.floorKind,
			attributedP50Ms,
			p95Ms: roundMs(result.p95Ms),
			maxMs: roundMs(result.maxMs),
			p95Ratio:
				measuredP50Ms === 0 ? 0 : roundMs(result.p95Ms / result.p50Ms),
			gated,
			gateP50Ms: gated
				? roundMs(envelopeGateP50Ms(attributedP50Ms))
				: null,
		};
	});

	return {
		ruleId: "SCALE1",
		spec: "spec/rules/scale.md",
		gateStatistic: "median",
		sampleSize: ENVELOPE_SAMPLE_SIZE,
		machineClass: options.machineClass ?? SCALE1_MACHINE_CLASS,
		producedOn,
		floorProducedOn,
		status: options.status ?? "envelope",
		caveat: options.caveat ?? "",
		loadTaken: options.status === "provisional",
		tolerance: {
			ratio: ENVELOPE_DRIFT_RATIO,
			floorMs: ENVELOPE_DRIFT_FLOOR_MS,
			minSignalMs: ENVELOPE_GATE_MIN_SIGNAL_MS,
			formula:
				"gated when attributedP50Ms >= 0.5; gateP50Ms = max(attributedP50Ms * 3, attributedP50Ms + 1)",
			justification: ENVELOPE_TOLERANCE_JUSTIFICATION,
			crossClass: ENVELOPE_CROSS_CLASS_POLICY,
		},
		points,
		renderer: options.renderer ?? [],
	};
}

export function compareEnvelopeDrift(
	fresh: EnvelopeRecord,
	committed: EnvelopeRecord,
): EnvelopeDriftResult {
	const failures: EnvelopeDriftFailure[] = [];
	const sameClass = sameEnvelopeGateClass(
		fresh.machineClass,
		committed.machineClass,
	);
	const skippedTiming = !sameClass;
	const skipReason = skippedTiming
		? `machine class ${fresh.machineClass} ≠ ${committed.machineClass}; ${ENVELOPE_CROSS_CLASS_POLICY}`
		: null;

	for (const point of fresh.points) {
		const baseline = committed.points.find(
			(entry) => entry.id === point.id,
		);
		if (!baseline) {
			failures.push({
				id: point.id,
				reason: "missing",
				measuredP50Ms: point.measuredP50Ms,
				attributedP50Ms: point.attributedP50Ms,
				committedP50Ms: Number.NaN,
				gateP50Ms: point.gateP50Ms ?? Number.NaN,
				measuredCount: point.count,
				committedCount: Number.NaN,
			});
			continue;
		}
		if (point.count !== baseline.count) {
			failures.push({
				id: point.id,
				reason: "count",
				measuredP50Ms: point.measuredP50Ms,
				attributedP50Ms: point.attributedP50Ms,
				committedP50Ms: baseline.attributedP50Ms,
				gateP50Ms: baseline.gateP50Ms ?? Number.NaN,
				measuredCount: point.count,
				committedCount: baseline.count,
			});
		}
		if (!hasMeasuredFloor(point) || !hasMeasuredFloor(baseline)) {
			failures.push({
				id: point.id,
				reason: "missing-floor",
				measuredP50Ms: point.measuredP50Ms,
				attributedP50Ms: point.attributedP50Ms,
				committedP50Ms: baseline.measuredP50Ms,
				gateP50Ms: baseline.gateP50Ms ?? Number.NaN,
				measuredCount: point.count,
				committedCount: baseline.count,
			});
			continue;
		}
		if (skippedTiming || !baseline.gated || baseline.gateP50Ms == null) {
			continue;
		}
		if (point.attributedP50Ms > baseline.gateP50Ms) {
			failures.push({
				id: point.id,
				reason: "timing",
				measuredP50Ms: point.measuredP50Ms,
				attributedP50Ms: point.attributedP50Ms,
				committedP50Ms: baseline.attributedP50Ms,
				gateP50Ms: baseline.gateP50Ms,
				measuredCount: point.count,
				committedCount: baseline.count,
			});
		}
	}

	return { ok: failures.length === 0, skippedTiming, skipReason, failures };
}

export function formatEnvelopeDrift(result: EnvelopeDriftResult): string {
	if (result.ok) {
		if (result.skippedTiming && result.skipReason) {
			return `SCALE1 envelope drift: structure ok; timing not compared (${result.skipReason})`;
		}
		return "SCALE1 envelope drift: within tolerance";
	}
	const detail = result.failures
		.map((failure) => {
			if (failure.reason === "missing") {
				return `${failure.id} missing from committed envelope`;
			}
			if (failure.reason === "missing-floor") {
				return `${failure.id} has no harness floor`;
			}
			if (failure.reason === "count") {
				return `${failure.id} count ${failure.measuredCount} !== committed ${failure.committedCount}`;
			}
			return `${failure.id} attributed ${failure.attributedP50Ms.toFixed(2)}ms > gate ${failure.gateP50Ms.toFixed(2)}ms (committed ${failure.committedP50Ms.toFixed(2)}ms)`;
		})
		.join("; ");
	return `SCALE1 envelope drift exceeded tolerance: ${detail}`;
}

export async function loadCommittedEnvelope(
	path = envelopeBaselinePath(),
): Promise<EnvelopeRecord> {
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch (error) {
		const code =
			error && typeof error === "object" && "code" in error
				? String(error.code)
				: "";
		if (code === "ENOENT") {
			throw new Error(`SCALE1 envelope record missing: ${path}`, {
				cause: error,
			});
		}
		throw error;
	}
	const parsed = JSON.parse(raw) as EnvelopeRecord;
	assertEnvelopeRecord(parsed);
	return { ...parsed, renderer: parsed.renderer ?? [] };
}

export async function writeEnvelopeRecord(
	record: EnvelopeRecord,
	path = envelopeBaselinePath(),
): Promise<void> {
	await writeFile(path, `${JSON.stringify(record, null, "\t")}\n`, "utf8");
}

function hasMeasuredFloor(point: EnvelopePointRecord): boolean {
	return (
		typeof point.floorP50Ms === "number" &&
		Number.isFinite(point.floorP50Ms) &&
		typeof point.attributedP50Ms === "number" &&
		Number.isFinite(point.attributedP50Ms)
	);
}

function assertEnvelopeRecord(value: EnvelopeRecord): void {
	if (value.ruleId !== "SCALE1" || !Array.isArray(value.points)) {
		throw new Error("SCALE1 envelope baseline is not a SCALE1 record");
	}
	for (const point of value.points) {
		if (!hasMeasuredFloor(point)) {
			throw new Error(
				`SCALE1 envelope baseline ${point.id} has no harness floor; a wall-clock without a floor is not a measurement`,
			);
		}
		if (
			typeof point.count !== "number" ||
			!Number.isFinite(point.count) ||
			typeof point.opsApplied !== "number"
		) {
			throw new Error(
				`SCALE1 envelope baseline ${point.id} has no fixture count; a row without a count is not a measurement`,
			);
		}
	}
}

function floorP50For(
	id: EnvelopeRungId,
	result: BenchResult,
	floorResults: readonly BenchResult[] | undefined,
): number {
	if (typeof result.floorP50Ms === "number" && Number.isFinite(result.floorP50Ms)) {
		return result.floorP50Ms;
	}
	const floor = floorResults?.find(
		(entry) => entry.id === scale1EnvelopeFloorId(id),
	);
	if (!floor) {
		throw new Error(`SCALE1 harness floor missing for ${id}`);
	}
	return floor.p50Ms;
}

function operationFor(id: EnvelopeRungId): string {
	switch (id) {
		case "table-50x20":
			return "insert-table-cell-text";
		case "concurrentPeers-2":
			return "insert-text + sync";
		case "blocks-100":
		case "blocks-1000":
		case "blocks-5000":
		case "long-block":
		case "nesting-10":
			return "insert-text";
		default: {
			const exhaustive: never = id;
			throw new Error(`Unknown envelope rung: ${exhaustive}`);
		}
	}
}

function roundMs(value: number): number {
	return Math.round(value * 100) / 100;
}
