import { createEditor } from "@input/pen-core";
import { yjsAdapter, type YjsCRDTDocument } from "@input/pen-yjs";
import { defaultSchema } from "@input/pen-schema";
import type { DocumentOp, Editor } from "@input/pen-types";
import * as Y from "yjs";

import { undoExtension } from "../undoExtension";

export const TITLE_ID = "fixture-title";
export const BODY_ID = "fixture-body";
export const TITLE_TEXT = "Deterministic fixture";
export const BODY_TEXT = "Stable body text";

export function createUndoEditor() {
	const adapter = yjsAdapter();
	const doc = adapter.createDocument() as YjsCRDTDocument;
	doc.ydoc.clientID = 1;

	adapter.transact(
		doc,
		() => {
			adapter.initBlockMap(doc, TITLE_ID, "heading", "inline");
			adapter.initBlockMap(doc, BODY_ID, "paragraph", "inline");
			const titleMap = doc.penDocument.blocks.get(TITLE_ID);
			const bodyMap = doc.penDocument.blocks.get(BODY_ID);
			const titleContent = titleMap?.get("content");
			const bodyContent = bodyMap?.get("content");
			const titleProps = titleMap?.get("props");
			if (titleContent instanceof Y.Text) {
				titleContent.insert(0, TITLE_TEXT);
			}
			if (bodyContent instanceof Y.Text) {
				bodyContent.insert(0, BODY_TEXT);
			}
			if (titleProps instanceof Y.Map) {
				titleProps.set("level", 2);
			}
			doc.penDocument.blockOrder.push([TITLE_ID, BODY_ID]);
		},
		"system",
	);

	const editor = createEditor({
		schema: defaultSchema,
		crdt: adapter,
		document: doc,
		extensions: [undoExtension({ groupTimeout: 0 })],
	});

	return { adapter, editor };
}

export function snapshot(editor: Editor) {
	return editor.documentState.blockOrder.map((id) => ({
		id,
		text: editor.getBlock(id)?.textContent() ?? "",
	}));
}

export function createEditorWithUndo(
	options: Parameters<typeof createEditor>[0] = {},
) {
	return createEditor({
		schema: defaultSchema,
		...options,
		extensions: [undoExtension(), ...(options.extensions ?? [])],
	});
}

export function splice(
	blockId: string,
	from: number,
	to: number,
	insert: string,
): DocumentOp {
	return { type: "splice-text", blockId, from, to, insert };
}
