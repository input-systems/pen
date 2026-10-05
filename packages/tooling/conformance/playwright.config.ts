import { defineConfig, devices } from "@playwright/test";
import { HARNESS_PORT } from "./src/harnessPort";

const HARNESS_BASE_URL = `http://127.0.0.1:${HARNESS_PORT}`;

export default defineConfig({
	testDir: ".",
	testMatch: ["scenarios/**/*.spec.ts", "suites/**/*.spec.ts"],
	timeout: 30_000,
	expect: {
		timeout: 10_000,
	},
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: 0,
	reporter: process.env.CI ? "github" : "list",
	use: {
		baseURL: HARNESS_BASE_URL,
		trace: "retain-on-failure",
	},
	webServer: {
		command: `pnpm --filter @input/pen-conformance exec vite --config harness/vite.config.ts --host 127.0.0.1 --port ${HARNESS_PORT} --strictPort`,
		url: HARNESS_BASE_URL,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
	projects: [
		{
			name: "chromium",
			use: {
				...devices["Desktop Chrome"],
			},
		},
		{
			name: "webkit",
			use: {
				...devices["Desktop Safari"],
			},
		},
		{
			name: "firefox",
			use: {
				...devices["Desktop Firefox"],
			},
		},
	],
});
