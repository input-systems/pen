import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createVitest } from "vitest/node";

test("CH9: core loads an explicit timeout and CI worker budget from its package root", async () => {
	const previousCI = process.env.CI;
	let vitest;
	try {
		process.env.CI = "true";
		vitest = await createVitest({
			root: fileURLToPath(new URL("../../packages/core/", import.meta.url)),
			watch: false,
		});
		assert.equal(vitest.config.testTimeout, 10_000);
		assert.equal(vitest.config.maxWorkers, 2);
	} finally {
		await vitest?.close();
		if (previousCI === undefined) delete process.env.CI;
		else process.env.CI = previousCI;
	}
});
