#!/usr/bin/env node
/**
 * Writes packages/tooling/test/ENVELOPE.md from the fixture metadata.
 * `--check` compares instead and exits 1 on drift; the bench-envelope-drift gate
 * (scripts/bench-envelope-drift.mjs) runs it next to the bench table check.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const METADATA_PATH = join(
	ROOT,
	"packages/tooling/test/src/fixtures/envelope/metadata.json",
);
const OUTPUT_PATH = join(ROOT, "packages/tooling/test/ENVELOPE.md");

export function renderEnvelopeMarkdown(metadata) {
	const rows = metadata.axes.map((axis) => {
		const verified = formatGrade(axis.verified);
		const measured = axis.measured ? formatGrade(axis.measured) : "—";
		const untested = axis.untestedAbove.display;
		return `| ${axis.label} | ${verified} | ${measured} | ${untested} |`;
	});

	const rungRows = metadata.rungs.map((rung) => {
		const storage =
			rung.storage === "committed"
				? `committed \`${rung.path}\``
				: "generated at runtime";
		return `| \`${rung.id}\` | ${rung.size} | ${storage} |`;
	});

	return `# Scale envelope

Generated from \`packages/tooling/test/src/fixtures/envelope/metadata.json\`. Do not edit by hand. Regenerate with \`node scripts/envelope-table.mjs\`.

Published next to the HOST3 runtime floor (\`${metadata.hostFloor}\`). Rule: ${metadata.ruleId} (\`${metadata.spec}\`).

## Envelope

| Axis | Verified | Measured | Untested above |
| ---- | -------- | -------- | -------------- |
${rows.join("\n")}

Grades: **verified** — a suite asserts behavior at this size on every run. **measured** — a benchmark records it, no pass/fail gate. **untested above** — the honest ceiling.

Verification for the ladder is headless (\`createTestEditor\`). No renderer suite yet asserts these sizes.

## Fixture ladder

| Rung | Size | Storage |
| ---- | ---- | ------- |
${rungRows.join("\n")}

5,000-block and 1,000-row fixtures are generated at runtime rather than committed: a Yjs dump of those sizes is large and adds nothing beyond the generator plus this table. The committed 100-block JSON is the checked-in rung; every other size is produced by the same scripts.

## Past the ceiling

Past these sizes, per-commit decoration collection and full-document render degrade first — Pen does not virtualize (\`spec/rules/dom.md\`). Hosts that need larger documents window blocks themselves (\`${metadata.virtualization}\`, SCALE5).
${renderNotes(metadata.notes)}`;
}

function renderNotes(notes) {
	if (!Array.isArray(notes) || notes.length === 0) {
		return "";
	}
	const items = notes.map((note) => `- ${note}`).join("\n");
	return `
## Correction notes

${items}
`;
}

function formatGrade(cell) {
	return `${cell.display} (${cell.suite})`;
}

function main() {
	const metadata = JSON.parse(readFileSync(METADATA_PATH, "utf8"));
	const markdown = renderEnvelopeMarkdown(metadata);
	if (process.argv.includes("--stdout")) {
		process.stdout.write(markdown);
	} else if (process.argv.includes("--check")) {
		if (readFileSync(OUTPUT_PATH, "utf8") !== markdown) {
			console.error(
				"packages/tooling/test/ENVELOPE.md drifted from its fixture metadata. Regenerate with `node scripts/envelope-table.mjs`.",
			);
			process.exit(1);
		}
	} else {
		writeFileSync(OUTPUT_PATH, markdown);
	}
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
	main();
}
