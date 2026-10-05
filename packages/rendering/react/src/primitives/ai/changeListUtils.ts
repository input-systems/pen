import React from "react";
import { resolveEditorMessage } from "@input/pen-core";
import type { Editor } from "@input/pen-types";
import type { PersistentSuggestion } from "@input/pen-ai";

export function preventEditorBlur(event: React.MouseEvent<HTMLButtonElement>) {
	event.preventDefault();
}

export function formatSuggestionAction(editor: Editor, action: string): string {
	switch (action) {
		case "insert":
		case "insert-block":
			return resolveEditorMessage(editor, "pen.ai.review.action.insert");
		case "delete":
		case "delete-block":
			return resolveEditorMessage(editor, "pen.ai.review.action.delete");
		case "move-block":
			return resolveEditorMessage(editor, "pen.ai.review.action.move");
		case "convert-block":
			return resolveEditorMessage(editor, "pen.ai.review.action.convert");
		default:
			return resolveEditorMessage(editor, "pen.ai.review.action.change");
	}
}

/**
 * The text a suggestion covers, or a sentence naming the block change for
 * a structural suggestion.
 */
export function describeSuggestionText(
	editor: Editor,
	suggestion: PersistentSuggestion,
): string {
	const block = editor.getBlock(suggestion.blockId);
	return suggestion.kind === "text"
		? (block
				?.textContent()
				.slice(suggestion.offset, suggestion.offset + suggestion.length) ??
				"")
		: describeBlockSuggestion(editor, suggestion.action, block?.type ?? null);
}

export function describeBlockSuggestion(
	editor: Editor,
	action: string,
	blockType: string | null,
): string {
	const typeLabel =
		blockType ??
		resolveEditorMessage(editor, "pen.ai.review.blockType.fallback");
	switch (action) {
		case "insert-block":
			return resolveEditorMessage(
				editor,
				"pen.ai.review.blockSuggestion.insert",
				{ blockType: typeLabel },
			);
		case "delete-block":
			return resolveEditorMessage(
				editor,
				"pen.ai.review.blockSuggestion.delete",
				{ blockType: typeLabel },
			);
		case "move-block":
			return resolveEditorMessage(
				editor,
				"pen.ai.review.blockSuggestion.move",
				{
					blockType: typeLabel,
				},
			);
		case "convert-block":
			return resolveEditorMessage(
				editor,
				"pen.ai.review.blockSuggestion.convert",
				{ blockType: typeLabel },
			);
		default:
			return typeLabel;
	}
}
