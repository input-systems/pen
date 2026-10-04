import { createEditor } from "@input/pen-core";
import type { FieldEditorTextLike } from "@input/pen-dom/field-editor/crdt";
import { defaultPreset } from "@input/pen";

export type BlocksMapLike = {
	get(key: string): { get(field: string): unknown } | undefined;
};

export type RawDocLike = {
	getMap(name: string): BlocksMapLike;
};

export function visibleText(text: string): string {
	return text.replace(/\u200B/g, "");
}

export function getYText(
	editor: ReturnType<typeof createEditor>,
	blockId: string,
): FieldEditorTextLike {
	const adapter = editor.internals.adapter;
	const doc = editor.internals.crdtDoc;
	const ydoc = adapter.raw<RawDocLike>(doc);
	const ytext = ydoc
		.getMap("blocks")
		.get(blockId)
		?.get("content") as FieldEditorTextLike | null;
	if (!ytext) {
		throw new Error(`Missing test Y.Text for block ${blockId}`);
	}
	return ytext;
}

export function editorOpts() {
	return {
		preset: defaultPreset({
			tools: false,
			deltaStream: false,
			undo: false,
		}),
	};
}
