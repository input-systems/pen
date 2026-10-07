import { defineConfig } from "vitest/config";

// CH9: package-local runs need an explicit timeout and CI worker budget.
export default defineConfig({
	test: {
		testTimeout: 10_000,
		maxWorkers: process.env.CI ? 2 : undefined,
	},
});
