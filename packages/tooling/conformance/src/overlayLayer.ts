import { expect, type Page } from "@playwright/test";

/** One painted overlay item, read from the production layer. */
export type LayerItem = {
	kind: string | null;
	local: boolean;
	endpoint: string | null;
	blockId: string | null;
	fromBlockId: string | null;
	toBlockId: string | null;
	offset: string | null;
	affinity: string | null;
	epoch: string | null;
	ariaHidden: string | null;
	pointerEvents: string;
	transform: string;
	styleLeft: string;
	styleTop: string;
	box: { left: number; top: number; right: number; bottom: number; width: number; height: number };
};

export type LayerSnapshot = {
	mounted: boolean;
	lastChildOfRoot: boolean;
	ariaHidden: string | null;
	pointerEvents: string;
	caretVisible: boolean;
	selectionVersion: string | null;
	items: LayerItem[];
	/** Inline `caret-color` of the active field surface, or null without one. */
	caretColor: string | null;
};

/** Read the root's `[data-pen-overlay-layer]` and every item in it. */
export async function readLayer(page: Page): Promise<LayerSnapshot> {
	return page.evaluate(() => {
		const root = document.querySelector("[data-pen-editor-root]");
		const layer = document.querySelector("[data-pen-overlay-layer]");
		const surface = document.querySelector(
			"[data-pen-field-editor-active-surface]",
		);
		const caretColor =
			surface instanceof HTMLElement ? surface.style.caretColor : null;
		if (!(layer instanceof HTMLElement)) {
			return {
				mounted: false,
				lastChildOfRoot: false,
				ariaHidden: null,
				pointerEvents: "",
				caretVisible: false,
				selectionVersion: null,
				items: [],
				caretColor,
			};
		}
		const items = [
			...layer.querySelectorAll<HTMLElement>("[data-pen-overlay-item]"),
		].map((node) => {
			const box = node.getBoundingClientRect();
			return {
				kind: node.getAttribute("data-pen-overlay-item"),
				local: node.hasAttribute("data-pen-editor-caret"),
				endpoint: node.getAttribute("data-endpoint"),
				blockId: node.getAttribute("data-block-id"),
				fromBlockId: node.getAttribute("data-from-block-id"),
				toBlockId: node.getAttribute("data-to-block-id"),
				offset: node.getAttribute("data-offset"),
				affinity: node.getAttribute("data-affinity"),
				epoch: node.getAttribute("data-pen-caret-epoch"),
				ariaHidden: node.getAttribute("aria-hidden"),
				pointerEvents: getComputedStyle(node).pointerEvents,
				transform: node.style.transform,
				styleLeft: node.style.left,
				styleTop: node.style.top,
				box: {
					left: box.left,
					top: box.top,
					right: box.right,
					bottom: box.bottom,
					width: box.width,
					height: box.height,
				},
			};
		});
		return {
			mounted: true,
			lastChildOfRoot: root?.lastElementChild === layer,
			ariaHidden: layer.getAttribute("aria-hidden"),
			pointerEvents: getComputedStyle(layer).pointerEvents,
			caretVisible: layer.hasAttribute("data-caret-visible"),
			selectionVersion: layer.getAttribute(
				"data-pen-overlay-selection-version",
			),
			items,
			caretColor,
		};
	});
}

/** Read the layer once the scheduler has flushed (OV4), so the paint is current. */
export async function readSettledLayer(page: Page): Promise<LayerSnapshot> {
	const check = await page.evaluate(() =>
		window.__penConformance.overlayMatchesAuthority(),
	);
	expect(check.kind, `OV4 before reading the layer: ${check.reason}`).not.toBe(
		"failed",
	);
	return readLayer(page);
}

export function localCarets(snapshot: LayerSnapshot): LayerItem[] {
	return snapshot.items.filter((item) => item.kind === "caret" && item.local);
}

export function itemsOfKind(snapshot: LayerSnapshot, kind: string): LayerItem[] {
	return snapshot.items.filter((item) => item.kind === kind);
}

/** The box of a block element, for outline comparisons. */
export async function blockBox(
	page: Page,
	blockId: string,
): Promise<{ left: number; top: number; width: number; height: number }> {
	return page.evaluate((id) => {
		const block = document.querySelector(
			`[data-pen-editor-block][data-block-id="${id}"]`,
		);
		if (!(block instanceof HTMLElement)) {
			throw new Error(`missing block ${id}`);
		}
		const box = block.getBoundingClientRect();
		return { left: box.left, top: box.top, width: box.width, height: box.height };
	}, blockId);
}

export type Box = LayerItem["box"];

/** The viewport box of the character at `offset` in a block's inline content. */
export async function charBox(
	page: Page,
	blockId: string,
	offset: number,
): Promise<Box> {
	return page.evaluate(
		({ id, target }) => {
			const inline = document.querySelector(
				`[data-pen-editor-block][data-block-id="${id}"] [data-pen-inline-content]`,
			);
			if (!(inline instanceof HTMLElement)) {
				throw new Error(`missing inline content for ${id}`);
			}
			const walker = document.createTreeWalker(inline, NodeFilter.SHOW_TEXT);
			let remaining = target;
			while (walker.nextNode()) {
				const text = walker.currentNode as Text;
				if (remaining < text.data.length) {
					const range = document.createRange();
					range.setStart(text, remaining);
					range.setEnd(text, remaining + 1);
					const box = range.getBoundingClientRect();
					return {
						left: box.left,
						top: box.top,
						right: box.right,
						bottom: box.bottom,
						width: box.width,
						height: box.height,
					};
				}
				remaining -= text.data.length;
			}
			throw new Error(`no character at ${id}:${target}`);
		},
		{ id: blockId, target: offset },
	);
}

/** The viewport box of the first painted remote caret's name label, or null. */
export async function remoteLabelBox(page: Page): Promise<Box | null> {
	return page.evaluate(() => {
		const label = document.querySelector(
			"[data-pen-overlay-layer] [data-pen-multiplayer-caret-label]",
		);
		if (!(label instanceof HTMLElement)) {
			return null;
		}
		const box = label.getBoundingClientRect();
		return {
			left: box.left,
			top: box.top,
			right: box.right,
			bottom: box.bottom,
			width: box.width,
			height: box.height,
		};
	});
}

/** Remote carets painted in the layer (`role: "remote"`; no local or endpoint attribute). */
export function remoteCarets(snapshot: LayerSnapshot): LayerItem[] {
	return snapshot.items.filter(
		(item) => item.kind === "caret" && !item.local && item.endpoint === null,
	);
}
