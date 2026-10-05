import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CONFORMANCE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Keep in sync with `parseFuzzSeed` in every `*.properties.test.ts` suite
 * (`vitest.nightly.ts` lists them: DUR3, I1, COL4 n-peer).
 * Nightly.yml logs `${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}-$(date +%s)`;
 * `Number` of that string is NaN and the old `>>> 0` path collapsed every
 * night onto seed 0.
 */
export function parseNumericFuzzSeed(raw) {
	if (raw == null || raw === "") return 20260819;
	const asNumber = Number(raw);
	if (Number.isFinite(asNumber)) return asNumber >>> 0;
	let hash = 2166136261;
	for (let i = 0; i < raw.length; i++) {
		hash ^= raw.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

export function runPropertySuite({ nightly = false } = {}) {
	const seed = process.env.PEN_FUZZ_SEED ?? `${Date.now()}`;
	const numeric = parseNumericFuzzSeed(seed);
	console.log(
		`${nightly ? "Nightly" : "Node"} fuzz seed: ${seed} (numeric ${numeric})`,
	);

	const env = {
		...process.env,
		PEN_FUZZ_SEED: seed,
	};
	if (nightly) {
		env.PEN_FUZZ_NIGHTLY = "1";
	}

	return new Promise((resolve, reject) => {
		const child = spawn(
			"pnpm",
			["exec", "vitest", "run", "--config", "vitest.nightly.ts"],
			{
				cwd: CONFORMANCE_DIR,
				env,
				stdio: "inherit",
			},
		);
		child.on("error", reject);
		child.on("exit", (code) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(`change-summary property suite exited ${code ?? "null"}`));
		});
	});
}