import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderHtmlFidelityTable } from "../html/export/fidelityTable";
import { renderJsonFidelityTable } from "../json/export/fidelityTable";
import { renderMarkdownFidelityTable } from "../markdown/export/fidelityTable";
import { renderXmlFidelityTable } from "../xml/fidelityTable";

// Before the SF2 merge each exporter owned its own FIDELITY.md and asserted
// toBe(renderXxxFidelityTable()). Concatenation forced those four down to
// toContain, which can no longer detect extra, stale, duplicated or reordered
// sections. This restores the whole-document guarantee at the level the
// document now lives.
const committed = readFileSync(
	join(dirname(fileURLToPath(import.meta.url)), "../../FIDELITY.md"),
	"utf8",
);

describe("IOP3 merged fidelity document", () => {
	it("IOP3 FIDELITY.md is exactly the four format tables in html, json, markdown, xml order", () => {
		expect(committed).toBe(
			renderHtmlFidelityTable() +
				renderJsonFidelityTable() +
				renderMarkdownFidelityTable() +
				renderXmlFidelityTable(),
		);
	});
});
