// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { defaultSchema } from "@input/pen-schema";
import type { Editor } from "@input/pen-types";
import {
	handleFieldEditorPointerActivate,
	type FieldEditorPointerTarget,
} from "../host/pointerActivation";
import { DATA_ATTRS } from "../utils/dataAttributes";

function mouseEvent(
	target: EventTarget,
	init: MouseEventInit = {},
): MouseEvent {
	const event = new MouseEvent("mousedown", {
		bubbles: true,
		button: 0,
		clientX: 0,
		clientY: 0,
		...init,
	});
	Object.defineProperty(event, "target", { value: target });
	return event;
}

function stubEditor(
	blocks: Record<string, { type: string; length?: number }>,
): Editor {
	return {
		schema: defaultSchema,
		getBlock(blockId: string) {
			const block = blocks[blockId];
			if (!block) {
				return null;
			}
			return {
				type: block.type,
				length: () => block.length ?? 0,
			};
		},
	} as unknown as Editor;
}

function createTarget(snapshot: {
	isEditing: boolean;
	focusBlockId: string | null;
}): {
	fieldEditor: FieldEditorPointerTarget;
	activations: Array<{
		blockId: string;
		anchorOffset: number;
		focusOffset: number;
	}>;
	attached: HTMLElement[];
} {
	const activations: Array<{
		blockId: string;
		anchorOffset: number;
		focusOffset: number;
	}> = [];
	const attached: HTMLElement[] = [];
	return {
		activations,
		attached,
		fieldEditor: {
			getSnapshot: () => snapshot,
			activateTextSelection(blockId, anchorOffset, focusOffset) {
				activations.push({ blockId, anchorOffset, focusOffset });
			},
			attachElement(element) {
				attached.push(element);
			},
		},
	};
}

describe("handleFieldEditorPointerActivate", () => {
	afterEach(() => {
		document.body.replaceChildren();
	});

	function mountShell(
		blockId: string,
		type = "paragraph",
	): {
		root: HTMLElement;
		blocksHost: HTMLElement;
		block: HTMLElement;
		inline: HTMLElement;
	} {
		const root = document.createElement("div");
		const blocksHost = document.createElement("div");
		const block = document.createElement("div");
		block.setAttribute(DATA_ATTRS.editorBlock, "");
		block.setAttribute(DATA_ATTRS.blockId, blockId);
		block.setAttribute(DATA_ATTRS.blockType, type);
		const inline = document.createElement("span");
		inline.setAttribute(DATA_ATTRS.inlineContent, "");
		block.append(inline);
		blocksHost.append(block);
		root.append(blocksHost);
		document.body.append(root);
		return { root, blocksHost, block, inline };
	}

	it("does not activate when the editor is read-only", () => {
		const { root, blocksHost, inline } = mountShell("p1");
		const target = createTarget({ isEditing: false, focusBlockId: null });
		const handled = handleFieldEditorPointerActivate({
			event: mouseEvent(inline),
			editor: stubEditor({ p1: { type: "paragraph", length: 4 } }),
			fieldEditor: target.fieldEditor,
			root,
			blocksHost,
			readonly: true,
		});
		expect(handled).toBe(false);
		expect(target.activations).toEqual([]);
	});

	it("does not activate on a non-primary button", () => {
		const { root, blocksHost, inline } = mountShell("p1");
		const target = createTarget({ isEditing: false, focusBlockId: null });
		const handled = handleFieldEditorPointerActivate({
			event: mouseEvent(inline, { button: 2 }),
			editor: stubEditor({ p1: { type: "paragraph", length: 4 } }),
			fieldEditor: target.fieldEditor,
			root,
			blocksHost,
		});
		expect(handled).toBe(false);
		expect(target.activations).toEqual([]);
	});

	it("activates a nested layout child, not the parent container", () => {
		const {
			root,
			blocksHost,
			block: parent,
		} = mountShell("parent", "toggle");
		const child = document.createElement("div");
		child.setAttribute(DATA_ATTRS.editorBlock, "");
		child.setAttribute(DATA_ATTRS.blockId, "child");
		const childInline = document.createElement("span");
		childInline.setAttribute(DATA_ATTRS.inlineContent, "");
		child.append(childInline);
		parent.append(child);

		const target = createTarget({ isEditing: false, focusBlockId: null });
		const handled = handleFieldEditorPointerActivate({
			event: mouseEvent(childInline),
			editor: stubEditor({
				parent: { type: "toggle", length: 0 },
				child: { type: "paragraph", length: 6 },
			}),
			fieldEditor: target.fieldEditor,
			root,
			blocksHost,
		});

		expect(handled).toBe(true);
		expect(target.activations).toEqual([
			{ blockId: "child", anchorOffset: 6, focusOffset: 6 },
		]);
		expect(target.attached).toEqual([childInline]);
	});

	it("activates a callout child the same way", () => {
		const {
			root,
			blocksHost,
			block: parent,
		} = mountShell("callout", "callout");
		const child = document.createElement("div");
		child.setAttribute(DATA_ATTRS.editorBlock, "");
		child.setAttribute(DATA_ATTRS.blockId, "inside");
		const childInline = document.createElement("span");
		childInline.setAttribute(DATA_ATTRS.inlineContent, "");
		child.append(childInline);
		parent.append(child);

		const target = createTarget({ isEditing: false, focusBlockId: null });
		const handled = handleFieldEditorPointerActivate({
			event: mouseEvent(childInline),
			editor: stubEditor({
				callout: { type: "callout", length: 0 },
				inside: { type: "paragraph", length: 0 },
			}),
			fieldEditor: target.fieldEditor,
			root,
			blocksHost,
		});

		expect(handled).toBe(true);
		expect(target.activations[0]?.blockId).toBe("inside");
	});

	it("does not activate when the click lands on the gap between blocks", () => {
		const { root, blocksHost } = mountShell("p1");
		const target = createTarget({ isEditing: false, focusBlockId: null });
		const handled = handleFieldEditorPointerActivate({
			event: mouseEvent(blocksHost),
			editor: stubEditor({ p1: { type: "paragraph", length: 4 } }),
			fieldEditor: target.fieldEditor,
			root,
			blocksHost,
		});
		expect(handled).toBe(false);
		expect(target.activations).toEqual([]);
	});

	it("does not activate a table or image block", () => {
		const { root, blocksHost, block: table } = mountShell("tbl", "table");
		const image = document.createElement("div");
		image.setAttribute(DATA_ATTRS.editorBlock, "");
		image.setAttribute(DATA_ATTRS.blockId, "img");
		blocksHost.append(image);

		const editor = stubEditor({
			tbl: { type: "table" },
			img: { type: "image" },
		});
		const tableTarget = createTarget({
			isEditing: false,
			focusBlockId: null,
		});
		expect(
			handleFieldEditorPointerActivate({
				event: mouseEvent(table),
				editor,
				fieldEditor: tableTarget.fieldEditor,
				root,
				blocksHost,
			}),
		).toBe(false);
		expect(tableTarget.activations).toEqual([]);

		const imageTarget = createTarget({
			isEditing: false,
			focusBlockId: null,
		});
		expect(
			handleFieldEditorPointerActivate({
				event: mouseEvent(image),
				editor,
				fieldEditor: imageTarget.fieldEditor,
				root,
				blocksHost,
			}),
		).toBe(false);
		expect(imageTarget.activations).toEqual([]);
	});

	it("does not activate through an ignore-pointer-gesture descendant", () => {
		const { root, blocksHost, block } = mountShell("p1");
		const ignored = document.createElement("button");
		ignored.setAttribute(DATA_ATTRS.ignorePointerGesture, "");
		block.append(ignored);

		const target = createTarget({ isEditing: false, focusBlockId: null });
		const handled = handleFieldEditorPointerActivate({
			event: mouseEvent(ignored),
			editor: stubEditor({ p1: { type: "paragraph", length: 4 } }),
			fieldEditor: target.fieldEditor,
			root,
			blocksHost,
		});
		expect(handled).toBe(false);
		expect(target.activations).toEqual([]);
	});

	it("does not re-activate the block already being edited", () => {
		const { root, blocksHost, inline } = mountShell("p1");
		const target = createTarget({ isEditing: true, focusBlockId: "p1" });
		const handled = handleFieldEditorPointerActivate({
			event: mouseEvent(inline),
			editor: stubEditor({ p1: { type: "paragraph", length: 4 } }),
			fieldEditor: target.fieldEditor,
			root,
			blocksHost,
		});
		expect(handled).toBe(false);
		expect(target.activations).toEqual([]);
	});

	it("activates a paragraph inside a table cell, not the table", () => {
		const { root, blocksHost } = mountShell("tbl", "table");
		const table = blocksHost.querySelector(
			`[${DATA_ATTRS.editorBlock}]`,
		) as HTMLElement;
		const cell = document.createElement("div");
		cell.setAttribute(DATA_ATTRS.tableCell, "");
		const paragraph = document.createElement("div");
		paragraph.setAttribute(DATA_ATTRS.editorBlock, "");
		paragraph.setAttribute(DATA_ATTRS.blockId, "cell-p");
		const cellInline = document.createElement("span");
		cellInline.setAttribute(DATA_ATTRS.inlineContent, "");
		paragraph.append(cellInline);
		cell.append(paragraph);
		table.append(cell);

		const target = createTarget({ isEditing: false, focusBlockId: null });
		const handled = handleFieldEditorPointerActivate({
			event: mouseEvent(cellInline),
			editor: stubEditor({
				tbl: { type: "table" },
				"cell-p": { type: "paragraph", length: 3 },
			}),
			fieldEditor: target.fieldEditor,
			root,
			blocksHost,
		});

		expect(handled).toBe(true);
		expect(target.activations).toEqual([
			{ blockId: "cell-p", anchorOffset: 3, focusOffset: 3 },
		]);
		expect(target.attached).toEqual([cellInline]);
	});

	it("does not activate when the click lands on table cell chrome", () => {
		const { root, blocksHost, block: table } = mountShell("tbl", "table");
		const cell = document.createElement("div");
		cell.setAttribute(DATA_ATTRS.tableCell, "");
		table.append(cell);

		const target = createTarget({ isEditing: false, focusBlockId: null });
		const handled = handleFieldEditorPointerActivate({
			event: mouseEvent(cell),
			editor: stubEditor({ tbl: { type: "table" } }),
			fieldEditor: target.fieldEditor,
			root,
			blocksHost,
		});

		expect(handled).toBe(false);
		expect(target.activations).toEqual([]);
	});

	it("does not activate a nested editor root, even with a colliding block id", () => {
		const { root, blocksHost, block } = mountShell("p1");
		root.setAttribute(DATA_ATTRS.editorRoot, "");
		const nestedRoot = document.createElement("div");
		nestedRoot.setAttribute(DATA_ATTRS.editorRoot, "");
		nestedRoot.setAttribute(DATA_ATTRS.readonly, "");
		const nestedBlock = document.createElement("div");
		nestedBlock.setAttribute(DATA_ATTRS.editorBlock, "");
		nestedBlock.setAttribute(DATA_ATTRS.blockId, "p1");
		const nestedInline = document.createElement("span");
		nestedInline.setAttribute(DATA_ATTRS.inlineContent, "");
		nestedBlock.append(nestedInline);
		nestedRoot.append(nestedBlock);
		block.append(nestedRoot);

		const target = createTarget({ isEditing: false, focusBlockId: null });
		const handled = handleFieldEditorPointerActivate({
			event: mouseEvent(nestedInline),
			editor: stubEditor({ p1: { type: "paragraph", length: 4 } }),
			fieldEditor: target.fieldEditor,
			root,
			blocksHost,
		});

		expect(handled).toBe(false);
		expect(target.activations).toEqual([]);
	});

	it("activates from a text-node target via the parent element", () => {
		const { root, blocksHost, inline } = mountShell("p1");
		const text = document.createTextNode("Hello");
		inline.append(text);
		const target = createTarget({ isEditing: false, focusBlockId: null });
		const handled = handleFieldEditorPointerActivate({
			event: mouseEvent(text),
			editor: stubEditor({ p1: { type: "paragraph", length: 5 } }),
			fieldEditor: target.fieldEditor,
			root,
			blocksHost,
		});
		expect(handled).toBe(true);
		expect(target.activations).toHaveLength(1);
		expect(target.activations[0]?.blockId).toBe("p1");
		expect(target.activations[0]?.anchorOffset).toBe(
			target.activations[0]?.focusOffset,
		);
		expect(target.attached).toEqual([inline]);
	});

	describe("O1: a chip in the field already being edited", () => {
		function mountChip(): {
			root: HTMLElement;
			blocksHost: HTMLElement;
			chip: HTMLElement;
		} {
			const { root, blocksHost, inline } = mountShell("p1");
			const host = document.createElement("span");
			host.setAttribute(DATA_ATTRS.inlineAtomHost, "");
			const chip = document.createElement("span");
			chip.setAttribute(DATA_ATTRS.inlineAtom, "");
			chip.contentEditable = "false";
			chip.textContent = "@Ada";
			host.append(chip);
			inline.append("Hello ", host, " world");
			return { root, blocksHost, chip };
		}

		const cases: Array<[string, MouseEventInit]> = [
			["a double click", { detail: 2 }],
			["a shift-click", { shiftKey: true, detail: 1 }],
		];
		for (const [name, init] of cases) {
			it(`leaves ${name} on a chip to the browser`, () => {
				const { root, blocksHost, chip } = mountChip();
				const target = createTarget({
					isEditing: true,
					focusBlockId: "p1",
				});
				const event = mouseEvent(chip, { cancelable: true, ...init });
				const handled = handleFieldEditorPointerActivate({
					event,
					editor: stubEditor({
						p1: { type: "paragraph", length: 13 },
					}),
					fieldEditor: target.fieldEditor,
					root,
					blocksHost,
				});
				expect(handled).toBe(false);
				expect(event.defaultPrevented).toBe(false);
				expect(target.activations).toEqual([]);
			});
		}
	});
});
