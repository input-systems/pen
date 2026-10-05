import { readFileSync } from "node:fs";
import path from "node:path";
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";
import { missingAllowlistField, noUnscheduledMeasure } from "../rules/noUnscheduledMeasure.js";

const ruleTester = new RuleTester({
	languageOptions: { parser: tseslint.parser },
});

const file = "packages/rendering/dom/src/seeded-measure.ts";
const repoRoot = path.resolve(import.meta.dirname, "../../../../..");

describe("no-unscheduled-measure (SCH1)", () => {
	it("SCH1: flags geometry reads and consumes a matching allowlist symbol", () => {
		ruleTester.run("no-unscheduled-measure", noUnscheduledMeasure, {
			valid: [
				{
					code: "function measureNow() { el.getBoundingClientRect(); return el.getBoundingClientRect(); }\n",
					filename: file,
					options: [{ allowlist: [{ file, symbol: "measureNow", reason: "GeometryReader G1" }] }],
				},
				{
					code: "function read() { return range.getClientRects; }\n",
					filename: file,
					options: [{ allowlist: [{ file, symbol: "read", reason: "type mention inside GeometryReader" }] }],
				},
			],
			invalid: [
				{
					code: "function overlayPaint() { return el.getBoundingClientRect(); }\n",
					filename: file,
					options: [{ allowlist: [] }],
					errors: [
						{ messageId: "measure", data: { kind: "getBoundingClientRect", symbol: "overlayPaint", file } },
					],
				},
				{
					code: "function overlayPaint() { return 1; }\n",
					filename: file,
					options: [{ allowlist: [{ file, symbol: "overlayPaint", reason: "retired" }] }],
					errors: [{ messageId: "unusedAllowlist" }],
				},
			],
		});
	});

	it("SCH1 HB2: a binding layout-metric read or observer outside the allowlist fails", () => {
		const bindingFile = "packages/rendering/react/src/seeded-binding.tsx";
		const extraNames = ["scrollTop", "clientHeight", "getComputedStyle", "ResizeObserver"];
		const layoutReads = [
			"function useWindow(el) {",
			"\tconst top = el.scrollTop;",
			"\tconst style = getComputedStyle(el);",
			"\tconst observer = new ResizeObserver(() => {});",
			"\treturn [top, style, observer];",
			"}",
			"",
		].join("\n");
		ruleTester.run("no-unscheduled-measure", noUnscheduledMeasure, {
			valid: [
				// pen-dom runs the rule without extraNames: layout metrics are its job.
				{ code: layoutReads, filename: file, options: [{ allowlist: [] }] },
				// A write, a type mention and a feature test are not measures.
				{
					code: [
						"function scrollTo(el: HTMLElement, observer: ResizeObserver) {",
						"\tel.scrollTop = 0;",
						'\treturn typeof ResizeObserver === "undefined" ? null : observer;',
						"}",
						"",
					].join("\n"),
					filename: bindingFile,
					options: [{ allowlist: [], extraNames }],
				},
				{
					code: layoutReads,
					filename: bindingFile,
					options: [
						{
							allowlist: [{ file: bindingFile, symbol: "useWindow", reason: "HB2 test" }],
							extraNames,
						},
					],
				},
			],
			invalid: [
				{
					code: layoutReads,
					filename: bindingFile,
					options: [{ allowlist: [], extraNames }],
					errors: [
						{ messageId: "measure", data: { kind: "scrollTop", symbol: "useWindow", file: bindingFile } },
						{ messageId: "measure", data: { kind: "getComputedStyle", symbol: "useWindow", file: bindingFile } },
						{ messageId: "measure", data: { kind: "ResizeObserver", symbol: "useWindow", file: bindingFile } },
					],
				},
				{
					code: "function moveFocus(root) { return root.ownerDocument.defaultView.getComputedStyle(root).direction; }\n",
					filename: bindingFile,
					options: [{ allowlist: [], extraNames }],
					errors: [{ messageId: "measure", data: { kind: "getComputedStyle", symbol: "moveFocus", file: bindingFile } }],
				},
			],
		});
	});

	it("SCH1 HB2: every committed allowlist entry is complete and a closedBy names a W-requirement", () => {
		const allowlist = JSON.parse(
			readFileSync(path.join(repoRoot, "scripts/unscheduled-measure-allowlist.json"), "utf8"),
		);
		for (const committed of allowlist.entries) {
			expect(missingAllowlistField(committed), committed.file).toBeNull();
			if (committed.closedBy !== undefined) {
				expect(committed.closedBy).toMatch(/^W\d+\.R\d+$/);
			}
		}
	});
});
