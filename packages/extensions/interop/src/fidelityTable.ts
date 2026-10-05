export type ExportFidelity = "full" | "degraded" | "dropped";

export interface ExportFidelityRow {
	kind: "block" | "mark" | "inline-node";
	type: string;
	fidelity: ExportFidelity;
	notes: string;
}

/**
 * Renders one exporter's IOP3 fidelity table as the markdown committed in
 * `FIDELITY.md`. `sourceDir` is the exporter directory under the package
 * root; it names the table and the test that asserts it.
 */
export function renderFidelityTable(
	title: string,
	intro: string,
	sourceDir: string,
	rows: readonly ExportFidelityRow[],
): string {
	const lines = [
		`# ${title}`,
		"",
		intro,
		"",
		`Generated from \`${sourceDir}/fidelityTable.ts\` and asserted by \`${sourceDir}/__tests__/iop3Fidelity.test.ts\`. Do not edit by hand.`,
		"",
		"| Kind | Type | Fidelity | Notes |",
		"| --- | --- | --- | --- |",
	];

	for (const row of rows) {
		lines.push(
			`| ${row.kind} | ${row.type} | ${row.fidelity} | ${row.notes} |`,
		);
	}

	lines.push("");
	return lines.join("\n");
}
