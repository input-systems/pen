import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";
import {
	isDeepImport,
	noPenDeepImports,
} from "../rules/noPenDeepImports.js";

const ruleTester = new RuleTester({
	languageOptions: { parser: tseslint.parser },
});

const packages = {
	names: ["@input/pen-core", "@input/pen-dom"],
	exports: {
		"@input/pen-core": ["."],
		"@input/pen-dom": [".", "./utils/*"],
	},
};

describe("no-pen-deep-imports (API4)", () => {
	it("API4: treats /src/, /dist/, and unpublished subpaths as deep", () => {
		expect(
			isDeepImport("@input/pen-core", {
				names: packages.names,
				exports: new Map(
					Object.entries(packages.exports).map(([name, keys]) => [
						name,
						new Set(keys),
					]),
				),
			}),
		).toBe(false);
		expect(
			isDeepImport("@input/pen-dom/utils/environment", {
				names: packages.names,
				exports: new Map([
					["@input/pen-core", new Set(["."])],
					["@input/pen-dom", new Set([".", "./utils/*"])],
				]),
			}),
		).toBe(false);
		expect(
			isDeepImport("@input/pen-core/src/editor.ts", {
				names: packages.names,
				exports: new Map([["@input/pen-core", new Set(["."])]]),
			}),
		).toBe(true);
		expect(
			isDeepImport("@input/pen-core/secret", {
				names: packages.names,
				exports: new Map([["@input/pen-core", new Set(["."])]]),
			}),
		).toBe(true);
	});

	it("API4: flags deep imports and leaves published specifiers alone", () => {
		ruleTester.run("no-pen-deep-imports", noPenDeepImports, {
			valid: [
				{
					code: 'import { createEditor } from "@input/pen-core";\n',
					filename: "packages/extensions/snapshots/src/index.ts",
					options: [{ packages }],
				},
				{
					code: 'export { isDevelopmentEnvironment } from "@input/pen-dom/utils/environment";\n',
					filename: "packages/rendering/react/src/utils/environment.ts",
					options: [{ packages }],
				},
			],
			invalid: [
				{
					code: 'import { createEditor } from "@input/pen-core/src/editor";\n',
					filename: "packages/extensions/snapshots/src/index.ts",
					options: [{ packages }],
					errors: [
						{
							messageId: "deep",
							data: {
								specifier: "@input/pen-core/src/editor",
							},
						},
					],
				},
				{
					code: 'const core = require("@input/pen-core/dist/index.js");\n',
					filename: "packages/extensions/snapshots/src/index.ts",
					options: [{ packages }],
					errors: [
						{
							messageId: "deep",
							data: {
								specifier: "@input/pen-core/dist/index.js",
							},
						},
					],
				},
			],
		});
	});
});
