import { defineConfig } from "vitest/config";

// CH9 (spec/rules/reliability.md): explicit suite timeout. `vitest run` from
// this package does not load the root config, so these tests fell back to
// Vitest's 5000ms default. The gate tests spawn `scripts/ch-gates.mjs` and
// cold-load the root ESLint config (~0.5–2s idle), which overran 5s on the
// 4 vCPU CI runner while turbo fans out every package.
export default defineConfig({
	test: {
		testTimeout: 30_000,
		// Same CI cap as the root config: stop this package's workers starving
		// the others under `turbo run test`.
		maxWorkers: process.env.CI ? 2 : undefined,
	},
});
