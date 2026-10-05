import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";
import { rules } from "../index.js";

const jsxTester = new RuleTester({
	languageOptions: {
		parser: tseslint.parser,
		parserOptions: { ecmaFeatures: { jsx: true } },
	},
});

const tsTester = new RuleTester({
	languageOptions: { parser: tseslint.parser },
});

function expectRuleErrors(tester, ruleId, testCase) {
	tester.run(`can-it-fail:${ruleId}`, rules[ruleId], {
		valid: [],
		invalid: [testCase],
	});
}

/** Each title with the violations that must error by name. */
const cases = [
	[
		"no-html-injection-sinks errors by name on innerHTML assignment",
		{
			rule: "no-html-injection-sinks",
			code: 'element.innerHTML = "<b>x</b>";\n',
			errors: [{ messageId: "propertyAssignment" }],
		},
	],
	[
		"no-unescaped-markup-concat errors by name on interpolated markup",
		{
			rule: "no-unescaped-markup-concat",
			code: 'const html = `<img src="${src}" />`;\n',
			errors: [{ messageId: "unescaped" }],
		},
	],
	[
		"no-above-floor-api errors by name on bare structuredClone",
		{
			rule: "no-above-floor-api",
			code: "const copy = structuredClone(value);\n",
			filename: "packages/core/src/seeded-above-floor.ts",
			errors: [{ messageId: "bareUse" }],
		},
	],
	[
		"no-bare-random-uuid errors by name on crypto.randomUUID, including a feature test",
		{
			rule: "no-bare-random-uuid",
			code: 'const has = typeof crypto.randomUUID === "function";\n',
			filename: "packages/core/src/seeded-random-uuid.ts",
			errors: [{ messageId: "bareCall" }],
		},
	],
	[
		"no-framework-free-modules-in-renderers errors by name on a leftover module",
		{
			rule: "no-framework-free-modules-in-renderers",
			code: "export function leftover() { return 1; }\n",
			filename:
				"packages/rendering/react/src/seeded-framework-free.ts",
			errors: [{ messageId: "frameworkFree" }],
		},
	],
	[
		"no-module-scope-browser-globals errors by name on document at module scope",
		{
			rule: "no-module-scope-browser-globals",
			code: "const title = document.title;\n",
			filename: "packages/core/src/seeded-module-scope.ts",
			errors: [{ messageId: "moduleScope" }],
		},
	],
	[
		"no-user-facing-literals errors by name on button copy",
		{
			rule: "no-user-facing-literals",
			tester: jsxTester,
			code: "export function Label() { return <button>Accept</button>; }\n",
			filename: "packages/rendering/react/src/seeded-literal.tsx",
			errors: [{ messageId: "jsxText" }],
		},
	],
	[
		"no-ascii-word-boundaries errors by name on a \b regex",
		{
			rule: "no-ascii-word-boundaries",
			code: "const word = /\\bword\\b/;\n",
			filename: "packages/extensions/search/src/seeded-ascii-word.ts",
			errors: [{ messageId: "asciiWord" }],
		},
	],
	[
		"no-bare-case-folding errors by name on toLowerCase in a matching path",
		{
			rule: "no-bare-case-folding",
			code: "const lower = query.toLowerCase();\n",
			filename: "packages/core/src/seeded-case-fold.ts",
			errors: [{ messageId: "bareFold" }],
		},
	],
	[
		"no-implicit-locale errors by name on localeCompare without a locale",
		{
			rule: "no-implicit-locale",
			code: "const order = left.localeCompare(right);\n",
			filename: "packages/core/src/seeded-implicit-locale.ts",
			errors: [{ messageId: "localeCompare" }],
		},
	],
	[
		"no-aria-hidden-visible errors by name on aria-hidden=true, and leaves setAttribute string true as the ARIA form",
		{
			rule: "no-aria-hidden-visible",
			tester: jsxTester,
			code: 'export function Chip() { return <span aria-hidden="true" />;\n}\n',
			filename: "packages/rendering/react/src/seeded-aria-hidden.tsx",
			errors: [{ messageId: "hidden" }],
		},
		{
			rule: "no-aria-hidden-visible",
			code: 'element.setAttribute("aria-hidden", "true");\n',
			filename: "packages/rendering/dom/src/seeded-aria-hidden.ts",
			errors: [{ messageId: "hidden" }],
		},
	],
	[
		"no-unstyled-focus errors by name on outline none",
		{
			rule: "no-unstyled-focus",
			code: 'export const style = { outline: "none" };\n',
			filename:
				"packages/rendering/react/src/seeded-unstyled-focus.ts",
			errors: [{ messageId: "outlineNone" }],
		},
	],
	[
		"no-dom-selection-read errors by name on a selection read outside the reader",
		{
			rule: "no-dom-selection-read",
			code: "export function seeded() {\n\treturn window.getSelection();\n}\n",
			filename: "packages/rendering/dom/src/seeded-selection-read.ts",
			errors: [{ messageId: "read" }],
		},
	],
	[
		"no-dom-selection-write errors by name on a selection write outside the projector",
		{
			rule: "no-dom-selection-write",
			code: "export function seeded() {\n\twindow.getSelection()?.removeAllRanges();\n}\n",
			filename:
				"packages/rendering/dom/src/seeded-selection-write.ts",
			errors: [{ messageId: "write" }],
		},
	],
	[
		"no-direct-dom-focus errors by name on an element focus outside the focus controller",
		{
			rule: "no-direct-dom-focus",
			code: "export function seeded(root: HTMLElement) {\n\troot.focus();\n}\n",
			filename: "packages/rendering/dom/src/seeded-direct-focus.ts",
			errors: [{ messageId: "focus" }],
		},
	],
	[
		"no-unscoped-decoration-source errors by name on a function-form decorations source",
		{
			rule: "no-unscoped-decoration-source",
			code: "export function seededExtension() {\n\treturn decorationsFacet.of(() => createDecorationSet([]));\n}\n",
			filename:
				"packages/extensions/search/src/seeded-unscoped-decorations.ts",
			errors: [{ messageId: "unscoped" }],
		},
	],
	[
		"no-binding-editor-subscriptions errors by name on a per-block commit listener",
		{
			rule: "no-binding-editor-subscriptions",
			code: 'export function useSeededBlock(editor) {\n\treturn editor.on("commit", () => {});\n}\n',
			filename:
				"packages/rendering/react/src/hooks/seeded-block-subscription.ts",
			errors: [{ messageId: "subscription" }],
		},
	],
	[
		"no-v1-extension-fields errors by name on keyBindings",
		{
			rule: "no-v1-extension-fields",
			code: 'import { defineExtension } from "@input/pen-core";\nexport const ext = defineExtension({ name: "x", keyBindings: [] });\n',
			filename:
				"packages/extensions/snapshots/src/seeded-v1-field.ts",
			errors: [{ messageId: "v1Field" }],
		},
	],
	[
		"no-selection-timers errors by name on setTimeout in a selection module",
		{
			rule: "no-selection-timers",
			code: "setTimeout(() => {}, 0);\n",
			filename:
				"packages/rendering/dom/src/field-editor/selectionBridge.ts",
			errors: [{ messageId: "timer" }],
		},
	],
	[
		"no-selection-timers errors by name on a *Selection* module the prefix matcher used to miss",
		{
			rule: "no-selection-timers",
			code: "requestAnimationFrame(() => {});\n",
			filename:
				"packages/core/src/editor/editorSelectionMutations.ts",
			errors: [{ messageId: "timer" }],
		},
	],
	[
		"no-selection-timers errors by name on a protected module the basename matcher used to miss",
		{
			rule: "no-selection-timers",
			code: "function seededS4Timer() { setTimeout(() => {}, 0); }\n",
			filename: "packages/core/src/selection/transitions.ts",
			errors: [
				{
					messageId: "timer",
					data: {
						kind: "setTimeout",
						symbol: "seededS4Timer",
						file: "packages/core/src/selection/transitions.ts",
					},
				},
			],
		},
	],
	[
		"no-ascii-word-boundaries errors by name on core editor selection, which the config glob packages/core/src/selection/** does not contain",
		{
			rule: "no-ascii-word-boundaries",
			code: "const word = /\\bword\\b/;\n",
			filename: "packages/core/src/editor/selection.ts",
			errors: [{ messageId: "asciiWord" }],
		},
	],
	[
		"no-new-ops errors by name on an eleventh DocumentOp member",
		{
			rule: "no-new-ops",
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
		},
	],
	// The ten sanctioned members are all still present here, so a count that
	// filtered on the *Op naming pattern would see exactly ten and pass while
	// an eleventh member rode along anonymously. Counting every member is
	// what makes this case error.
	[
		"no-new-ops errors by name on an inline eleventh member that evades the *Op naming pattern",
		{
			rule: "no-new-ops",
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
		},
	],
	[
		"no-unscheduled-measure errors by name on getBoundingClientRect",
		{
			rule: "no-unscheduled-measure",
			code: "function overlayPaint() { return el.getBoundingClientRect(); }\n",
			filename: "packages/rendering/dom/src/seeded-measure.ts",
			errors: [{ messageId: "measure" }],
		},
	],
	[
		"no-bidi-override errors by name on a bidi-override style",
		{
			rule: "no-bidi-override",
			code: 'export const style = { unicodeBidi: "bidi-override" };\n',
			filename: "packages/rendering/dom/src/seeded-bidi.ts",
			errors: [{ messageId: "override" }],
		},
	],
	[
		"no-json-stringify-signatures errors by name on JSON.stringify",
		{
			rule: "no-json-stringify-signatures",
			code: "function signature() { return JSON.stringify(summary); }\n",
			filename: "packages/core/src/seeded-stringify.ts",
			errors: [{ messageId: "stringify" }],
		},
	],
	[
		"no-selection-state-properties errors by name on sel.isCollapsed",
		{
			rule: "no-selection-state-properties",
			code: "if (sel.isCollapsed) { return; }\n",
			filename: "packages/core/src/seeded-selection-props.ts",
			errors: [{ messageId: "property" }],
		},
	],
	[
		"no-pen-deep-imports errors by name on a /src/ specifier",
		{
			rule: "no-pen-deep-imports",
			code: 'import { createEditor } from "@input/pen-core/src/editor";\n',
			filename: "packages/extensions/snapshots/src/seeded-deep.ts",
			errors: [{ messageId: "deep" }],
		},
	],
	[
		"require-selection-origin errors by name on an originless editor setter call",
		{
			rule: "require-selection-origin",
			code: "export function seeded(editor) {\n\teditor.selectBlock(\"x\");\n}\n",
			filename: "packages/rendering/dom/src/seeded-origin.ts",
			errors: [{ messageId: "originless" }],
		},
	],
	[
		"no-overlay-binding-measure errors by name on a measuring caret binding",
		{
			rule: "no-overlay-binding-measure",
			code: "export function seeded(el) {\n\treturn el.getBoundingClientRect();\n}\n",
			filename:
				"packages/rendering/react/src/primitives/editor/seededCaretOverlay.tsx",
			errors: [{ messageId: "measure" }],
		},
	],
];

describe("per-rule can-it-fail (write a violation, error by name)", () => {
	it.each(cases)("%s", (_title, ...violations) => {
		for (const { rule, tester = tsTester, ...testCase } of violations) {
			expectRuleErrors(tester, rule, testCase);
		}
	});

	it("plugin ships twenty-seven rules and each can-it-fail case is registered", () => {
		expect(Object.keys(rules).sort()).toEqual([
			"no-above-floor-api",
			"no-aria-hidden-visible",
			"no-ascii-word-boundaries",
			"no-bare-case-folding",
			"no-bare-random-uuid",
			"no-bidi-override",
			"no-binding-editor-subscriptions",
			"no-direct-dom-focus",
			"no-dom-selection-read",
			"no-dom-selection-write",
			"no-framework-free-modules-in-renderers",
			"no-html-injection-sinks",
			"no-implicit-locale",
			"no-json-stringify-signatures",
			"no-module-scope-browser-globals",
			"no-new-ops",
			"no-overlay-binding-measure",
			"no-pen-deep-imports",
			"no-selection-state-properties",
			"no-selection-timers",
			"no-unescaped-markup-concat",
			"no-unscheduled-measure",
			"no-unscoped-decoration-source",
			"no-unstyled-focus",
			"no-user-facing-literals",
			"no-v1-extension-fields",
			"require-selection-origin",
		]);
	});
});
