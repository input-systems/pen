import type { OverlayPaintItem } from "./types";

/**
 * Inline style builders for the overlay layer and its items (HOST6). The
 * overlay is correctness, not taste, so nothing here lives in a stylesheet:
 * `chrome={false}` changes nothing about it. Taste comes in through the
 * documented custom properties below. Property names are CSS (kebab-case)
 * so the painter writes them with `style.setProperty`.
 */
export type OverlayInlineStyle = Readonly<Record<string, string>>;

/** The local caret's default look: a 1px line, or the macOS-style 2px rounded caret. */
export type OverlayCaretVariant = "default" | "macos";

/** Custom properties the overlay reads. Hosts set them on the root or above. */
const OVERLAY_TOKENS = {
	zIndex: "--pen-overlay-z-index",
	caretWidth: "--pen-editor-caret-width",
	caretRadius: "--pen-editor-caret-radius",
	caretColor: "--pen-editor-caret-color",
	caretShadow: "--pen-editor-caret-shadow",
	caretAnimation: "--pen-editor-caret-animation",
	caretOpacity: "--pen-editor-caret-opacity",
	caretHeight: "--pen-editor-caret-height",
	legacyCaretWidth: "--pen-caret-width",
	legacyCaretRadius: "--pen-caret-radius",
	legacyCaretColor: "--pen-caret-color",
	endpointCaretColor: "--pen-editor-endpoint-caret-color",
	blockSelectionOutline: "--pen-block-selection-outline",
	blockSelectionBackground: "--pen-block-selection-background",
	blockSelectionRadius: "--pen-block-selection-radius",
	selectionRangeBackground: "--pen-selection-range-background",
	selectionRangeOpacity: "--pen-selection-range-opacity",
	peerColor: "--pen-peer-color",
	peerLabelColor: "--pen-peer-label-color",
	remoteCaretHeight: "--pen-caret-height",
} as const;

/** O2: local and remote carets are never shorter than this, so an empty line still shows one. */
const OVERLAY_CARET_MIN_HEIGHT = 16;

/** Gap between a remote caret's top and its name label's bottom edge. */
const REMOTE_LABEL_GAP = 8;

const CARET_DEFAULTS: Record<
	OverlayCaretVariant,
	{ readonly color: string; readonly width: string; readonly radius: string }
> = {
	default: {
		color: "var(--palette-b100, currentColor)",
		width: "1px",
		radius: "0px",
	},
	macos: {
		color: "var(--palette-blue, #0a84ff)",
		width: "2px",
		radius: "999px",
	},
};

/** OV2: the layer is a zero-size, absolutely positioned origin that never takes pointer input. */
export function overlayLayerStyle(): OverlayInlineStyle {
	return {
		position: "absolute",
		top: "0px",
		left: "0px",
		width: "0px",
		height: "0px",
		overflow: "visible",
		"pointer-events": "none",
		"z-index": `var(${OVERLAY_TOKENS.zIndex}, 20)`,
	};
}

/**
 * The full inline style of one painted item, as CSS property names. Every
 * item is positioned with a transform relative to the layer origin; `left`
 * and `top` stay `0` (OV2). Bindings that render an item themselves
 * (`paint: "binding"`) style it with this, so a portal caret looks like the
 * one pen-dom paints.
 *
 * @param item - A painted item from an `OverlayPaintPlan`.
 * @param options - The caret variant, and whether the plan's caret is solid (AX6).
 * @returns CSS property name to value.
 */
export function overlayItemStyle(
	item: OverlayPaintItem,
	options: {
		readonly variant: OverlayCaretVariant;
		readonly solidCaret: boolean;
	},
): OverlayInlineStyle {
	const base = {
		position: "absolute",
		top: "0px",
		left: "0px",
		transform: `translate3d(${item.x}px, ${item.y}px, 0)`,
		"pointer-events": "none",
	};
	switch (item.kind) {
		case "caret":
			return { ...base, ...caretStyle(item, options) };
		case "block-outline":
		case "block-span":
		case "cell-range":
			return { ...base, ...sizeStyle(item), ...outlineStyle() };
		case "range":
			return { ...base, ...sizeStyle(item), ...rangeStyle() };
		default: {
			const _exhaustive: never = item.kind;
			return _exhaustive;
		}
	}
}

function sizeStyle(item: OverlayPaintItem): OverlayInlineStyle {
	return {
		width: `${item.width}px`,
		height: `${item.height}px`,
	};
}

function caretStyle(
	item: OverlayPaintItem,
	options: {
		readonly variant: OverlayCaretVariant;
		readonly solidCaret: boolean;
	},
): OverlayInlineStyle {
	const defaults = CARET_DEFAULTS[options.variant];
	const role = item.role ?? "local";
	if (role === "remote") {
		return remoteCaretStyle(item);
	}
	const height =
		role === "local"
			? Math.max(item.height, OVERLAY_CARET_MIN_HEIGHT)
			: item.height;
	const color = `var(${OVERLAY_TOKENS.caretColor}, var(${OVERLAY_TOKENS.legacyCaretColor}, ${defaults.color}))`;
	// AX6: only the local caret blinks, and never under reduced motion,
	// whatever the host's animation token says.
	const animation =
		role === "local" && !options.solidCaret
			? `var(${OVERLAY_TOKENS.caretAnimation}, none)`
			: "none";
	return {
		width: `var(${OVERLAY_TOKENS.caretWidth}, var(${OVERLAY_TOKENS.legacyCaretWidth}, ${defaults.width}))`,
		height: `${height}px`,
		"border-radius": `var(${OVERLAY_TOKENS.caretRadius}, var(${OVERLAY_TOKENS.legacyCaretRadius}, ${defaults.radius}))`,
		background:
			role === "endpoint"
				? `var(${OVERLAY_TOKENS.endpointCaretColor}, ${color})`
				: color,
		"box-shadow": `var(${OVERLAY_TOKENS.caretShadow}, none)`,
		opacity: `var(${OVERLAY_TOKENS.caretOpacity}, 1)`,
		animation,
		[OVERLAY_TOKENS.caretHeight]: `${height}px`,
	};
}

/**
 * A collaborator's caret: the peer colour, the shared caret tokens, never
 * blinking (`--pen-peer-*`, `--pen-caret-*`).
 */
function remoteCaretStyle(item: OverlayPaintItem): OverlayInlineStyle {
	const height = Math.max(item.height, OVERLAY_CARET_MIN_HEIGHT);
	return {
		width: `var(${OVERLAY_TOKENS.legacyCaretWidth}, 2px)`,
		height: `${height}px`,
		"border-radius": `var(${OVERLAY_TOKENS.legacyCaretRadius}, 999px)`,
		background: `var(${OVERLAY_TOKENS.peerColor})`,
		// AX6: only the local caret blinks.
		animation: "none",
		[OVERLAY_TOKENS.peerColor]: item.color ?? "currentColor",
		[OVERLAY_TOKENS.remoteCaretHeight]: `${height}px`,
	};
}

/**
 * The inline style of a remote caret's name label, as CSS property names:
 * placed above the caret at the item's position, its bottom edge 8px above
 * the caret's top. pen-dom paints the label inside the caret element (at
 * `x = y = 0` relative to it); a binding that renders the label as the
 * caret's sibling passes the item itself.
 *
 * @param item - A caret item (or its position) from an `OverlayPaintPlan`.
 * @returns CSS property name to value.
 */
export function overlayLabelStyle(
	item: Pick<OverlayPaintItem, "x" | "y" | "color">,
): OverlayInlineStyle {
	return {
		position: "absolute",
		top: "0px",
		left: "0px",
		transform: `translate3d(${item.x}px, ${item.y - REMOTE_LABEL_GAP}px, 0) translateY(-100%)`,
		padding: "2px 6px",
		"border-radius": "6px",
		background: `var(${OVERLAY_TOKENS.peerColor})`,
		color: `var(${OVERLAY_TOKENS.peerLabelColor}, #fff)`,
		"font-size": "12px",
		"line-height": "1.2",
		"white-space": "nowrap",
		"pointer-events": "none",
		[OVERLAY_TOKENS.peerColor]: item.color ?? "currentColor",
	};
}

function outlineStyle(): OverlayInlineStyle {
	return {
		"box-shadow": `var(${OVERLAY_TOKENS.blockSelectionOutline}, inset 0 0 0 2px Highlight)`,
		background: `var(${OVERLAY_TOKENS.blockSelectionBackground}, transparent)`,
		"border-radius": `var(${OVERLAY_TOKENS.blockSelectionRadius}, 0px)`,
	};
}

function rangeStyle(): OverlayInlineStyle {
	return {
		background: `var(${OVERLAY_TOKENS.selectionRangeBackground}, Highlight)`,
		opacity: `var(${OVERLAY_TOKENS.selectionRangeOpacity}, 0.35)`,
	};
}
