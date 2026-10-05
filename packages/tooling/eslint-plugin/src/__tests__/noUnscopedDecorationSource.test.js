import { readFileSync } from "node:fs";
import path from "node:path";
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";
import {
	missingDecorationAllowlistField,
	noUnscopedDecorationSource,
} from "../rules/noUnscopedDecorationSource.js";

const ruleTester = new RuleTester({ languageOptions: { parser: tseslint.parser } });
const repoRoot = path.resolve(import.meta.dirname, "../../../../..");
const FILE = path.join(repoRoot, "packages/extensions/example/src/extension.ts");
const RELATIVE = "packages/extensions/example/src/extension.ts";

const functionForm = `
export function exampleExtension() {
	return { facets: [decorationsFacet.of(() => createDecorationSet([]))] };
}
`;
const scopedForm = `
export function exampleExtension() {
	return { facets: [decorationsFacet.of(scopedDecorationSource({ decorate: () => [] }))] };
}
`;
const entry = { file: RELATIVE, symbol: "exampleExtension", reason: "test", closedBy: "permitted" };

describe("pen/no-unscoped-decoration-source", () => {
	it("SCALE2: pen/no-unscoped-decoration-source flags function-form sources and orphaned allowlist entries", () => {
		ruleTester.run("no-unscoped-decoration-source", noUnscopedDecorationSource, {
			valid: [
				{ code: scopedForm, filename: FILE, options: [{ allowlist: [] }] },
				{ code: functionForm, filename: FILE, options: [{ allowlist: [entry] }] },
			],
			invalid: [
				{
					code: functionForm,
					filename: FILE,
					options: [{ allowlist: [] }],
					errors: [{ messageId: "unscoped" }],
				},
				{
					code: scopedForm,
					filename: FILE,
					options: [{ allowlist: [entry] }],
					errors: [{ messageId: "orphanedAllowlist" }],
				},
				{
					code: functionForm,
					filename: FILE,
					options: [{ allowlist: [{ ...entry, closedBy: "" }] }],
					errors: [{ messageId: "incompleteAllowlist" }, { messageId: "unscoped" }],
				},
			],
		});
	});

	it("SCALE2: every committed allowlist entry is complete and names a permitted state or a W-requirement", () => {
		const allowlist = JSON.parse(
			readFileSync(path.join(repoRoot, "scripts/unscoped-decoration-source-allowlist.json"), "utf8"),
		);
		for (const committed of allowlist.entries) {
			expect(missingDecorationAllowlistField(committed), committed.file).toBeNull();
			expect(committed.closedBy).toMatch(/^(permitted|W\d+\.R\d+)$/);
		}
	});
});
