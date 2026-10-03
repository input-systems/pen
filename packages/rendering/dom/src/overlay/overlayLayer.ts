import { DATA_ATTRS } from "../utils/dataAttributes";
import {
	overlayItemStyle,
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

type PaintedNode = {
	readonly node: HTMLElement;
	attributes: Readonly<Record<string, string>>;
	style: OverlayInlineStyle;
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
				this.layer.append(node);
				this.nodes.set(identity, { node, attributes, style });
				continue;
			}
			writeAttributes(painted.node, painted.attributes, attributes);
			writeStyle(painted.node, painted.style, style);
			painted.attributes = attributes;
			painted.style = style;
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

function itemIdentity(item: OverlayPaintItem): string {
	return item.kind === "caret" && item.role === "local"
		? `${item.key}:${item.epoch}`
		: item.key;
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
