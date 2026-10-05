// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { defaultSchema } from "@input/pen-schema";
import type { Editor } from "@input/pen-types";
import { handleFieldEditorPointerActivate } from "../host/pointerActivation";
import { DATA_ATTRS } from "../utils/dataAttributes";

type StubBlocks = Record<string, { type: string; length?: number }>;

afterEach(() => {
	document.body.replaceChildren();
});

function stubEditor(blocks: StubBlocks): Editor {
	return {
		schema: defaultSchema,
		getBlock(blockId: string) {
			const block = blocks[blockId];
			return block ? { type: block.type, length: () => block.length ?? 0 } : null;
		},
	} as unknown as Editor;
}

/**
 * Dispatches a primary-button mousedown on `target` through the activation
 * handler and records what it activated and attached.
 */
function activate(
	shell: { root: HTMLElement; blocksHost: HTMLElement },
	target: EventTarget,
	blocks: StubBlocks,
	options: {
		init?: MouseEventInit;
		snapshot?: { isEditing: boolean; focusBlockId: string | null };
		readonly?: boolean;
	} = {},
) {
	const activations: Array<{ blockId: string; anchorOffset: number; focusOffset: number }> = [];
	const attached: HTMLElement[] = [];
	const event = new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 0, clientY: 0, ...options.init });
	Object.defineProperty(event, "target", { value: target });
	const snapshot = options.snapshot ?? { isEditing: false, focusBlockId: null };
	const handled = handleFieldEditorPointerActivate({
		event,
		editor: stubEditor(blocks),
		fieldEditor: {
			getSnapshot: () => snapshot,
			activateTextSelection(blockId, anchorOffset, focusOffset) {
				activations.push({ blockId, anchorOffset, focusOffset });
			},
			attachElement(element) {
				attached.push(element);
			},
		},
		root: shell.root,
		blocksHost: shell.blocksHost,
		readonly: options.readonly,
	});
	return { handled, activations, attached, event };
}

function createBlock(blockId: string, type?: string): { block: HTMLElement; inline: HTMLElement } {
	const block = document.createElement("div");
	block.setAttribute(DATA_ATTRS.editorBlock, "");
	block.setAttribute(DATA_ATTRS.blockId, blockId);
	if (type) block.setAttribute(DATA_ATTRS.blockType, type);
	const inline = document.createElement("span");
	inline.setAttribute(DATA_ATTRS.inlineContent, "");
	block.append(inline);
	return { block, inline };
}

function stubRect(element: HTMLElement, top: number, bottom: number): void {
	element.getBoundingClientRect = () =>
		({ x: 0, y: top, top, bottom, left: 0, right: 200, width: 200, height: bottom - top }) as DOMRect;
}

const P1 = { p1: { type: "paragraph", length: 4 } };
const NOT_ACTIVATED = { handled: false, activations: [] };

describe("handleFieldEditorPointerActivate", () => {
	function mountShell(blockId: string, type = "paragraph") {
		const root = document.createElement("div");
		const blocksHost = document.createElement("div");
		const { block, inline } = createBlock(blockId, type);
		blocksHost.append(block);
		root.append(blocksHost);
		document.body.append(root);
		return { root, blocksHost, block, inline };
	}

	it.each([
		["the editor is read-only", { readonly: true }],
		["a non-primary button is pressed", { init: { button: 2 } }],
		["the block is already being edited", { snapshot: { isEditing: true, focusBlockId: "p1" } }],
	])("does not activate when %s", (_name, options) => {
		const shell = mountShell("p1");
		expect(activate(shell, shell.inline, P1, options)).toMatchObject(NOT_ACTIVATED);
	});

	it.each([
		["a toggle", "toggle", 6],
		["a callout", "callout", 0],
	])("activates a nested layout child of %s, not the parent container", (_name, type, length) => {
		const shell = mountShell("parent", type);
		const child = createBlock("child");
		shell.block.append(child.block);

		const result = activate(shell, child.inline, {
			parent: { type, length: 0 },
			child: { type: "paragraph", length },
		});

		expect(result.handled).toBe(true);
		expect(result.activations).toEqual([{ blockId: "child", anchorOffset: length, focusOffset: length }]);
		expect(result.attached).toEqual([child.inline]);
	});

	it("does not activate when the click lands on the gap between blocks", () => {
		const shell = mountShell("p1");
		expect(activate(shell, shell.blocksHost, P1)).toMatchObject(NOT_ACTIVATED);
	});

	it("does not activate a table or image block", () => {
		const shell = mountShell("tbl", "table");
		const image = createBlock("img").block;
		image.replaceChildren();
		shell.blocksHost.append(image);
		const blocks = { tbl: { type: "table" }, img: { type: "image" } };

		expect(activate(shell, shell.block, blocks)).toMatchObject(NOT_ACTIVATED);
		expect(activate(shell, image, blocks)).toMatchObject(NOT_ACTIVATED);
	});

	it("does not activate through an ignore-pointer-gesture descendant", () => {
		const shell = mountShell("p1");
		const ignored = document.createElement("button");
		ignored.setAttribute(DATA_ATTRS.ignorePointerGesture, "");
		shell.block.append(ignored);
		expect(activate(shell, ignored, P1)).toMatchObject(NOT_ACTIVATED);
	});

	it("activates a paragraph inside a table cell, not the table, and not from the cell chrome", () => {
		const shell = mountShell("tbl", "table");
		const cell = document.createElement("div");
		cell.setAttribute(DATA_ATTRS.tableCell, "");
		const paragraph = createBlock("cell-p");
		cell.append(paragraph.block);
		shell.block.append(cell);
		const blocks = { tbl: { type: "table" }, "cell-p": { type: "paragraph", length: 3 } };

		const result = activate(shell, paragraph.inline, blocks);
		expect(result.handled).toBe(true);
		expect(result.activations).toEqual([{ blockId: "cell-p", anchorOffset: 3, focusOffset: 3 }]);
		expect(result.attached).toEqual([paragraph.inline]);

		expect(activate(shell, cell, blocks)).toMatchObject(NOT_ACTIVATED);
	});

	it("does not activate a nested editor root, even with a colliding block id", () => {
		const shell = mountShell("p1");
		shell.root.setAttribute(DATA_ATTRS.editorRoot, "");
		const nestedRoot = document.createElement("div");
		nestedRoot.setAttribute(DATA_ATTRS.editorRoot, "");
		nestedRoot.setAttribute(DATA_ATTRS.readonly, "");
		const nested = createBlock("p1");
		nestedRoot.append(nested.block);
		shell.block.append(nestedRoot);

		expect(activate(shell, nested.inline, P1)).toMatchObject(NOT_ACTIVATED);
	});

	it("activates from a text-node target via the parent element", () => {
		const shell = mountShell("p1");
		const text = document.createTextNode("Hello");
		shell.inline.append(text);

		const result = activate(shell, text, { p1: { type: "paragraph", length: 5 } });

		expect(result.handled).toBe(true);
		expect(result.activations).toHaveLength(1);
		expect(result.activations[0]?.blockId).toBe("p1");
		expect(result.activations[0]?.anchorOffset).toBe(result.activations[0]?.focusOffset);
		expect(result.attached).toEqual([shell.inline]);
	});

	it.each([
		["a double click", { detail: 2 }],
		["a shift-click", { shiftKey: true, detail: 1 }],
	])("O1: leaves %s on a chip in the field already being edited to the browser", (_name, init) => {
		const shell = mountShell("p1");
		const host = document.createElement("span");
		host.setAttribute(DATA_ATTRS.inlineAtomHost, "");
		const chip = document.createElement("span");
		chip.setAttribute(DATA_ATTRS.inlineAtom, "");
		chip.contentEditable = "false";
		chip.textContent = "@Ada";
		host.append(chip);
		shell.inline.append("Hello ", host, " world");

		const result = activate(shell, chip, { p1: { type: "paragraph", length: 13 } }, {
			init: { cancelable: true, ...init },
			snapshot: { isEditing: true, focusBlockId: "p1" },
		});

		expect(result).toMatchObject(NOT_ACTIVATED);
		expect(result.event.defaultPrevented).toBe(false);
	});
});

describe("handleFieldEditorPointerActivate host chrome", () => {
	const BLOCKS = { p1: { type: "paragraph", length: 4 }, p2: { type: "paragraph", length: 7 } };
	const ACTIVATED_LAST = { handled: true, activations: [{ blockId: "p2", anchorOffset: 7, focusOffset: 7 }] };

	/** Two 20px blocks at 0–20 and 20–40 inside a taller host. */
	function mountTallEditor() {
		const root = document.createElement("div");
		root.setAttribute(DATA_ATTRS.editorRoot, "");
		const content = document.createElement("div");
		const blocksHost = document.createElement("div");
		const first = createBlock("p1").block;
		first.replaceChildren();
		const last = createBlock("p2");
		blocksHost.append(first, last.block);
		content.append(blocksHost);
		root.append(content);
		document.body.append(root);
		stubRect(first, 0, 20);
		stubRect(last.block, 20, 40);
		/** Moves both blocks down so a click at the top lands above them. */
		const shiftDown = () => {
			stubRect(first, 40, 60);
			stubRect(last.block, 60, 80);
		};
		return { root, blocksHost, first, last: last.block, lastInline: last.inline, shiftDown };
	}

	it("activates the last text block when the click is below all blocks on the host", () => {
		const shell = mountTallEditor();
		const result = activate(shell, shell.blocksHost, BLOCKS, { init: { clientY: 80 } });
		expect(result).toMatchObject(ACTIVATED_LAST);
		expect(result.attached).toEqual([shell.lastInline]);
	});

	it("activates the last text block when the click lands on a tall editor root", () => {
		const shell = mountTallEditor();
		expect(activate(shell, shell.root, BLOCKS, { init: { clientY: 120 } })).toMatchObject(ACTIVATED_LAST);
	});

	it("activates the first text block when the click is above all blocks", () => {
		const shell = mountTallEditor();
		shell.shiftDown();
		const result = activate(shell, shell.blocksHost, BLOCKS, { init: { clientY: 10 } });
		expect(result.handled).toBe(true);
		expect(result.activations[0]?.blockId).toBe("p1");
		expect(result.activations[0]?.anchorOffset).toBe(result.activations[0]?.focusOffset);
	});

	it("does not activate from a host click that lands between two blocks", () => {
		const shell = mountTallEditor();
		expect(activate(shell, shell.blocksHost, BLOCKS, { init: { clientY: 20 } })).toMatchObject(NOT_ACTIVATED);
	});

	it("HOST6: a click on a list group wrapper is host chrome", () => {
		const shell = mountTallEditor();
		const group = document.createElement("div");
		group.setAttribute(DATA_ATTRS.listGroup, "");
		group.setAttribute("role", "list");
		group.append(shell.first, shell.last);
		shell.blocksHost.append(group);
		const blocks = { p1: { type: "bulletListItem", length: 4 }, p2: { type: "bulletListItem", length: 7 } };
		const click = (clientY: number) => activate(shell, group, blocks, { init: { clientY } });

		// below the last item activates it at its end
		expect(click(80)).toMatchObject(ACTIVATED_LAST);
		// the gap between items stays inactive
		expect(click(20)).toMatchObject(NOT_ACTIVATED);
		// above the first item activates it at its start
		shell.shiftDown();
		const above = click(10);
		expect(above.handled).toBe(true);
		expect(above.activations[0]?.blockId).toBe("p1");
	});
});
