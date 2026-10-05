import { mixedFixtureIdentity } from "@input/pen-test";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	loadCommittedEnvelope,
	writeEnvelopeRecord,
	type EnvelopeRendererRow,
} from "./compare";

/**
 * W1.R9: the ENVELOPE renderer rows are generated from the conformance
 * `scale-render` baselines' `clocks` (and the large runs' timeouts), never
 * edited by hand. `--check` fails when `baselines/envelope.json` disagrees
 * with them, so neither file can move alone.
 */

const SURFACES = ["react", "vue", "vanilla"] as const;
const SIZES = [
	{ size: "1k", fixture: "scale-1k", rootBlocks: 1_000 },
	{ size: "5k", fixture: "scale-5k", rootBlocks: 5_000 },
	{ size: "10k", fixture: "scale-10k", rootBlocks: 10_000 },
	{ size: "50k", fixture: "scale-50k", rootBlocks: 50_000 },
] as const;
const UNRECORDED = "unrecorded";

type Sample = { readonly p50: number };
type FixtureClocks =
	| {
			readonly mountMs: Sample;
			readonly keystrokeToFrameMs: Sample;
			readonly caretDownToFrameMs: Sample;
	  }
	| { readonly mountTimedOut: true };
type Counts = { readonly mount?: Record<string, number> };
type ScaleRenderBaseline = {
	readonly largeCounts?: Record<string, Counts | { readonly mountTimedOut: true }>;
	readonly clocks?: {
		readonly recordedAt: string;
		readonly machineClass: string;
		readonly floors: Record<string, { readonly mountMs: Sample }>;
		readonly fixtures: Record<string, FixtureClocks>;
	} | null;
};

function conformanceBaselinePath(surface: string): string {
	return resolve(
		dirname(fileURLToPath(import.meta.url)),
		`../../../conformance/baselines/scale-render.${surface}.chromium.json`,
	);
}

/** The mixed fixture's total block count (roots plus toggle children), from the generator. */
function totalBlocksFor(rootBlocks: number): number {
	return mixedFixtureIdentity(rootBlocks).totalBlocks;
}

function isTimedOut(value: unknown): value is { mountTimedOut: true } {
	return (
		typeof value === "object" &&
		value !== null &&
		"mountTimedOut" in value &&
		(value as { mountTimedOut: unknown }).mountTimedOut === true
	);
}

export async function buildRendererRows(): Promise<EnvelopeRendererRow[]> {
	const rows: EnvelopeRendererRow[] = [];
	for (const surface of SURFACES) {
		const baseline = JSON.parse(
			await readFile(conformanceBaselinePath(surface), "utf8"),
		) as ScaleRenderBaseline;
		const clocks = baseline.clocks ?? null;
		for (const { size, fixture, rootBlocks } of SIZES) {
			const fixtureClocks = clocks?.fixtures[fixture];
			const timedOut =
				isTimedOut(fixtureClocks) ||
				isTimedOut(baseline.largeCounts?.[fixture]);
			const measured =
				fixtureClocks && "mountMs" in fixtureClocks ? fixtureClocks : null;
			rows.push({
				id: `renderer.${surface}.${size}`,
				surface,
				rootBlocks,
				totalBlocks: totalBlocksFor(rootBlocks),
				grade: "measured",
				mountP50Ms: measured?.mountMs.p50 ?? null,
				mountFloorP50Ms: measured
					? (clocks?.floors[fixture]?.mountMs.p50 ?? null)
					: null,
				keystrokeToFrameP50Ms: measured?.keystrokeToFrameMs.p50 ?? null,
				caretDownToFrameP50Ms: measured?.caretDownToFrameMs.p50 ?? null,
				mountTimedOut: timedOut,
				machineClass: measured || timedOut ? (clocks?.machineClass ?? UNRECORDED) : UNRECORDED,
				recordedAt: measured || timedOut ? (clocks?.recordedAt ?? UNRECORDED) : UNRECORDED,
				source: `@input/pen-conformance baselines/scale-render.${surface}.chromium.json`,
			});
		}
	}
	return rows;
}

async function main(): Promise<void> {
	const check = process.argv.includes("--check");
	const record = await loadCommittedEnvelope();
	const rows = await buildRendererRows();
	if (check) {
		if (JSON.stringify(record.renderer) !== JSON.stringify(rows)) {
			console.error(
				"SCALE1 envelope renderer rows drifted from the conformance scale-render baselines. Regenerate with `pnpm --filter @input/pen-bench run bench:envelope:renderer`.",
			);
			process.exit(1);
		}
		console.error("SCALE1 envelope renderer rows match the conformance baselines");
		return;
	}
	await writeEnvelopeRecord({ ...record, renderer: rows });
	console.error(`Wrote ${rows.length} renderer rows to baselines/envelope.json`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await main();
}
