import { readFileSync } from "node:fs";
import path from "node:path";
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";
import { rules } from "../index.js";

// Derived, not hardcoded: the unusedAllowlist case needs a waiver that is
// actually in the allowlist, so naming one directly makes this suite go red
// whenever a waiver retires — which is exactly what happened to
// `applySelectionUntilNextFrame`.
const selectionTimersAllowlist = JSON.parse(
	readFileSync(
		path.join(
			import.meta.dirname,
			"../rules/no-selection-timers-allowlist.json",
		),
		"utf8",
	),
);
const liveTimerWaiver = selectionTimersAllowlist.entries.find(
	(entry) => entry.kind === "requestAnimationFrame",
);

const jsxTester = new RuleTester({
	languageOptions: {
		parser: tseslint.parser,
		parserOptions: { ecmaFeatures: { jsx: true } },
	},
});

const tsTester = new RuleTester({
	languageOptions: { parser: tseslint.parser },
});

function expectRuleErrors(tester, ruleId, rule, { code, filename, errors }) {
	const testCase = { code, errors };
	if (filename) {
		testCase.filename = filename;
	}
	tester.run(`can-it-fail:${ruleId}`, rule, {
		valid: [],
		invalid: [testCase],
	});
}

describe("per-rule can-it-fail (write a violation, error by name)", () => {
	it("no-html-injection-sinks errors by name on innerHTML assignment", () => {
		expectRuleErrors(
			tsTester,
			"no-html-injection-sinks",
			rules["no-html-injection-sinks"],
			{
				code: 'element.innerHTML = "<b>x</b>";\n',
				errors: [{ messageId: "propertyAssignment" }],
			},
		);
	});

	it("no-unescaped-markup-concat errors by name on interpolated markup", () => {
		expectRuleErrors(
			tsTester,
			"no-unescaped-markup-concat",
			rules["no-unescaped-markup-concat"],
			{
				code: 'const html = `<img src="${src}" />`;\n',
				errors: [{ messageId: "unescaped" }],
			},
		);
	});

	it("no-above-floor-api errors by name on bare structuredClone", () => {
		expectRuleErrors(
			tsTester,
			"no-above-floor-api",
			rules["no-above-floor-api"],
			{
				code: "const copy = structuredClone(value);\n",
				filename: "packages/core/src/seeded-above-floor.ts",
				errors: [{ messageId: "bareUse" }],
			},
		);
	});

	it("no-bare-random-uuid errors by name on crypto.randomUUID, including a feature test", () => {
		expectRuleErrors(
			tsTester,
			"no-bare-random-uuid",
			rules["no-bare-random-uuid"],
			{
				code: 'const has = typeof crypto.randomUUID === "function";\n',
				filename: "packages/core/src/seeded-random-uuid.ts",
				errors: [{ messageId: "bareCall" }],
			},
		);
	});

	it("no-framework-free-modules-in-renderers errors by name on a leftover module", () => {
		expectRuleErrors(
			tsTester,
			"no-framework-free-modules-in-renderers",
			rules["no-framework-free-modules-in-renderers"],
			{
				code: "export function leftover() { return 1; }\n",
				filename:
					"packages/rendering/react/src/seeded-framework-free.ts",
				errors: [{ messageId: "frameworkFree" }],
			},
		);
	});

	it("no-module-scope-browser-globals errors by name on document at module scope", () => {
		expectRuleErrors(
			tsTester,
			"no-module-scope-browser-globals",
			rules["no-module-scope-browser-globals"],
			{
				code: "const title = document.title;\n",
				filename: "packages/core/src/seeded-module-scope.ts",
				errors: [{ messageId: "moduleScope" }],
			},
		);
	});

	it("no-user-facing-literals errors by name on button copy", () => {
		expectRuleErrors(
			jsxTester,
			"no-user-facing-literals",
			rules["no-user-facing-literals"],
			{
				code: "export function Label() { return <button>Accept</button>; }\n",
				filename: "packages/rendering/react/src/seeded-literal.tsx",
				errors: [{ messageId: "jsxText" }],
			},
		);
	});

	it("no-ascii-word-boundaries errors by name on a \b regex", () => {
		expectRuleErrors(
			tsTester,
			"no-ascii-word-boundaries",
			rules["no-ascii-word-boundaries"],
			{
				code: "const word = /\\bword\\b/;\n",
				filename: "packages/extensions/search/src/seeded-ascii-word.ts",
				errors: [{ messageId: "asciiWord" }],
			},
		);
	});

	it("no-bare-case-folding errors by name on toLowerCase in a matching path", () => {
		expectRuleErrors(
			tsTester,
			"no-bare-case-folding",
			rules["no-bare-case-folding"],
			{
				code: "const lower = query.toLowerCase();\n",
				filename: "packages/core/src/seeded-case-fold.ts",
				errors: [{ messageId: "bareFold" }],
			},
		);
	});

	it("no-implicit-locale errors by name on localeCompare without a locale", () => {
		expectRuleErrors(
			tsTester,
			"no-implicit-locale",
			rules["no-implicit-locale"],
			{
				code: "const order = left.localeCompare(right);\n",
				filename: "packages/core/src/seeded-implicit-locale.ts",
				errors: [{ messageId: "localeCompare" }],
			},
		);
	});

	it("no-aria-hidden-visible errors by name on aria-hidden=true, and leaves setAttribute string true as the ARIA form", () => {
		expectRuleErrors(
			jsxTester,
			"no-aria-hidden-visible",
			rules["no-aria-hidden-visible"],
			{
				code: 'export function Chip() { return <span aria-hidden="true" />;\n}\n',
				filename: "packages/rendering/react/src/seeded-aria-hidden.tsx",
				errors: [{ messageId: "hidden" }],
			},
		);
		expectRuleErrors(
			tsTester,
			"no-aria-hidden-visible",
			rules["no-aria-hidden-visible"],
			{
				code: 'element.setAttribute("aria-hidden", "true");\n',
				filename: "packages/rendering/dom/src/seeded-aria-hidden.ts",
				errors: [{ messageId: "hidden" }],
			},
		);
	});

	it("no-unstyled-focus errors by name on outline none", () => {
		expectRuleErrors(
			tsTester,
			"no-unstyled-focus",
			rules["no-unstyled-focus"],
			{
				code: 'export const style = { outline: "none" };\n',
				filename:
					"packages/rendering/react/src/seeded-unstyled-focus.ts",
				errors: [{ messageId: "outlineNone" }],
			},
		);
	});

	it("no-dom-selection-read errors by name on a selection read outside the reader", () => {
		expectRuleErrors(
			tsTester,
			"no-dom-selection-read",
			rules["no-dom-selection-read"],
			{
				code: "export function seeded() {\n\treturn window.getSelection();\n}\n",
				filename: "packages/rendering/dom/src/seeded-selection-read.ts",
				errors: [{ messageId: "read" }],
			},
		);
	});

	it("no-dom-selection-write errors by name on a selection write outside the projector", () => {
		expectRuleErrors(
			tsTester,
			"no-dom-selection-write",
			rules["no-dom-selection-write"],
			{
				code: "export function seeded() {\n\twindow.getSelection()?.removeAllRanges();\n}\n",
				filename:
					"packages/rendering/dom/src/seeded-selection-write.ts",
				errors: [{ messageId: "write" }],
			},
		);
	});

	it("no-unscoped-decoration-source errors by name on a function-form decorations source", () => {
		expectRuleErrors(
			tsTester,
			"no-unscoped-decoration-source",
			rules["no-unscoped-decoration-source"],
			{
				code: "export function seededExtension() {\n\treturn decorationsFacet.of(() => createDecorationSet([]));\n}\n",
				filename:
					"packages/extensions/search/src/seeded-unscoped-decorations.ts",
				errors: [{ messageId: "unscoped" }],
			},
		);
	});

	it("no-v1-extension-fields errors by name on keyBindings", () => {
		expectRuleErrors(
			tsTester,
			"no-v1-extension-fields",
			rules["no-v1-extension-fields"],
			{
				code: 'import { defineExtension } from "@input/pen-core";\nexport const ext = defineExtension({ name: "x", keyBindings: [] });\n',
				filename:
					"packages/extensions/snapshots/src/seeded-v1-field.ts",
				errors: [{ messageId: "v1Field" }],
			},
		);
	});

	it("no-selection-timers errors by name on setTimeout in a selection module", () => {
		expectRuleErrors(
			tsTester,
			"no-selection-timers",
			rules["no-selection-timers"],
			{
				code: "setTimeout(() => {}, 0);\n",
				filename:
					"packages/rendering/dom/src/field-editor/selectionBridge.ts",
				errors: [{ messageId: "timer" }],
			},
		);
	});

	it("no-selection-timers errors by name on a *Selection* module the prefix matcher used to miss", () => {
		expectRuleErrors(
			tsTester,
			"no-selection-timers",
			rules["no-selection-timers"],
			{
				code: "requestAnimationFrame(() => {});\n",
				filename:
					"packages/core/src/editor/editorSelectionMutations.ts",
				errors: [{ messageId: "timer" }],
			},
		);
	});

	it("no-selection-timers errors by name on a protected module the basename matcher used to miss", () => {
		expectRuleErrors(
			tsTester,
			"no-selection-timers",
			rules["no-selection-timers"],
			{
				code: "function seededS4Timer() { setTimeout(() => {}, 0); }\n",
				filename: "packages/core/src/editor/caretPositions.ts",
				errors: [
					{
						messageId: "timer",
						data: {
							kind: "setTimeout",
							symbol: "seededS4Timer",
							file: "packages/core/src/editor/caretPositions.ts",
						},
					},
				],
			},
		);
	});

	it("no-selection-timers unusedAllowlist errors by name when a waiver is not consumed", () => {
		if (!liveTimerWaiver) {
			expect(selectionTimersAllowlist.entries).toEqual([]);
			return;
		}
		expectRuleErrors(
			tsTester,
			"no-selection-timers",
			rules["no-selection-timers"],
			{
				code: `export function ${liveTimerWaiver.symbol}() { void 0; }\n`,
				filename: liveTimerWaiver.file,
				errors: [{ messageId: "unusedAllowlist" }],
			},
		);
	});

	it("no-ascii-word-boundaries errors by name on core editor selection, which the config glob packages/core/src/selection/** does not contain", () => {
		expectRuleErrors(
			tsTester,
			"no-ascii-word-boundaries",
			rules["no-ascii-word-boundaries"],
			{
				code: "const word = /\\bword\\b/;\n",
				filename: "packages/core/src/editor/selection.ts",
				errors: [{ messageId: "asciiWord" }],
			},
		);
	});

	it("no-new-ops errors by name on an eleventh DocumentOp member", () => {
		expectRuleErrors(tsTester, "no-new-ops", rules["no-new-ops"], {
			code: `export type DocumentOp =\n${[
				"SpliceTextOp",
				"FormatTextOp",
				"InsertBlockOp",
				"DeleteBlockOp",
				"MoveBlockOp",
				"SetPropsOp",
				"SetMetaOp",
				"GridOp",
				"AppOp",
				"StreamOpenOp",
				"EleventhOp",
			]
				.map((name) => `\t| ${name}`)
				.join("\n")};\n`,
			filename: "packages/types/src/types/ops.ts",
			errors: [{ messageId: "count", data: { count: "11" } }],
		});
	});

	// The ten sanctioned members are all still present here, so a count that
	// filtered on the *Op naming pattern would see exactly ten and pass while
	// an eleventh member rode along anonymously. Counting every member is
	// what makes this case error.
	it("no-new-ops errors by name on an inline eleventh member that evades the *Op naming pattern", () => {
		expectRuleErrors(tsTester, "no-new-ops", rules["no-new-ops"], {
			code: `export type DocumentOp =\n${[
				"SpliceTextOp",
				"FormatTextOp",
				"InsertBlockOp",
				"DeleteBlockOp",
				"MoveBlockOp",
				"SetPropsOp",
				"SetMetaOp",
				"GridOp",
				"AppOp",
				"StreamOpenOp",
				'{ type: "smuggled" }',
			]
				.map((name) => `\t| ${name}`)
				.join("\n")};\n`,
			filename: "packages/types/src/types/ops.ts",
			errors: [
				{ messageId: "count", data: { count: "11" } },
				{ messageId: "anonymous", data: { index: "11" } },
			],
		});
	});

	it("no-unscheduled-measure errors by name on getBoundingClientRect", () => {
		expectRuleErrors(
			tsTester,
			"no-unscheduled-measure",
			rules["no-unscheduled-measure"],
			{
				code: "function overlayPaint() { return el.getBoundingClientRect(); }\n",
				filename: "packages/rendering/dom/src/seeded-measure.ts",
				errors: [{ messageId: "measure" }],
			},
		);
	});

	it("no-bidi-override errors by name on a bidi-override style", () => {
		expectRuleErrors(
			tsTester,
			"no-bidi-override",
			rules["no-bidi-override"],
			{
				code: 'export const style = { unicodeBidi: "bidi-override" };\n',
				filename: "packages/rendering/dom/src/seeded-bidi.ts",
				errors: [{ messageId: "override" }],
			},
		);
	});

	it("no-json-stringify-signatures errors by name on JSON.stringify", () => {
		expectRuleErrors(
			tsTester,
			"no-json-stringify-signatures",
			rules["no-json-stringify-signatures"],
			{
				code: "function signature() { return JSON.stringify(summary); }\n",
				filename: "packages/core/src/seeded-stringify.ts",
				errors: [{ messageId: "stringify" }],
			},
		);
	});

	it("no-selection-state-properties errors by name on sel.isCollapsed", () => {
		expectRuleErrors(
			tsTester,
			"no-selection-state-properties",
			rules["no-selection-state-properties"],
			{
				code: "if (sel.isCollapsed) { return; }\n",
				filename: "packages/core/src/seeded-selection-props.ts",
				errors: [{ messageId: "property" }],
			},
		);
	});

	it("no-pen-deep-imports errors by name on a /src/ specifier", () => {
		expectRuleErrors(
			tsTester,
			"no-pen-deep-imports",
			rules["no-pen-deep-imports"],
			{
				code: 'import { createEditor } from "@input/pen-core/src/editor";\n',
				filename: "packages/extensions/snapshots/src/seeded-deep.ts",
				errors: [{ messageId: "deep" }],
			},
		);
	});

	it("plugin ships twenty-three rules and each can-it-fail case is registered", () => {
		expect(Object.keys(rules).sort()).toEqual([
			"no-above-floor-api",
			"no-aria-hidden-visible",
			"no-ascii-word-boundaries",
			"no-bare-case-folding",
			"no-bare-random-uuid",
			"no-bidi-override",
			"no-dom-selection-read",
			"no-dom-selection-write",
			"no-framework-free-modules-in-renderers",
			"no-html-injection-sinks",
			"no-implicit-locale",
			"no-json-stringify-signatures",
			"no-module-scope-browser-globals",
			"no-new-ops",
			"no-pen-deep-imports",
			"no-selection-state-properties",
			"no-selection-timers",
			"no-unescaped-markup-concat",
			"no-unscheduled-measure",
			"no-unscoped-decoration-source",
			"no-unstyled-focus",
			"no-user-facing-literals",
			"no-v1-extension-fields",
		]);
	});
});
