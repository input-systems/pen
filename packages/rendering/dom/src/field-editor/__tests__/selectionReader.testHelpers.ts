import { createEditor, getEditorSelectionRecord } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import type { DocumentOp, Editor } from "@input/pen-types";
import { DATA_ATTRS } from "../../utils/dataAttributes";
import { FieldEditorImpl } from "../fieldEditorImpl";

const mounted: Array<{
	editor: Editor;
	root: HTMLElement;
	fieldEditor?: FieldEditorImpl;
}> = [];

/** Destroys every root `seedTextRoot` / `seedActiveField` made; call in `afterEach`. */
export function destroyReaderFixtures(): void {
	for (const fixture of mounted.splice(0)) {
		fixture.fieldEditor?.destroy();
		fixture.root.remove();
		fixture.editor.destroy();
	}
	document.getSelection()?.removeAllRanges();
}

/** An editor whose paragraphs read `texts`, rendered as a minimal root. */
export function seedTextRoot(texts: readonly string[] = ["hello world"]) {
	const editor = createEditor({ schema: defaultSchema });
	const blockIds = texts.map((_text, index) =>
		index === 0 ? editor.firstBlock()!.id : crypto.randomUUID(),
	);
	editor.apply(
		texts.flatMap((text, index): DocumentOp[] => [
			...(index === 0
				? []
				: [
						{
							type: "insert-block" as const,
							blockId: blockIds[index]!,
							blockType: "paragraph",
							props: {},
							position: { after: blockIds[index - 1]! },
						},
					]),
			{
				type: "splice-text",
				blockId: blockIds[index]!,
				from: 0,
				to: 0,
				insert: text,
			},
		]),
	);
	const root = document.createElement("div");
	root.setAttribute(DATA_ATTRS.editorRoot, "");
	const inlines = new Map<string, HTMLElement>();
	texts.forEach((text, index) => {
		const block = document.createElement("div");
		block.setAttribute(DATA_ATTRS.editorBlock, "");
		block.setAttribute(DATA_ATTRS.blockId, blockIds[index]!);
		const inline = document.createElement("div");
		inline.setAttribute(DATA_ATTRS.inlineContent, "");
		inline.textContent = text;
		block.append(inline);
		root.append(block);
		inlines.set(blockIds[index]!, inline);
	});
	document.body.append(root);
	mounted.push({ editor, root });
	const blockId = blockIds[0]!;
	const inline = (id = blockId) => inlines.get(id)!;
	return {
		editor,
		root,
		blockId,
		blockIds,
		inline,
		/** Collapses the native selection at `offset` in a block's text. */
		placeCaret: (offset: number, id = blockId) => {
			document.getSelection()!.collapse(inline(id).firstChild, offset);
		},
		/** Moves the native range inside one block and delivers its selectionchange now. */
		nativeRange: (anchor: number, focus: number, id = blockId) => {
			const text = inline(id).firstChild!;
			document
				.getSelection()!
				.setBaseAndExtent(text, anchor, text, focus);
			document.dispatchEvent(new Event("selectionchange"));
		},
		/** The authority record's origin and state. */
		record: () => {
			const current = getEditorSelectionRecord(editor);
			return current && { origin: current.origin, state: current.state };
		},
		/** A text record `record()` matches, in the first block by default. */
		textRecord: (
			anchor: number,
			focus: number,
			origin: string = "pointer",
			id = blockId,
		) => ({
			origin,
			state: {
				type: "text",
				anchor: { blockId: id, offset: anchor },
				focus: { blockId: id, offset: focus },
			},
		}),
	};
}

/** `seedTextRoot` with a field editor attached and editing the first block, caret at 0. */
export function seedActiveField(texts?: readonly string[]) {
	const seeded = seedTextRoot(texts);
	const { editor, root, blockId } = seeded;
	editor.selectText(blockId, 0, 0);
	const fieldEditor = new FieldEditorImpl(editor);
	mounted.at(-1)!.fieldEditor = fieldEditor;
	fieldEditor.setRootElement(root);
	fieldEditor.activate(blockId);
	return {
		...seeded,
		fieldEditor,
		windows: () => fieldEditor.reader.windows,
		/** A pointerdown on a block's text. */
		press: (pointerType: "touch" | "pen" | "mouse", id = blockId) => {
			seeded.inline(id).dispatchEvent(
				new PointerEvent("pointerdown", {
					bubbles: true,
					button: 0,
					pointerType,
				}),
			);
		},
		/** A document pointerup or pointercancel, then the settle microtask. */
		release: async (type: "pointerup" | "pointercancel" = "pointerup") => {
			document.dispatchEvent(new PointerEvent(type, { bubbles: true }));
			await Promise.resolve();
		},
	};
}
