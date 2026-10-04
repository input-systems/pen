// @vitest-environment jsdom

import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import type { DiagnosticEvent, InlineInsert } from "@input/pen-types";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	FieldEditorFocusRequest,
	FieldEditorTableNavigationController,
} from "../field-editor/controller";
import { isInlineAtomChipNode } from "../field-editor/inlineAtomDom";
import { mountEditor } from "../host/mountEditor";
import { DATA_ATTRS } from "../utils/dataAttributes";
import { handleTableCellSelectionKeyDown } from "../utils/tableCellNavigation";

const cleanups: Array<() => void> = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
	document.body.replaceChildren();
});

/**
 * An editor mounted into an iframe's document. Its nodes belong to the
 * iframe's realm, so the host window's `Node`/`Element` constructors do not
 * recognise them.
 */
function createFrame() {
	const iframe = document.createElement("iframe");
	document.body.append(iframe);
	return {
		frameDocument: iframe.contentDocument!,
		frameWindow: iframe.contentWindow as Window & typeof globalThis,
	};
}

function mountInIframe(content: InlineInsert[] = ["Hello world"]) {
	const { frameDocument, frameWindow } = createFrame();
	const editor = createEditor({ schema: defaultSchema });
	const blockId = editor.firstBlock()!.id;
	editor.apply([
		{ type: "splice-text", blockId, from: 0, to: 0, insert: content },
	]);
	const root = frameDocument.createElement("div");
	const input = frameDocument.createElement("input");
	frameDocument.body.append(root, input);
	const focusRequests: FieldEditorFocusRequest[] = [];
	const diagnostics: DiagnosticEvent[] = [];
	editor.on("diagnostic", (event) => diagnostics.push(event));
	const mounted = mountEditor(editor, root, {
		focusPolicy: {
			decide: (request) => {
				focusRequests.push(request);
				return { type: "allow" };
			},
		},
	});
	cleanups.push(() => {
		mounted.destroy();
		editor.destroy();
	});
	return {
		editor,
		blockId,
		root,
		input,
		mounted,
		frameDocument,
		frameWindow,
		focusRequests,
		diagnostics,
	};
}

describe("an editor mounted in an iframe document", () => {
	it("the fixture's nodes are not instances of the host window's constructors", () => {
		const { root, frameWindow } = mountInIframe();
		expect(root instanceof HTMLElement).toBe(false);
		expect(root instanceof frameWindow.HTMLElement).toBe(true);
	});

	it("HOST9: a native input in the iframe keeps focus against an authority write", () => {
		const { editor, blockId, input, mounted, frameDocument, focusRequests } =
			mountInIframe();
		mounted.fieldEditor.activateTextSelection(blockId, 0, 5);
		input.focus();
		expect(frameDocument.activeElement).toBe(input);
		focusRequests.length = 0;

		editor.selectText(blockId, 2, 4);

		expect(focusRequests).toEqual([]);
		expect(frameDocument.activeElement).toBe(input);
	});

	it("P3: a rebuild does not write while a native input in the iframe owns focus", () => {
		const { blockId, input, mounted } = mountInIframe();
		mounted.fieldEditor.activateTextSelection(blockId, 0, 5);
		input.focus();

		expect(
			mounted.fieldEditor.projector.shouldProjectSelectionAfterReconcile(),
		).toBe(false);
	});

	it("W3.R1: a projection with focus on its target reads back as focused, so no mismatch is reported", () => {
		const { editor, blockId, mounted, diagnostics } = mountInIframe();
		mounted.fieldEditor.activateTextSelection(blockId, 0, 5);

		editor.selectText(blockId, 2, 4, { origin: "keyboard" });

		expect(
			diagnostics.filter(
				(event) => event.code === "selection-projection-mismatch",
			),
		).toEqual([]);
	});

	it("R1: a pointerdown on the field inside the iframe opens the pointer window", () => {
		const { root, mounted, frameWindow } = mountInIframe();
		const inline = root.querySelector(`[${DATA_ATTRS.inlineContent}]`);
		expect(inline).not.toBeNull();

		inline!.dispatchEvent(
			new frameWindow.Event("pointerdown", { bubbles: true }),
		);

		expect(mounted.fieldEditor.reader.windows.pointer).toBe(true);
	});

	it("O1: a click on an inline atom chip in the iframe activates its block", () => {
		const { blockId, root, mounted, frameWindow } = mountInIframe([
			"Hi ",
			{ nodeType: "mention", props: { id: "1", label: "Ada" } },
			" there",
		]);
		const chip = root.querySelector(`[${DATA_ATTRS.inlineAtom}]`);
		expect(isInlineAtomChipNode(chip)).toBe(true);

		chip!.dispatchEvent(
			new frameWindow.MouseEvent("mousedown", {
				bubbles: true,
				cancelable: true,
				button: 0,
			}),
		);

		const snapshot = mounted.fieldEditor.getSnapshot();
		expect(snapshot.isEditing).toBe(true);
		expect(snapshot.focusBlockId).toBe(blockId);
	});

	it("T: arrow keys in a native input inside the active table cell in the iframe stay the input's", () => {
		const { frameDocument, frameWindow } = createFrame();
		const editor = createEditor({ schema: defaultSchema });
		cleanups.push(() => editor.destroy());
		editor.apply([
			{
				type: "insert-block",
				blockId: "t1",
				blockType: "table",
				props: {},
				position: "last",
			},
		]);
		editor.selectCell("t1", 0, 0);
		const table = frameDocument.createElement("div");
		table.setAttribute(DATA_ATTRS.blockId, "t1");
		const cell = frameDocument.createElement("div");
		cell.setAttribute("data-cell-row", "0");
		cell.setAttribute("data-cell-col", "0");
		const input = frameDocument.createElement("input");
		cell.append(input);
		table.append(cell);
		frameDocument.body.append(table);
		const fieldEditor = {
			isEditing: false,
			deactivate: vi.fn(),
		} as unknown as FieldEditorTableNavigationController;
		let handled: boolean | null = null;
		input.addEventListener("keydown", (event) => {
			handled = handleTableCellSelectionKeyDown({
				event,
				editor,
				fieldEditor,
				root: table,
			});
		});

		input.dispatchEvent(
			new frameWindow.KeyboardEvent("keydown", {
				key: "ArrowRight",
				bubbles: true,
				cancelable: true,
			}),
		);

		expect(handled).toBe(false);
		const selection = editor.selection;
		expect(selection?.type === "cell" ? selection.head : null).toEqual({
			row: 0,
			col: 0,
		});
	});
});
