import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	generateMixedBlockSpecs,
	mixedFixtureIdentity,
	mixedFixtureOps,
	type MixedFixtureIdentity,
} from "@input/pen-test";

/**
 * SCALE6 renderer counts (W1): per surface and fixture, the work a scripted
 * action performs. Counts are compared exactly against the committed
 * baseline; anything clock-like is recorded only (CH8).
 */

export type ScaleRenderSurface = "react" | "vue" | "vanilla";
export type ScaleRenderCountFixture = "scale-1k" | "scale-5k";
export type ScaleRenderAction =
	| "mount"
	| "keystroke"
	| "caretRight"
	| "caretDown"
	| "shiftDown"
	| "enterParagraph"
	| "enterNumbered"
	| "remoteInsert";
/** Dotted metric name, e.g. "render.blocksRendered". */
export type ScaleRenderMetric = string;
export type ScaleRenderCounts = Partial<
	Record<ScaleRenderAction, Record<ScaleRenderMetric, number>>
>;

export interface ScaleRenderFixtureRecord {
	readonly generator: "@input/pen-test generateMixedBlockSpecs + mixedFixtureOps";
	readonly contentSha256: string;
	readonly identity: MixedFixtureIdentity;
}

export interface ScaleRenderBaseline {
	readonly schemaVersion: 1;
	readonly surface: ScaleRenderSurface;
	readonly browser: "chromium";
	readonly fixtures: Partial<Record<ScaleRenderCountFixture, ScaleRenderFixtureRecord>>;
	/** Gated. Any drift fails by name. */
	readonly counts: Partial<Record<ScaleRenderCountFixture, ScaleRenderCounts>>;
	/** One entry per re-record: what moved and why (SCALE3). */
	readonly history: readonly {
		readonly date: string;
		readonly reason: string;
		readonly moved: readonly string[];
	}[];
}

export interface ScaleRenderInvariant {
	readonly id: string;
	readonly rule: string;
	readonly surface: ScaleRenderSurface | "all";
	readonly action: ScaleRenderAction;
	readonly metric: ScaleRenderMetric;
	readonly relation:
		| { readonly kind: "equal-across"; readonly fixtures: readonly ScaleRenderCountFixture[] }
		| { readonly kind: "max"; readonly fixture: ScaleRenderCountFixture; readonly value: number }
		| {
				readonly kind: "log-bound";
				readonly fixture: ScaleRenderCountFixture;
				readonly a: number;
				readonly b: number;
		  };
	readonly status: "enforced" | "pending";
	readonly closedBy: string;
}

export const SCALE_RENDER_ROOT_COUNTS: Readonly<Record<ScaleRenderCountFixture, number>> = {
	"scale-1k": 1_000,
	"scale-5k": 5_000,
};

const BASELINE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "baselines");

function baselinePath(surface: ScaleRenderSurface): string {
	return join(BASELINE_DIR, `scale-render.${surface}.chromium.json`);
}

const INVARIANTS_PATH = join(BASELINE_DIR, "scale-render.invariants.json");

export function fixtureRecord(fixture: ScaleRenderCountFixture): ScaleRenderFixtureRecord {
	const rootCount = SCALE_RENDER_ROOT_COUNTS[fixture];
	const content = JSON.stringify({
		blocks: generateMixedBlockSpecs(rootCount),
		ops: mixedFixtureOps(rootCount),
	});
	return {
		generator: "@input/pen-test generateMixedBlockSpecs + mixedFixtureOps",
		contentSha256: createHash("sha256").update(content).digest("hex"),
		identity: mixedFixtureIdentity(rootCount),
	};
}

/** Every repetition of an action must produce the same counts. */
export function assertDeterministic(
	label: string,
	repetitions: readonly Record<ScaleRenderMetric, number>[],
): Record<ScaleRenderMetric, number> {
	const metrics = new Set(repetitions.flatMap((counts) => Object.keys(counts)));
	const unstable = [...metrics].filter((metric) => {
		const values = repetitions.map((counts) => counts[metric] ?? 0);
		return values.some((value) => value !== values[0]);
	});
	if (unstable.length > 0) {
		const detail = unstable.map(
			(metric) => `${metric} [${repetitions.map((counts) => counts[metric] ?? 0).join(", ")}]`,
		);
		throw new Error(`nondeterministic count: ${label}/${detail.join("; ")}`);
	}
	return repetitions[0] ?? {};
}

export function loadBaseline(surface: ScaleRenderSurface): ScaleRenderBaseline | null {
	const path = baselinePath(surface);
	return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as ScaleRenderBaseline) : null;
}

export function loadInvariants(): readonly ScaleRenderInvariant[] {
	return existsSync(INVARIANTS_PATH)
		? (JSON.parse(readFileSync(INVARIANTS_PATH, "utf8")) as ScaleRenderInvariant[])
		: [];
}

export interface CountDrift {
	readonly failures: readonly string[];
}

function compareAction(
	key: string,
	expected: Record<ScaleRenderMetric, number>,
	actual: Record<ScaleRenderMetric, number>,
): string[] {
	const moved = Object.entries(expected)
		.filter(([metric, value]) => actual[metric] !== value)
		.map(([metric, value]) => `${key}/${metric}: ${actual[metric] ?? "missing"} !== ${value}`);
	const added = Object.keys(actual)
		.filter((metric) => !(metric in expected))
		.map((metric) => `${key}/${metric}: new metric — re-record`);
	return [...moved, ...added];
}

/** Rule 3: every committed count must match exactly; a new metric fails too. */
export function compareCounts(
	surface: ScaleRenderSurface,
	fixture: ScaleRenderCountFixture,
	expected: ScaleRenderCounts,
	actual: ScaleRenderCounts,
): CountDrift {
	const actions = new Set([...Object.keys(expected), ...Object.keys(actual)]) as Set<ScaleRenderAction>;
	const failures = [...actions].flatMap((action) =>
		compareAction(`${surface}/${fixture}/${action}`, expected[action] ?? {}, actual[action] ?? {}),
	);
	return { failures };
}

function invariantHolds(
	row: ScaleRenderInvariant,
	counts: Partial<Record<ScaleRenderCountFixture, ScaleRenderCounts>>,
): boolean {
	const read = (fixture: ScaleRenderCountFixture) => counts[fixture]?.[row.action]?.[row.metric];
	const relation = row.relation;
	if (relation.kind === "equal-across") {
		const values = relation.fixtures.map(read);
		return values.every((value) => value !== undefined && value === values[0]);
	}
	const value = read(relation.fixture) ?? Number.POSITIVE_INFINITY;
	if (relation.kind === "max") return value <= relation.value;
	const blocks = mixedFixtureIdentity(SCALE_RENDER_ROOT_COUNTS[relation.fixture]).totalBlocks;
	return value <= relation.a * Math.ceil(Math.log2(blocks)) + relation.b;
}

/** Rule 4: enforced rows must hold; pending rows that already hold must be flipped. */
export function evaluateInvariants(
	surface: ScaleRenderSurface,
	counts: Partial<Record<ScaleRenderCountFixture, ScaleRenderCounts>>,
	rows: readonly ScaleRenderInvariant[],
): readonly string[] {
	return rows
		.filter((row) => row.surface === "all" || row.surface === surface)
		.flatMap((row) => {
			const holds = invariantHolds(row, counts);
			if (row.status === "enforced" && !holds) return [`invariant ${row.id} (${row.rule}) does not hold`];
			if (row.status === "pending" && holds) return [`pending invariant ${row.id} holds — flip it to enforced`];
			return [];
		});
}

export function writeBaseline(
	surface: ScaleRenderSurface,
	counts: Partial<Record<ScaleRenderCountFixture, ScaleRenderCounts>>,
	reason: string,
): void {
	const previous = loadBaseline(surface);
	const fixtures = Object.fromEntries(
		(Object.keys(counts) as ScaleRenderCountFixture[]).map((fixture) => [fixture, fixtureRecord(fixture)]),
	);
	const moved = previous
		? (Object.keys(counts) as ScaleRenderCountFixture[]).flatMap(
				(fixture) =>
					compareCounts(surface, fixture, previous.counts[fixture] ?? {}, counts[fixture] ?? {}).failures,
			)
		: ["initial record"];
	const baseline: ScaleRenderBaseline = {
		schemaVersion: 1,
		surface,
		browser: "chromium",
		fixtures,
		counts,
		history: [
			...(previous?.history ?? []),
			{ date: new Date().toISOString().slice(0, 10), reason, moved },
		],
	};
	writeFileSync(baselinePath(surface), `${JSON.stringify(baseline, null, "\t")}\n`);
}
