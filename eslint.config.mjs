import { createRequire } from "node:module";
import js from "@eslint/js";
import pen from "@input/pen-eslint-plugin";
import globals from "globals";
import tseslint from "typescript-eslint";

const require = createRequire(import.meta.url);
const selectionTimers = require("./packages/tooling/eslint-plugin/src/rules/no-selection-timers-allowlist.json");

// HB2: layout metrics the React and Vue bindings may not read outside the
// allowlist. Rect and hit-test reads are SCH1's base set in every renderer.
const BINDING_LAYOUT_METRIC_NAMES = [
	"offsetTop",
	"offsetLeft",
	"offsetWidth",
	"offsetHeight",
	"clientTop",
	"clientWidth",
	"clientHeight",
	"scrollTop",
	"scrollWidth",
	"scrollHeight",
	"getComputedStyle",
	"ResizeObserver",
	"IntersectionObserver",
];

// CH2 (spec/rules/reliability.md): this config is where the repo's structural
// invariants are enforced. It is permissive on purpose — a rule that would demand mass
// edits lands as a warning until the cleanup it implies is done, so the error set stays
// meaningful and the gate stays green.
//
// The warning count is ratcheted: `lint:eslint` passes `--max-warnings 1215`, the count
// at the time the cap was introduced. Like MAX_UNDOCUMENTED it may only be lowered, and
// only in the same change that removes the warnings. Without the cap this was the one
// gate in the repo that could drift upward without limit, which is what let the count
// reach 1215 in the first place. Promoting a rule below from "warn" to "error" is the
// intended way down; lowering the cap records the result.

export default tseslint.config(
	{
		ignores: [
			"**/dist/**",
			"**/.generated/**",
			// Local agent worktrees (gitignored) carry full repo copies.
			".claude/**",
			"**/node_modules/**",
			"**/coverage/**",
			"**/.turbo/**",
			"**/playwright-report/**",
			"**/test-results*/**",
			"**/*.d.ts",
			"playground/dist/**",
		],
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		languageOptions: {
			globals: { ...globals.browser, ...globals.node },
		},
		plugins: { pen },
		rules: {
			"pen/no-html-injection-sinks": "error",

			// S4: selection paths get no timers, microtask or promise
			// deferrals, async/await, setter-calling scheduler callbacks, or
			// retry counters. Scope is the allowlist's `modules` paths plus a
			// basename-contains-`selection` net so a new selectionReader.ts
			// cannot silently escape.
			// Do not add a `files:` glob; the rule self-scopes from this list.
			"pen/no-selection-timers": [
				"error",
				{
					modules: selectionTimers.modules,
					outOfScope: selectionTimers.outOfScope,
				},
			],

			// HOST4: crypto.randomUUID is secure-context-only, so it throws on plain-HTTP origins
			// and on Safari < 15.4. generateId owns the feature test and fallback (F24).
			"pen/no-bare-random-uuid": "error",

			// SEC8: no dynamic code, so Pen stays functional under `script-src 'self'`.
			"no-eval": "error",
			"no-new-func": "error",
			"no-implied-eval": "error",

			// LOC3: every Intl constructor and localeCompare takes an explicit locale.
			"pen/no-implicit-locale": "error",
		},
	},
	{
		// SCH1 / RI1: geometry reads stay scheduled; marks never introduce
		// bidi-override. Allowlists live in scripts/.
		files: ["packages/rendering/**/*.{ts,tsx,js,jsx}"],
		ignores: ["**/__tests__/**", "**/*.test.ts", "**/*.test.tsx"],
		rules: {
			"pen/no-unscheduled-measure": "error",
			"pen/no-bidi-override": "error",
		},
	},
	{
		// SCALE2: JSON.stringify is not a change-detection signature in
		// core or rendering runtime. Wire-format / display / clone sites
		// are in scripts/json-stringify-allowlist.json.
		files: [
			"packages/rendering/**/*.{ts,tsx,js,jsx}",
			"packages/core/**/*.{ts,tsx,js,jsx}",
		],
		ignores: ["**/__tests__/**", "**/*.test.ts", "**/*.test.tsx"],
		rules: {
			"pen/no-json-stringify-signatures": "error",
		},
	},
	{
		// Selection-helper conversion: SelectionState receivers read
		// through core helpers. Browser Selection and snapshot records
		// are in scripts/selection-state-properties-allowlist.json.
		files: ["packages/**/*.{ts,tsx}"],
		ignores: [
			"**/__tests__/**",
			"**/*.test.ts",
			"**/*.test.tsx",
			"**/*.spec.ts",
		],
		rules: {
			"pen/no-selection-state-properties": "error",
		},
	},
	{
		// API4: no @input/pen-* import through /src/, /dist/, or an
		// unpublished subpath. Allowlist: scripts/pen-deep-imports-allowlist.json.
		files: [
			"packages/**/*.{ts,tsx,js,jsx,mjs,cjs}",
			"examples/**/*.{ts,tsx,js,jsx,mjs,cjs}",
			"playground/**/*.{ts,tsx,js,jsx,mjs,cjs}",
			"internal/**/*.{ts,tsx,js,jsx,mjs,cjs}",
		],
		rules: {
			"pen/no-pen-deep-imports": "error",
		},
	},
	{
		// SEC5: exporters and schema toHTML must not concatenate unescaped
		// document content into markup. Disable a site with a comment naming
		// SEC5, "already-serialized", "clamped", or "justified".
		files: [
			"packages/extensions/interop/src/**/*.{ts,tsx}",
			"packages/schema/src/**/*.{ts,tsx}",
			"packages/rendering/dom/src/utils/clipboardSerialization.ts",
			"packages/rendering/dom/src/utils/tableCellClipboard.ts",
		],
		ignores: ["**/__tests__/**", "**/*.test.ts"],
		rules: {
			"pen/no-unescaped-markup-concat": "error",
		},
	},
	{
		// LOC1: library chrome copy comes from the catalog. Tests and playground
		// hosts may keep literals. Disable a site with an eslint-disable comment
		// that names why the string is not user copy (allowlist).
		files: [
			"packages/rendering/react/src/**/*.{ts,tsx}",
			"packages/rendering/vue/src/**/*.{ts,tsx}",
		],
		ignores: ["**/__tests__/**", "**/*.test.ts", "**/*.test.tsx"],
		rules: {
			"pen/no-user-facing-literals": "error",
		},
	},
	{
		// AX4 / AX5: rendering packages own surface semantics. Tests may assert
		// aria-hidden and outline. Overlay / focus-sink / decorative exceptions
		// need an adjacent comment naming AX7, "focus sink", or "Justified".
		files: ["packages/rendering/**/*.{ts,tsx,js,jsx}"],
		ignores: ["**/__tests__/**", "**/*.test.ts", "**/*.test.tsx"],
		rules: {
			"pen/no-aria-hidden-visible": "error",
			"pen/no-unstyled-focus": "error",
		},
	},
	{
		// FE3: `DomScheduler` owns the frame in `@input/pen-dom`, so
		// `scheduler.ts` (excepted below) is the only production module that may
		// call requestAnimationFrame. A frame wait that is real scheduling moves
		// onto scheduler.read / scheduler.write; a frame wait that is a selection
		// retry in disguise is deleted under S4 rather than migrated.
		//
		// Lint is the right home for this: the invariant is "do not call this
		// function in these files", and `pnpm lint` already runs on every PR. It
		// was previously stated as a grep that no CI job actually executed.
		//
		// The member-expression selector is what makes it hold: the scheduler's own
		// call is `globalThis.requestAnimationFrame`, so a bare-identifier ban
		// would miss `window.` / `globalThis.` / `defaultView.` forms — which is
		// every form a reintroduced site would plausibly use. The sibling
		// `@input/pen-react` is out of FE3's scope by the rule's own wording: its
		// overlay and menu primitives own their frames, and pulling twenty
		// component sites onto the editor's scheduler is not this rule.
		files: ["packages/rendering/dom/src/**/*.{ts,tsx}"],
		ignores: ["**/__tests__/**", "**/*.test.ts", "**/*.test.tsx"],
		rules: {
			"no-restricted-syntax": [
				"error",
				{
					selector:
						"CallExpression[callee.name='requestAnimationFrame']",
					message:
						"FE3: DomScheduler owns the frame. Use scheduler.read / scheduler.write, or delete the frame wait if it is a selection retry (S4).",
				},
				{
					selector:
						"MemberExpression[property.name='requestAnimationFrame']",
					message:
						"FE3: DomScheduler owns the frame. Use scheduler.read / scheduler.write, or delete the frame wait if it is a selection retry (S4).",
				},
			],
		},
	},
	{
		files: ["packages/rendering/dom/src/scheduler.ts"],
		rules: {
			// FE3: the scheduler is the frame owner this rule exists to protect.
			"no-restricted-syntax": "off",
		},
	},
	{
		// LOC4: word logic in editing/search/selection uses the shared segmenter.
		// `textSegmentation.ts` is the HOST4 whitespace-fallback home and is
		// excluded below. Regex-mode search may pass user `\b` through a variable;
		// literals stay banned. Disable a site with a comment naming the exception.
		files: [
			"packages/rendering/dom/src/field-editor/**/*.{ts,tsx}",
			"packages/extensions/search/src/**/*.{ts,tsx}",
			"packages/core/src/selection/**/*.{ts,tsx}",
			"packages/core/src/editor/textSegmentation.ts",
		],
		ignores: ["**/__tests__/**", "**/*.test.ts"],
		rules: {
			"pen/no-ascii-word-boundaries": "error",
		},
	},
	{
		// S1: one selection writer. Outside the projector, every DOM selection
		// or EditContext selection write is listed with the requirement that
		// removes it in scripts/dom-selection-write-allowlist.json; an entry with
		// no live write fails (I15). The rule self-scopes to the renderer sources.
		files: ["packages/rendering/**/src/**/*.{ts,tsx}"],
		rules: {
			"pen/no-dom-selection-write": "error",
		},
	},
	{
		// W3.R16: focus is a projection concern. In pen-dom only
		// field-editor/focusController.ts calls HTMLElement.focus; the
		// allowlist scripts/dom-focus-allowlist.json is empty, and an entry
		// with no live call fails (I15). The rule self-scopes to pen-dom.
		files: ["packages/rendering/dom/src/**/*.{ts,tsx}"],
		rules: {
			"pen/no-direct-dom-focus": "error",
		},
	},
	{
		// S1: one selection reader. Outside selectionReader.ts, every
		// getSelection(), selectionchange listener and live-selection mapping
		// call is listed with the requirement that removes it in
		// scripts/dom-selection-read-allowlist.json; an entry with no live read
		// fails (I15). The rule self-scopes to the renderer sources.
		files: ["packages/rendering/**/src/**/*.{ts,tsx}"],
		rules: {
			"pen/no-dom-selection-read": "error",
		},
	},
	{
		// SCALE2: function-form decorationsFacet sources recompute in full on
		// every commit. Remaining sites are listed with a reason in
		// scripts/unscoped-decoration-source-allowlist.json; an entry with no
		// live site fails (I15).
		files: [
			"packages/core/src/**/*.{ts,tsx}",
			"packages/extensions/**/src/**/*.{ts,tsx}",
		],
		ignores: ["**/__tests__/**", "**/*.test.ts", "**/*.test.tsx"],
		rules: {
			"pen/no-unscoped-decoration-source": "error",
		},
	},
	{
		files: ["packages/core/src/editor/textSegmentation.ts"],
		rules: {
			// HOST4 sub-floor fallback: word ops degrade to whitespace runs here only.
			"pen/no-ascii-word-boundaries": "off",
		},
	},
	{
		// LOC5: matching paths fold through foldAndNormalize. Identifier folds
		// (MIME, attribute names, shortcut patterns, markdown keys, regex-captured
		// tokens) and single-character display casing are allowlisted in the rule.
		// Globs follow the localization package list (`spec/rules/localization.md`).
		files: [
			"packages/types/src/**/*.{ts,tsx}",
			"packages/core/src/**/*.{ts,tsx}",
			"packages/schema/src/**/*.{ts,tsx}",
			"packages/rendering/dom/src/**/*.{ts,tsx}",
			"packages/rendering/react/src/**/*.{ts,tsx}",
			"packages/rendering/vue/src/**/*.{ts,tsx}",
			"packages/extensions/search/src/**/*.{ts,tsx}",
			"packages/extensions/ai/src/**/*.{ts,tsx}",
			"packages/extensions/tools/src/**/*.{ts,tsx}",
		],
		ignores: ["**/__tests__/**", "**/*.test.ts", "**/*.test.tsx"],
		rules: {
			"pen/no-bare-case-folding": "error",
		},
	},
	{
		// HOST2: published modules must import in Node without DOM globals. Function
		// bodies may touch the browser; module scope may not. Docs, the playground,
		// and the conformance harness are hosts — their entrypoints mount on `document`.
		files: ["packages/**"],
		ignores: ["packages/docs/**", "packages/tooling/conformance/**"],
		rules: {
			"pen/no-module-scope-browser-globals": "error",
		},
	},
	{
		// API6: renderer modules without a framework import belong in pen-dom.
		// Re-export stubs are the P.6 end state. Disable or allowlist with API6
		// and a reason (`scripts/renderer-framework-free-allowlist.json`).
		files: [
			"packages/rendering/react/src/**/*.{ts,tsx}",
			"packages/rendering/vue/src/**/*.{ts,tsx}",
		],
		ignores: ["**/__tests__/**", "**/*.test.ts", "**/*.test.tsx"],
		rules: {
			"pen/no-framework-free-modules-in-renderers": "error",
		},
	},
	{
		// HB2: bindings stay glue. Layout metrics a binding would need to
		// rebuild a window or a height map are measures here, on top of SCH1's
		// rect and hit-test reads; and per-block editor subscriptions go
		// through pen-dom's block notifier. Remaining sites are listed with a
		// reason in scripts/unscheduled-measure-allowlist.json and
		// scripts/binding-subscriptions-allowlist.json; an entry with no live
		// site fails (I15).
		files: [
			"packages/rendering/react/src/**/*.{ts,tsx}",
			"packages/rendering/vue/src/**/*.{ts,tsx}",
		],
		ignores: ["**/__tests__/**", "**/*.test.ts", "**/*.test.tsx"],
		rules: {
			"pen/no-unscheduled-measure": [
				"error",
				{ extraNames: BINDING_LAYOUT_METRIC_NAMES },
			],
			"pen/no-binding-editor-subscriptions": "error",
		},
	},
	{
		// HOST4: above-floor APIs need a feature test or an allowlist entry
		// that names the fallback and user-visible degradation.
		// Recursive `**/src` — a two-level `packages/*/src` + `packages/*/*/src`
		// pair misses any src deeper than that (measured miss:
		// packages/tooling/conformance/harness/src). A new nesting cannot
		// silently fall out of a `**` population.
		files: ["packages/**/src/**/*.{ts,tsx,js,jsx}"],
		ignores: ["**/__tests__/**", "**/*.test.ts", "**/*.test.tsx"],
		rules: {
			"pen/no-above-floor-api": "error",
		},
	},
	{
		// v1 Extension.keyBindings / inputRules / decorations move to facet
		// providers. Error on packages that never declared them (or already
		// migrated) so they cannot regress. The remaining decorations riders stay
		// warn: collectDecorations still iterates Extension.decorations, so moving
		// them to decorationsFacet.of() would drop them from getDecorations()
		// until that collector reads the facet.
		// Same recursive `**/src` as HOST4 — a two-level pair misses
		// packages/tooling/conformance/harness/src.
		files: ["packages/**/src/**/*.{ts,tsx}"],
		ignores: ["**/__tests__/**", "**/*.test.ts", "**/*.test.tsx"],
		rules: {
			"pen/no-v1-extension-fields": "error",
		},
	},
	{
		files: ["packages/types/src/types/ops.ts"],
		rules: {
			"pen/no-new-ops": "error",
		},
	},
	{
		files: [
			"packages/extensions/ai/src/**/*.{ts,tsx}",
			"packages/extensions/multiplayer/src/**/*.{ts,tsx}",
			"packages/extensions/search/src/**/*.{ts,tsx}",
			"packages/tooling/bench/src/**/*.{ts,tsx}",
		],
		ignores: ["**/__tests__/**", "**/*.test.ts", "**/*.test.tsx"],
		rules: {
			"pen/no-v1-extension-fields": "warn",
		},
	},
	{
		// Deliberately permissive baseline. Each entry names the cleanup that earns its
		// promotion to "error"; promoting one before that only creates noise.
		rules: {
			// CH1: `@ts-nocheck` is gone. Remaining `@ts-expect-error`
			// sites must keep an adjacent tracked-issue description.
			"@typescript-eslint/ban-ts-comment": "error",
			"@typescript-eslint/no-explicit-any": "warn",
			// Concentrated in the mechanically split `PartN` files and their test
			// counterparts; the count is the metric for that cleanup.
			"@typescript-eslint/no-unused-vars": [
				"warn",
				{
					argsIgnorePattern: "^_",
					varsIgnorePattern: "^_",
					caughtErrors: "none",
				},
			],
			// F21 reviews these: each is a value computed and then discarded, or
			// an expression evaluated for no effect — bug-shaped, but each needs intent to resolve.
			"no-useless-assignment": "warn",
			"@typescript-eslint/no-unused-expressions": "warn",
			// Not a style nit here: leftover `let` bindings that are never written. Autofixing
			// them to `const` would make dead logic look deliberate. Stay warn until the
			// remaining unused-binding debt is gone — do not promote with ban-ts-comment.
			"prefer-const": "warn",
			// API5 decomposes the handle/interface merging these flag.
			"@typescript-eslint/no-unsafe-declaration-merging": "warn",
			"@typescript-eslint/no-this-alias": "warn",
			"@typescript-eslint/no-empty-object-type": "warn",
			"@typescript-eslint/no-unsafe-function-type": "warn",
			"@typescript-eslint/no-require-imports": "warn",
			// Silent catches are swept separately; until then an empty catch is a warning, not a stop.
			"no-empty": ["warn", { allowEmptyCatch: true }],
		},
	},
	{
		files: [
			"**/*.test.ts",
			"**/*.test.tsx",
			"**/__tests__/**",
			"**/*.bench.ts",
		],
		rules: {
			"@typescript-eslint/no-explicit-any": "off",
			"@typescript-eslint/no-non-null-assertion": "off",
			// HOST4 protects shipped runtime code. Tests run in Node, where `crypto.randomUUID`
			// is unconditional, and their fixture ids are not a portability surface.
			"pen/no-bare-random-uuid": "off",
			// HOST2 protects published module graphs. Tests are allowed to read document/window
			// at file scope when they build a jsdom fixture.
			"pen/no-module-scope-browser-globals": "off",
			// LOC3 is a library-runtime rule. Fixtures may sort with the environment locale.
			"pen/no-implicit-locale": "off",
		},
	},
	{
		files: [
			"packages/tooling/test/**",
			"playground/**",
			"packages/docs/**",
			"scripts/**",
		],
		rules: {
			"pen/no-implicit-locale": "off",
		},
	},
	{
		files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
		...tseslint.configs.disableTypeChecked,
	},
);
