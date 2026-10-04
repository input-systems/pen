import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, it } from "vitest";
import { noBidiOverride } from "../rules/noBidiOverride.js";

const ruleTester = new RuleTester({
	languageOptions: { parser: tseslint.parser },
});

const file = "packages/rendering/dom/src/seeded-bidi.ts";

describe("no-bidi-override (RI1)", () => {
	it("RI1: flags bidi-override and leaves isolate alone", () => {
		ruleTester.run("no-bidi-override", noBidiOverride, {
			valid: [
				{
					code: 'export const style = { unicodeBidi: "isolate" };\n',
					filename: file,
				},
			],
			invalid: [
				{
					code: 'export const style = { unicodeBidi: "bidi-override" };\n',
					filename: file,
					errors: [{ messageId: "override", data: { file } }],
				},
			],
		});
	});
});
