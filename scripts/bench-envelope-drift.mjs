#!/usr/bin/env node
/**
 * SCALE1 envelope table drift gate.
 *
 * Regenerates the renderer rows of baselines/envelope.json from the
 * conformance scale-render baselines, and packages/tooling/bench/ENVELOPE.md
 * from baselines/envelope.json plus the fixture audit, and fails if either
 * committed file does not match. This is a table-diff, not a
 * timing gate: CH8 keeps wall-clock comparison in the isolated
 * bench job, and only on the same machine class.
 *
 * Fail-closed: a missing baseline, a missing table, or a renderer
 * error exits non-zero.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// W1.R9: renderer rows first (envelope.json against the conformance
// baselines), then the table against envelope.json, so neither moves alone.
for (const script of ["src/envelope/importRenderer.ts", "src/envelope/writeTable.ts"]) {
	const result = spawnSync(
		"pnpm",
		["--filter", "@input/pen-bench", "exec", "tsx", script, "--check"],
		{
			cwd: root,
			stdio: "inherit",
		},
	);
	if (result.error) {
		console.error(result.error.message);
		process.exit(1);
	}
	if (result.status !== 0) {
		process.exit(1);
	}
}
