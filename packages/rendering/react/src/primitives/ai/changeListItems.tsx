import React from "react";
import { resolveEditorMessage } from "@input/pen-core";
import type { Editor } from "@input/pen-types";
import type { PersistentSuggestion } from "@input/pen-ai";
import {
	describeSuggestionText,
	formatSuggestionAction,
	preventEditorBlur,
} from "./changeListUtils";

export interface RenderAIChangeListItemsArgs {
	editor: Editor;
	suggestions: readonly PersistentSuggestion[];
	acceptSuggestionAndStop(suggestionId: string): void;
	rejectSuggestionAndStop(suggestionId: string): void;
}

export function renderAIChangeListItems(
	args: RenderAIChangeListItemsArgs,
): React.ReactNode[] {
	const {
		editor,
		suggestions,
		acceptSuggestionAndStop,
		rejectSuggestionAndStop,
	} = args;

	const suggestionItems = suggestions.map((suggestion) => {
		const text = describeSuggestionText(editor, suggestion);

		return (
			<div
				key={suggestion.id}
				data-suggestion-id={suggestion.id}
				data-action={suggestion.action}
				data-block-id={suggestion.blockId}
				data-suggestion-item=""
			>
				<div data-suggestion-summary>
					<span data-suggestion-action>
						{formatSuggestionAction(editor, suggestion.action)}
					</span>
					<span data-suggestion-text>
						{text ||
							resolveEditorMessage(
								editor,
								"pen.ai.review.structuralSuggestion",
							)}
					</span>
				</div>
				<div data-suggestion-actions>
					<button
						type="button"
						data-suggestion-button=""
						onMouseDown={preventEditorBlur}
						onClick={() => acceptSuggestionAndStop(suggestion.id)}
					>
						{resolveEditorMessage(editor, "pen.ai.review.accept")}
					</button>
					<button
						type="button"
						data-suggestion-button=""
						onMouseDown={preventEditorBlur}
						onClick={() => rejectSuggestionAndStop(suggestion.id)}
					>
						{resolveEditorMessage(editor, "pen.ai.review.reject")}
					</button>
				</div>
			</div>
		);
	});

	return suggestionItems;
}
