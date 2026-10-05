import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ScanCounts } from "@input/pen-test";
import type { EnvelopeLoadSnapshot } from "../envelope/machine";
import type { Scale3RealisticBlockCount } from "./scale3Realistic";

/**
 * Committed counts for the SCALE3 realistic variant. Counts are gated
 * exactly; `clocks` is written by `bench:scale3:realistic` and never compared
 * (CH8).
 */

export type Scale3RealisticPointId = `scale3.realistic.keystroke.${Scale3RealisticBlockCount}`;

export interface Scale3RealisticPoint {
	readonly id: Scale3RealisticPointId;
	readonly blockCount: Scale3RealisticBlockCount;
	readonly stagedSuggestions: number;
	readonly searchMatches: number;
	/** From `createScanProbe`, one keystroke after the warm-ups. */
	readonly counts: ScanCounts;
}

export interface Scale3RealisticClock {
	readonly id: Scale3RealisticPointId;
	readonly samples: number;
	readonly p50Ms: number;
}

export interface Scale3RealisticCountsBaseline {
	readonly schemaVersion: 1;
	readonly rule: "SCALE3";
	readonly producedOn: string;
	readonly points: readonly Scale3RealisticPoint[];
	readonly clocks?: {
		readonly producedOn: string;
		readonly machine: string;
		readonly load: EnvelopeLoadSnapshot;
		readonly points: readonly Scale3RealisticClock[];
	};
	readonly history: readonly {
		readonly date: string;
		readonly reason: string;
		readonly moved: readonly string[];
	}[];
}

export const SCALE3_REALISTIC_BASELINE_PATH = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../baselines/scale3-realistic.counts.json",
);

export function scale3RealisticPointId(
	blockCount: Scale3RealisticBlockCount,
): Scale3RealisticPointId {
	return `scale3.realistic.keystroke.${blockCount}`;
}

export function loadScale3RealisticBaseline(
	path = SCALE3_REALISTIC_BASELINE_PATH,
): Scale3RealisticCountsBaseline | null {
	return existsSync(path)
		? (JSON.parse(readFileSync(path, "utf8")) as Scale3RealisticCountsBaseline)
		: null;
}

/** Failures by point id and counter name; a missing or empty baseline fails by name. */
export function compareScale3RealisticPoints(
	baseline: Scale3RealisticCountsBaseline | null,
	measured: readonly Scale3RealisticPoint[],
): string[] {
	if (!baseline) return ["SCALE3_REALISTIC_BASELINE_MISSING scale3-realistic.counts.json"];
	if (baseline.points.length === 0) return ["SCALE3_REALISTIC_BASELINE_EMPTY"];
	const committed = new Map(baseline.points.map((point) => [point.id, point]));
	return measured.flatMap((point) => {
		const expected = committed.get(point.id);
		if (!expected) return [`${point.id}: not in the baseline — re-record`];
		return (Object.keys(point.counts) as (keyof ScanCounts)[])
			.filter((counter) => point.counts[counter] !== expected.counts[counter])
			.map(
				(counter) =>
					`${point.id}/${counter}: ${point.counts[counter]} !== ${expected.counts[counter]}`,
			);
	});
}

function today(): string {
	return new Date().toISOString().slice(0, 10);
}

export function writeScale3RealisticCounts(
	points: readonly Scale3RealisticPoint[],
	reason: string,
	path = SCALE3_REALISTIC_BASELINE_PATH,
): void {
	const previous = loadScale3RealisticBaseline(path);
	const moved = previous ? compareScale3RealisticPoints(previous, points) : ["initial record"];
	const baseline: Scale3RealisticCountsBaseline = {
		schemaVersion: 1,
		rule: "SCALE3",
		producedOn: today(),
		points,
		...(previous?.clocks ? { clocks: previous.clocks } : {}),
		history: [...(previous?.history ?? []), { date: today(), reason, moved }],
	};
	writeFileSync(path, `${JSON.stringify(baseline, null, "\t")}\n`);
}

export function writeScale3RealisticClocks(
	clocks: NonNullable<Scale3RealisticCountsBaseline["clocks"]>,
	path = SCALE3_REALISTIC_BASELINE_PATH,
): void {
	const previous = loadScale3RealisticBaseline(path);
	if (!previous) throw new Error("record the counts before the clocks");
	writeFileSync(path, `${JSON.stringify({ ...previous, clocks }, null, "\t")}\n`);
}
