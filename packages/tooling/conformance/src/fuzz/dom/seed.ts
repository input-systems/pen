/**
 * Seeds for the DOM fuzzer (W3.R19 §3.15). The env convention is the one
 * `anchors.an-fuzz.test.ts` uses: `PEN_FUZZ_NIGHTLY`, `PEN_FUZZ_SEED`,
 * `PEN_FUZZ_OP_COUNT`, plus `PEN_FUZZ_REPLAY` and `PEN_FUZZ_FORCE_FAIL_AT`.
 */

/** The PR short job: fixed, so a red PR names a seed anyone can rerun. */
export const PR_FUZZ_SEEDS = [11, 23, 37, 41] as const;
const PR_FUZZ_STEPS = 40;
const NIGHTLY_FUZZ_SEED_COUNT = 24;
const NIGHTLY_FUZZ_STEPS = 250;

/** FNV-1a over a non-numeric seed, so a logged CI seed string still reproduces. */
export function parseFuzzSeed(raw: string | undefined): {
	raw: string;
	numeric: number;
} {
	const source = raw && raw.length > 0 ? raw : "20261003";
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

export type FuzzRng = {
	/** Uniform in [0, 1). */
	next(): number;
	/** Uniform integer in [0, max). */
	int(max: number): number;
	pick<T>(items: readonly T[]): T;
};

export function createFuzzRng(seed: number): FuzzRng {
	let state = seed >>> 0;
	// mulberry32
	const next = (): number => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	const int = (max: number): number => Math.floor(next() * Math.max(0, max));
	return {
		next,
		int,
		pick: (items) => {
			if (items.length === 0) {
				throw new Error("fuzz rng: pick from an empty list");
			}
			return items[int(items.length)]!;
		},
	};
}

export type DomFuzzConfig = {
	seeds: number[];
	steps: number;
	/** Logged so a nightly run can be reproduced from its job output. */
	seedLabel: string;
	replayPath: string | null;
	forceFailAt: number | null;
	/** `PEN_FUZZ_SHRINK=1`: shrink a failing trace before writing it. */
	shrink: boolean;
	/** Nightly: the full §3.15 set; else the frozen PR set. `PEN_FUZZ_ACTIONS` overrides. */
	actionSet: "pr" | "full";
	/**
	 * `fuzz-mixed` and `fuzz-large` (W3.G19: the PR job drags across more
	 * than 50 blocks too). `PEN_FUZZ_FIXTURE` overrides.
	 */
	fixtures: string[];
};

type FuzzEnv = Readonly<Record<string, string | undefined>>;

function nonNegativeInt(raw: string | undefined): number | null {
	const value = Number(raw);
	return raw !== undefined &&
		raw !== "" &&
		Number.isFinite(value) &&
		value >= 0
		? Math.floor(value)
		: null;
}

function resolveSeeds(
	env: FuzzEnv,
	nightly: boolean,
): { seeds: number[]; seedLabel: string } {
	if (nightly) {
		const base = parseFuzzSeed(env.PEN_FUZZ_SEED);
		const rng = createFuzzRng(base.numeric);
		const seeds = Array.from({ length: NIGHTLY_FUZZ_SEED_COUNT }, () =>
			rng.int(2 ** 31),
		);
		return { seeds, seedLabel: base.raw };
	}
	if (env.PEN_FUZZ_SEED) {
		const parsed = parseFuzzSeed(env.PEN_FUZZ_SEED);
		return { seeds: [parsed.numeric], seedLabel: parsed.raw };
	}
	return { seeds: [...PR_FUZZ_SEEDS], seedLabel: PR_FUZZ_SEEDS.join(",") };
}

export function resolveDomFuzzConfig(env: FuzzEnv): DomFuzzConfig {
	const nightly = Boolean(env.PEN_FUZZ_NIGHTLY);
	const { seeds, seedLabel } = resolveSeeds(env, nightly);
	const override = nonNegativeInt(env.PEN_FUZZ_OP_COUNT);
	return {
		seeds,
		steps:
			override && override > 0
				? override
				: nightly
					? NIGHTLY_FUZZ_STEPS
					: PR_FUZZ_STEPS,
		seedLabel,
		replayPath: env.PEN_FUZZ_REPLAY ? env.PEN_FUZZ_REPLAY : null,
		forceFailAt: nonNegativeInt(env.PEN_FUZZ_FORCE_FAIL_AT),
		shrink: Boolean(env.PEN_FUZZ_SHRINK),
		actionSet:
			env.PEN_FUZZ_ACTIONS === "full" || env.PEN_FUZZ_ACTIONS === "pr"
				? env.PEN_FUZZ_ACTIONS
				: nightly
					? "full"
					: "pr",
		fixtures: env.PEN_FUZZ_FIXTURE
			? [env.PEN_FUZZ_FIXTURE]
			: ["fuzz-mixed", "fuzz-large"],
	};
}
