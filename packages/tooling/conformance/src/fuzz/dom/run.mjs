#!/usr/bin/env node
/**
 * `pnpm --filter @input/pen-conformance run fuzz:dom -- --project <engine>`
 * (W3.R19 §3.15). Runs `suites/fuzz/dom-fuzz.spec.ts` with the fuzz env:
 * `PEN_FUZZ_NIGHTLY`, `PEN_FUZZ_SEED`, `PEN_FUZZ_OP_COUNT`, `PEN_FUZZ_REPLAY`.
 * Other arguments pass through to Playwright.
 */
import { spawn } from "node:child_process";
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CONFORMANCE_DIR = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../..",
);
const SPEC = "suites/fuzz/dom-fuzz.spec.ts";

/** `--project <engine>` picks the engine; every other argument passes through. */
function parseArgs(argv) {
	const args = argv.filter((arg) => arg !== "--");
	const at = args.indexOf("--project");
	if (at === -1) {
		return { project: "chromium", passthrough: args };
	}
	return {
		project: args[at + 1] ?? "chromium",
		passthrough: [...args.slice(0, at), ...args.slice(at + 2)],
	};
}

/**
 * Playwright empties `test-results/` before a run, which is where traces are
 * written. Replay a copy so the trace being replayed survives that.
 */
function stageReplay(file) {
	const source = path.resolve(process.cwd(), file);
	const staged = path.join(
		mkdtempSync(path.join(tmpdir(), "pen-fuzz-dom-")),
		path.basename(source),
	);
	copyFileSync(source, staged);
	return staged;
}

const { project, passthrough } = parseArgs(process.argv.slice(2));
// Log only the fuzz variables read by name, never values off the full
// environment copy handed to Playwright.
const nightly = Boolean(process.env.PEN_FUZZ_NIGHTLY);
const seed =
	process.env.PEN_FUZZ_SEED || (nightly ? `${Date.now()}` : undefined);
const replay = process.env.PEN_FUZZ_REPLAY
	? stageReplay(process.env.PEN_FUZZ_REPLAY)
	: undefined;
const env = { ...process.env };
if (seed) {
	env.PEN_FUZZ_SEED = seed;
}
if (replay) {
	env.PEN_FUZZ_REPLAY = replay;
	console.log(`fuzz:dom replaying ${replay}`);
} else {
	console.log(
		`fuzz:dom seed: ${seed ?? "PR seeds"}${nightly ? " (nightly)" : ""}`,
	);
}

const child = spawn(
	"pnpm",
	[
		"exec",
		"playwright",
		"test",
		SPEC,
		`--project=${project}`,
		...passthrough,
	],
	{
		cwd: CONFORMANCE_DIR,
		env,
		stdio: "inherit",
	},
);
child.on("error", (error) => {
	console.error(error.message);
	process.exitCode = 1;
});
child.on("exit", (code) => {
	process.exitCode = code ?? 1;
});
