import { describe, expect, it } from "vitest";

import {
	COL4_FUZZ_STRUCTURAL_KINDS,
	runCol4PeerFuzz,
	type Col4FuzzOpKind,
} from "../col4Scenarios";

/**
 * COL4 nightly property (W5.R13): random structural interleavings at three
 * and five peers keep convergence and every structural invariant. Honours
 * PEN_FUZZ_NIGHTLY (2,000 cases, else 100), PEN_FUZZ_SEED (numeric or a
 * hyphenated nightly seed) and PEN_FUZZ_OP_COUNT (cases per peer count).
 */

const NIGHTLY = Boolean(process.env.PEN_FUZZ_NIGHTLY);
const SEED_INFO = parseFuzzSeed(process.env.PEN_FUZZ_SEED);
const CASES = resolveCaseCount();

function parseFuzzSeed(raw: string | undefined): { raw: string; numeric: number } {
	const source = raw && raw.length > 0 ? raw : "20261002";
	const asNumber = Number(source);
	if (Number.isFinite(asNumber)) {
		return { raw: source, numeric: asNumber >>> 0 };
	}
	let hash = 2166136261;
	for (let i = 0; i < source.length; i++) {
		hash ^= source.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return { raw: source, numeric: hash >>> 0 };
}

function resolveCaseCount(): number {
	const override = Number(process.env.PEN_FUZZ_OP_COUNT);
	if (Number.isFinite(override) && override > 0) return Math.floor(override);
	return NIGHTLY ? 2_000 : 100;
}

function structuralShare(histogram: Map<Col4FuzzOpKind, number>): number {
	let total = 0;
	let structural = 0;
	for (const [kind, count] of histogram) {
		total += count;
		if (kind !== "splice-text") structural += count;
	}
	return total === 0 ? 0 : structural / total;
}

describe("COL4 n-peer property", () => {
	for (const peers of [3, 5]) {
		it(`COL4: random structural interleavings at ${peers} peers keep every structural invariant`, () => {
			const histogram = runCol4PeerFuzz({
				peers,
				iterations: CASES,
				seed: SEED_INFO.numeric,
			});
			const label = `seed=${SEED_INFO.numeric} (${SEED_INFO.raw}) peers=${peers} cases=${CASES}`;
			// The histogram guard: a run that emits no op of some structural
			// kind proves nothing about that kind.
			for (const kind of COL4_FUZZ_STRUCTURAL_KINDS) {
				expect(histogram.get(kind) ?? 0, `${label}: no ${kind}`).toBeGreaterThan(0);
			}
			expect(structuralShare(histogram), `${label}: structural share`).toBeGreaterThanOrEqual(0.5);
		}, 1_800_000);
	}
});
