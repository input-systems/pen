import { repoRelativeFilename } from "./lintPaths.js";

/**
 * OV3 (`spec/rules/dom.md`): the React and Vue overlay primitives are
 * bindings over `@input/pen-dom`'s `getRootOverlay(root)`; they hold no
 * measurement code and no frame driver of their own. A binding is an overlay
 * primitive when its basename names a caret, a selection rect, or the overlay
 * layout/paint hooks. Any measuring identifier in one is an error; there is
 * no allowlist.
 */

const SCOPES = ["packages/rendering/react/src/", "packages/rendering/vue/src/"];

/** Basenames of overlay bindings: carets, selection rects, overlay layout and paint-plan hooks. */
const OVERLAY_BINDING = /(caret|selectionrect|overlaylayout|overlaypaint)/i;

/** Identifiers that measure layout or drive their own frame loop. */
const MEASURING_NAMES = new Set([
	"measureWithRoot",
	"measureNow",
	"getBoundingClientRect",
	"getClientRects",
	"useOverlayLayout",
	"requestAnimationFrame",
	"MutationObserver",
	"ResizeObserver",
	"getComputedStyle",
	"caretRect",
	"rangeRects",
	"blockRect",
	"lineBoxes",
]);

/** True when `filename` is a React or Vue overlay binding production source. */
export function isOverlayBinding(filename) {
	const relative = repoRelativeFilename(filename);
	if (!SCOPES.some((scope) => relative.startsWith(scope))) return false;
	if (
		/(^|\/)__tests__\//.test(relative) ||
		/\.(test|spec)\.[cm]?[jt]sx?$/.test(relative)
	) {
		return false;
	}
	return OVERLAY_BINDING.test(relative.split("/").pop() ?? "");
}

export const noOverlayBindingMeasure = {
	meta: {
		type: "problem",
		docs: {
			description:
				"React and Vue overlay bindings measure nothing and drive no frame loop (OV3)",
			specRule: "OV3",
		},
		schema: [],
		messages: {
			measure:
				"`{{name}}` in overlay binding {{file}} measures or drives a frame (OV3). Register a contributor on `getRootOverlay(root)` instead.",
		},
	},
	create(context) {
		const filename = context.filename ?? context.getFilename();
		if (!isOverlayBinding(filename)) return {};
		const file = repoRelativeFilename(filename);
		const check = (node) => {
			if (MEASURING_NAMES.has(node.name)) {
				context.report({
					node,
					messageId: "measure",
					data: { name: node.name, file },
				});
			}
		};
		return { Identifier: check, JSXIdentifier: check };
	},
};
