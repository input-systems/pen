import { isCollapsed } from "@input/pen-core";
import { setInlineMark } from "@input/pen-shortcuts";
import type { Editor } from "@input/pen-types";
import type { FieldEditorTransferController } from "./controller";
import { resolveEditorUrl } from "../security/resolveEditorUrl";

function resolvePastedLinkUrl(
	editor: Editor,
	plainText: string,
): string | null {
	const candidate = plainText.trim();
	if (!candidate || containsWhitespace(candidate)) {
		return null;
	}

	try {
		new URL(candidate);
	} catch {
		return null;
	}

	return resolveEditorUrl(editor, candidate, "link");
}

function containsWhitespace(value: string): boolean {
	for (const character of value) {
		if (!character.trim()) {
			return true;
		}
	}
	return false;
}

function tryPasteUrlAsLink(
	editor: Editor,
	url: string,
	fieldEditor?: FieldEditorTransferController,
): boolean {
	const selection = editor.selection;
	if (!selection || selection.type !== "text") {
		return false;
	}

	if (!isCollapsed(selection)) {
		return setInlineMark(editor, "link", { href: url });
	}

	if (
		!editor.schema.resolveInline("link") ||
		!canInsertLinkAtCaret(editor, selection.anchor.blockId)
	) {
		return false;
	}

	const { blockId, offset } = selection.anchor;
	editor.apply(
		[
			{
				type: "splice-text",
				blockId,
				from: offset,
				to: offset,
				insert: url,
				marks: { link: { href: url } },
			},
		],
		{ origin: "user" },
	);

	const nextOffset = offset + url.length;
	if (fieldEditor) {
		fieldEditor.activateTextSelection(blockId, nextOffset, nextOffset);
	} else {
		editor.selectText(blockId, nextOffset, nextOffset);
	}
	return true;
}

function canInsertLinkAtCaret(editor: Editor, blockId: string): boolean {
	const block = editor.getBlock(blockId);
	if (!block) {
		return false;
	}

	const schema = editor.schema.resolve(block.type);
	return (
		schema?.content === "inline" &&
		(!schema.fieldEditor || schema.fieldEditor === "richtext")
	);
}

/**
 * Paste a clipboard plain-text URL as an inline link at the current selection.
 *
 * When the selection is collapsed, inserts the URL as linked text at the caret.
 * When text is selected, wraps the selection in a link mark. Returns false when
 * `plainText` is not a URL, the URL is denied by `urlPolicy`, or the caret is
 * not in an inline richtext block.
 */
export function tryPasteClipboardUrlAsLink(
	editor: Editor,
	plainText: string,
	fieldEditor?: FieldEditorTransferController,
): boolean {
	const url = resolvePastedLinkUrl(editor, plainText);
	if (!url) {
		return false;
	}
	return tryPasteUrlAsLink(editor, url, fieldEditor);
}
