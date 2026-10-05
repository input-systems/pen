import { DATA_ATTRS } from "../utils/dataAttributes";
import {
	overlayItemStyle,
	overlayLabelStyle,
	overlayLayerStyle,
	type OverlayCaretVariant,
	type OverlayInlineStyle,
} from "./overlayStyles";
import type { OverlayPaintItem } from "./types";

/**
 * The overlay layer element and its keyed painter (OV2). Everything here
 * writes; it runs in the scheduler's write phase only and reads no layout.
 */

/** Attributes a contributor may add to an item: `data-*` only, so a request cannot add handlers or drop `aria-hidden`. */
const CONTRIBUTOR_ATTRIBUTE = /^data-[a-z0-9_.:-]+$/i;

type PaintedLabel = {
	readonly node: HTMLElement;
	text: string;
	attributes: Readonly<Record<string, string>>;
	style: OverlayInlineStyle;
};

type PaintedNode = {
	readonly node: HTMLElement;
	attributes: Readonly<Record<string, string>>;
	style: OverlayInlineStyle;
	label: PaintedLabel | null;
};

export type OverlayPaintOptions = {
	readonly variant: OverlayCaretVariant;
	readonly solidCaret: boolean;
};

/** Create the root's overlay layer: `aria-hidden`, `pointer-events: none`, both inline (AX7). */
export function createOverlayLayerElement(doc: Document): HTMLElement {
	const layer = doc.createElement("div");
	layer.setAttribute(DATA_ATTRS.overlayLayer, "");
	// AX7: the overlay layer is presentation only; its items mirror the selection.
	layer.setAttribute("aria-hidden", "true");
	for (const [property, value] of Object.entries(overlayLayerStyle())) {
		layer.style.setProperty(property, value);
	}
	return layer;
}

/**
 * Keyed painter. An item's identity is its key, plus its blink epoch for a
 * local caret: an epoch change replaces the caret element, so its CSS
 * animation restarts at the first frame with no read and no timer (D9).
 * Painting a plan equal to the painted one performs no DOM mutation (OV1).
 */
export class OverlayLayerPainter {
	private readonly nodes = new Map<string, PaintedNode>();

	constructor(private readonly layer: HTMLElement) {}

	apply(
		items: readonly OverlayPaintItem[],
		options: OverlayPaintOptions,
	): void {
		const keep = new Set<string>();
		const doc = this.layer.ownerDocument;
		for (const item of items) {
			if (item.paint === "binding") {
				continue;
			}
			const identity = itemIdentity(item);
			keep.add(identity);
			const attributes = itemAttributes(item);
			const style = overlayItemStyle(item, options);
			const painted = this.nodes.get(identity);
			if (!painted) {
				const node = doc.createElement("div");
				writeAttributes(node, {}, attributes);
				writeStyle(node, {}, style);
				const created: PaintedNode = {
					node,
					attributes,
					style,
					label: null,
				};
				syncLabel(created, item);
				this.layer.append(node);
				this.nodes.set(identity, created);
				continue;
			}
			writeAttributes(painted.node, painted.attributes, attributes);
			writeStyle(painted.node, painted.style, style);
			painted.attributes = attributes;
			painted.style = style;
			syncLabel(painted, item);
		}
		for (const [identity, painted] of this.nodes) {
			if (!keep.has(identity)) {
				painted.node.remove();
				this.nodes.delete(identity);
			}
		}
	}

	clear(): void {
		for (const painted of this.nodes.values()) {
			painted.node.remove();
		}
		this.nodes.clear();
	}
}

/**
 * A caret's label is a child of the caret element, so it moves with the
 * caret's transform. Its text is set as text, never parsed (COL2), and it
 * is `aria-hidden` like every overlay item (AX7).
 */
function syncLabel(painted: PaintedNode, item: OverlayPaintItem): void {
	const text = item.kind === "caret" ? item.label : undefined;
	if (text === undefined) {
		painted.label?.node.remove();
		painted.label = null;
		return;
	}
	const attributes = labelAttributes(item);
	const style = overlayLabelStyle({ x: 0, y: 0, color: item.color });
	const label = painted.label;
	if (!label) {
		const node = painted.node.ownerDocument.createElement("div");
		writeAttributes(node, {}, attributes);
		writeStyle(node, {}, style);
		node.textContent = text;
		painted.node.append(node);
		painted.label = { node, text, attributes, style };
		return;
	}
	writeAttributes(label.node, label.attributes, attributes);
	writeStyle(label.node, label.style, style);
	if (label.text !== text) {
		label.node.textContent = text;
	}
	label.text = text;
	label.attributes = attributes;
	label.style = style;
}

function labelAttributes(item: OverlayPaintItem): Record<string, string> {
	const attributes: Record<string, string> = {
		[DATA_ATTRS.overlayLabel]: "",
		// AX7: a caret label is overlay presentation; presence reaches AT
		// through the collaborator announcements.
		"aria-hidden": "true",
	};
	if (item.role === "remote") {
		attributes[DATA_ATTRS.multiplayerCaretLabel] = "";
	}
	return attributes;
}

/**
 * A painted node's identity: the item's key namespaced by its contributor,
 * so a host contributor reusing a built-in key never shares (or steals) a
 * built-in item's node. The contributor id is length-prefixed, so no pair of
 * ids and keys can spell the same identity. The local caret adds its blink
 * epoch: a new epoch is a new node, which restarts the CSS animation.
 */
function itemIdentity(item: OverlayPaintItem): string {
	const identity = `${item.contributor.length}:${item.contributor}:${item.key}`;
	return item.kind === "caret" && item.role === "local"
		? `${identity}:${item.epoch}`
		: identity;
}

function itemAttributes(item: OverlayPaintItem): Record<string, string> {
	const attributes: Record<string, string> = {};
	for (const [name, value] of Object.entries(item.attributes ?? {})) {
		if (CONTRIBUTOR_ATTRIBUTE.test(name)) {
			attributes[name] = value;
		}
	}
	attributes[DATA_ATTRS.overlayItem] = item.kind;
	// AX7: every overlay item is presentation only, whatever the request asked for.
	attributes["aria-hidden"] = "true";
	switch (item.kind) {
		case "caret":
			Object.assign(attributes, caretAttributes(item));
			break;
		case "block-outline":
			setOptional(attributes, DATA_ATTRS.blockId, item.blockId);
			break;
		case "block-span":
			setOptional(attributes, "data-from-block-id", item.fromBlockId);
			setOptional(attributes, "data-to-block-id", item.toBlockId);
			break;
		case "cell-range":
			setOptional(attributes, DATA_ATTRS.blockId, item.blockId);
			if (item.anchorCell) {
				attributes["data-anchor-cell"] =
					`${item.anchorCell.row},${item.anchorCell.col}`;
			}
			if (item.headCell) {
				attributes["data-head-cell"] =
					`${item.headCell.row},${item.headCell.col}`;
			}
			break;
		case "range":
			break;
		default: {
			const _exhaustive: never = item.kind;
			return _exhaustive;
		}
	}
	return attributes;
}

function caretAttributes(item: OverlayPaintItem): Record<string, string> {
	const attributes: Record<string, string> = {};
	setOptional(attributes, DATA_ATTRS.blockId, item.blockId);
	if (item.offset !== undefined) {
		attributes["data-offset"] = String(item.offset);
	}
	setOptional(attributes, "data-affinity", item.affinity);
	const role = item.role ?? "local";
	switch (role) {
		case "local":
			attributes["data-pen-editor-caret"] = "";
			attributes["data-pen-caret-epoch"] = String(item.epoch);
			break;
		case "endpoint":
			attributes["data-pen-editor-endpoint-caret"] = "";
			setOptional(attributes, "data-endpoint", item.endpoint);
			break;
		case "remote":
			break;
		default: {
			const _exhaustive: never = role;
			return _exhaustive;
		}
	}
	return attributes;
}

function setOptional(
	attributes: Record<string, string>,
	name: string,
	value: string | undefined,
): void {
	if (value !== undefined) {
		attributes[name] = value;
	}
}

function writeAttributes(
	node: HTMLElement,
	previous: Readonly<Record<string, string>>,
	next: Readonly<Record<string, string>>,
): void {
	for (const name of Object.keys(previous)) {
		if (!(name in next)) {
			node.removeAttribute(name);
		}
	}
	for (const [name, value] of Object.entries(next)) {
		if (previous[name] !== value) {
			node.setAttribute(name, value);
		}
	}
}

function writeStyle(
	node: HTMLElement,
	previous: OverlayInlineStyle,
	next: OverlayInlineStyle,
): void {
	for (const property of Object.keys(previous)) {
		if (!(property in next)) {
			node.style.removeProperty(property);
		}
	}
	for (const [property, value] of Object.entries(next)) {
		if (previous[property] !== value) {
			node.style.setProperty(property, value);
		}
	}
}
