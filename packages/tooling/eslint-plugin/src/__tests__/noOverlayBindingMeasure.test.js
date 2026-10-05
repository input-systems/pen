import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";
import {
	isOverlayBinding,
	noOverlayBindingMeasure,
} from "../rules/noOverlayBindingMeasure.js";

const ruleTester = new RuleTester({
	languageOptions: {
		parser: tseslint.parser,
		parserOptions: { ecmaFeatures: { jsx: true } },
	},
});
const CARET = "packages/rendering/react/src/primitives/editor/caretOverlay.tsx";
const VUE_CARET = "packages/rendering/vue/src/components/caretLayer.ts";

describe("pen/no-overlay-binding-measure", () => {
	it("OV3: overlay bindings are named by basename in the React and Vue sources only", () => {
		expect(isOverlayBinding(CARET)).toBe(true);
		expect(isOverlayBinding("packages/rendering/react/src/primitives/editor/selectionRect.tsx")).toBe(true);
		expect(isOverlayBinding("packages/rendering/react/src/hooks/useOverlayPaintPlan.ts")).toBe(true);
		expect(isOverlayBinding(VUE_CARET)).toBe(true);
		expect(isOverlayBinding("packages/rendering/react/src/primitives/editor/dragOverlay.tsx")).toBe(false);
		expect(isOverlayBinding("packages/rendering/dom/src/overlay/caretLayer.ts")).toBe(false);
		expect(isOverlayBinding("packages/rendering/react/src/__tests__/caretOverlay.test.tsx")).toBe(false);
	});

	it("OV3: flags measuring identifiers in overlay bindings; comments, strings and non-overlay files do not count", () => {
		ruleTester.run("no-overlay-binding-measure", noOverlayBindingMeasure, {
			valid: [
				{
					code: "// getBoundingClientRect is only mentioned here\nexport const label = 'getBoundingClientRect';\n",
					filename: CARET,
				},
				{
					code: "export function c(el) { return el.getBoundingClientRect(); }\n",
					filename: "packages/rendering/react/src/primitives/editor/dragOverlay.tsx",
				},
				{
					code: "export function A() { return getRootOverlay(root).onPaintPlan(() => {}); }\n",
					filename: CARET,
				},
			],
			invalid: [
				{
					code: "export function A() { return measureWithRoot(root, () => 1); }\n",
					filename: CARET,
					errors: [{ messageId: "measure", data: { name: "measureWithRoot", file: CARET } }],
				},
				{
					code: "export function b(el) { return el.getBoundingClientRect(); }\n",
					filename: VUE_CARET,
					errors: [{ messageId: "measure" }],
				},
				{
					code: "export function d() { const o = new ResizeObserver(() => {}); requestAnimationFrame(() => o.disconnect()); }\n",
					filename: CARET,
					errors: [{ messageId: "measure" }, { messageId: "measure" }],
				},
			],
		});
	});
});
