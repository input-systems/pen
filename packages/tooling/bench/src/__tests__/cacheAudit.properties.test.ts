import { describe, expect, it } from "vitest";
import { loadAuditInternals } from "../cacheAudit/internals";
import { createPropertyCase } from "../cacheAudit/property";

/**
 * Simplification plan Phase 2: each kept cache (A–G) equals its naive full
 * recompute after every operation of a seeded random walk — keystrokes,
 * splits, merges, inserts, moves and deletes across the root, `children`
 * array and `parentId` routes, indent and type changes, undo and redo, AI
 * suggestions and remote peer commits.
 *
 * PR runs walk 40 seeds; `PEN_FUZZ_NIGHTLY` walks 200. `PEN_FUZZ_SEED` moves
 * the first seed (a non-numeric nightly seed is hashed) and
 * `PEN_FUZZ_OP_COUNT` sets the operations per seed (default 30).
 */
const NIGHTLY = Boolean(process.env.PEN_FUZZ_NIGHTLY);
const SEED_INFO = parseFuzzSeed(process.env.PEN_FUZZ_SEED);
const SEED_COUNT = NIGHTLY ? 200 : 40;
const OP_COUNT = resolveOpCount();

function parseFuzzSeed(raw: string | undefined): {
	raw: string;
	numeric: number;
} {
	const source = raw && raw.length > 0 ? raw : "20261005";
	const asNumber = Number(source);
	if (Number.isFinite(asNumber))
		return { raw: source, numeric: asNumber >>> 0 };
	let hash = 2166136261;
	for (let i = 0; i < source.length; i++) {
		hash ^= source.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return { raw: source, numeric: hash >>> 0 };
}

function resolveOpCount(): number {
	const override = Number(process.env.PEN_FUZZ_OP_COUNT);
	if (Number.isFinite(override) && override > 0) return Math.floor(override);
	return 30;
}

describe("cache equivalence property (simplification plan Phase 2)", () => {
	it(`keeps caches A–G equal to their naive recompute over ${SEED_COUNT} seeds × ${OP_COUNT} ops`, async () => {
		const internals = await loadAuditInternals();
		for (let offset = 0; offset < SEED_COUNT; offset += 1) {
			const seed = (SEED_INFO.numeric + offset) >>> 0;
			const property = createPropertyCase(seed, internals);
			const trail: string[] = [];
			try {
				expect(
					property.check(),
					`seed=${seed} (${SEED_INFO.raw}+${offset}) initial`,
				).toEqual([]);
				for (let step = 0; step < OP_COUNT; step += 1) {
					trail.push(property.step());
					const problems = property.check();
					if (problems.length > 0) {
						expect(
							problems,
							`seed=${seed} (${SEED_INFO.raw}+${offset}) after ${trail.join(" → ")}\n${property.trace()}`,
						).toEqual([]);
					}
				}
			} finally {
				property.destroy();
			}
		}
	}, 600_000);
});
