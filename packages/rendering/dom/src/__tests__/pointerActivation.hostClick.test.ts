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

function stubRect(
	element: HTMLElement,
	rect: { top: number; bottom: number; left?: number; right?: number },
): void {
	const left = rect.left ?? 0;
	const right = rect.right ?? 200;
	element.getBoundingClientRect = () =>
		({
			x: left,
			y: rect.top,
			top: rect.top,
			bottom: rect.bottom,
			left,
			right,
			width: right - left,
			height: rect.bottom - rect.top,
			toJSON() {
				return this;
			},
		}) as DOMRect;
}

describe("handleFieldEditorPointerActivate host chrome", () => {
	afterEach(() => {
		document.body.replaceChildren();
	});

	function mountTallEditor(): {
		root: HTMLElement;
		blocksHost: HTMLElement;
		first: HTMLElement;
		last: HTMLElement;
		lastInline: HTMLElement;
	} {
		const root = document.createElement("div");
		root.setAttribute(DATA_ATTRS.editorRoot, "");
		const content = document.createElement("div");
		const blocksHost = document.createElement("div");
		const first = document.createElement("div");
		first.setAttribute(DATA_ATTRS.editorBlock, "");
		first.setAttribute(DATA_ATTRS.blockId, "p1");
		const last = document.createElement("div");
		last.setAttribute(DATA_ATTRS.editorBlock, "");
		last.setAttribute(DATA_ATTRS.blockId, "p2");
		const lastInline = document.createElement("span");
		lastInline.setAttribute(DATA_ATTRS.inlineContent, "");
		last.append(lastInline);
		blocksHost.append(first, last);
		content.append(blocksHost);
		root.append(content);
		document.body.append(root);
		stubRect(first, { top: 0, bottom: 20 });
		stubRect(last, { top: 20, bottom: 40 });
		return { root, blocksHost, first, last, lastInline };
	}

	it("activates the last text block when the click is below all blocks on the host", () => {
		const { root, blocksHost, lastInline } = mountTallEditor();
		const target = createTarget({ isEditing: false, focusBlockId: null });
		const handled = handleFieldEditorPointerActivate({
			event: mouseEvent(blocksHost, { clientY: 80 }),
			editor: stubEditor({
				p1: { type: "paragraph", length: 4 },
				p2: { type: "paragraph", length: 7 },
			}),
			fieldEditor: target.fieldEditor,
			root,
			blocksHost,
		});

		expect(handled).toBe(true);
		expect(target.activations).toEqual([
			{ blockId: "p2", anchorOffset: 7, focusOffset: 7 },
		]);
		expect(target.attached).toEqual([lastInline]);
	});

	it("activates the last text block when the click lands on a tall editor root", () => {
		const { root, blocksHost } = mountTallEditor();
		const target = createTarget({ isEditing: false, focusBlockId: null });
		const handled = handleFieldEditorPointerActivate({
			event: mouseEvent(root, { clientY: 120 }),
			editor: stubEditor({
				p1: { type: "paragraph", length: 4 },
				p2: { type: "paragraph", length: 7 },
			}),
			fieldEditor: target.fieldEditor,
			root,
			blocksHost,
		});

		expect(handled).toBe(true);
		expect(target.activations).toEqual([
			{ blockId: "p2", anchorOffset: 7, focusOffset: 7 },
		]);
	});

	it("activates the first text block when the click is above all blocks", () => {
		const { root, blocksHost, first, last } = mountTallEditor();
		stubRect(first, { top: 40, bottom: 60 });
		stubRect(last, { top: 60, bottom: 80 });
		const target = createTarget({ isEditing: false, focusBlockId: null });
		const handled = handleFieldEditorPointerActivate({
			event: mouseEvent(blocksHost, { clientY: 10 }),
			editor: stubEditor({
				p1: { type: "paragraph", length: 4 },
				p2: { type: "paragraph", length: 7 },
			}),
			fieldEditor: target.fieldEditor,
			root,
			blocksHost,
		});

		expect(handled).toBe(true);
		expect(target.activations[0]?.blockId).toBe("p1");
		expect(target.activations[0]?.anchorOffset).toBe(
			target.activations[0]?.focusOffset,
		);
	});

	it("does not activate from a host click that lands between two blocks", () => {
		const { root, blocksHost } = mountTallEditor();
		const target = createTarget({ isEditing: false, focusBlockId: null });
		const handled = handleFieldEditorPointerActivate({
			event: mouseEvent(blocksHost, { clientY: 20 }),
			editor: stubEditor({
				p1: { type: "paragraph", length: 4 },
				p2: { type: "paragraph", length: 7 },
			}),
			fieldEditor: target.fieldEditor,
			root,
			blocksHost,
		});

		expect(handled).toBe(false);
		expect(target.activations).toEqual([]);
	});

	it("HOST6: a click on a list group wrapper is host chrome", () => {
		const { root, blocksHost, first, last } = mountTallEditor();
		const group = document.createElement("div");
		group.setAttribute(DATA_ATTRS.listGroup, "");
		group.setAttribute("role", "list");
		group.append(first, last);
		blocksHost.append(group);
		const editor = stubEditor({
			p1: { type: "bulletListItem", length: 4 },
			p2: { type: "bulletListItem", length: 7 },
		});
		const click = (clientY: number) => {
			const target = createTarget({ isEditing: false, focusBlockId: null });
			const handled = handleFieldEditorPointerActivate({
				event: mouseEvent(group, { clientY }),
				editor,
				fieldEditor: target.fieldEditor,
				root,
				blocksHost,
			});
			return { handled, activations: target.activations };
		};

		// below the last item activates it at its end
		expect(click(80)).toEqual({
			handled: true,
			activations: [{ blockId: "p2", anchorOffset: 7, focusOffset: 7 }],
		});
		// the gap between items stays inactive
		expect(click(20)).toEqual({ handled: false, activations: [] });
		// above the first item activates it at its start
		stubRect(first, { top: 40, bottom: 60 });
		stubRect(last, { top: 60, bottom: 80 });
		const above = click(10);
		expect(above.handled).toBe(true);
		expect(above.activations[0]?.blockId).toBe("p1");
	});
});
