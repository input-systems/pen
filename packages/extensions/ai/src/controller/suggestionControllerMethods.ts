import { announceEditorA11y } from "@input/pen-core";
import type { ChangeSummary, CommitEvent } from "@input/pen-types";
import type { AIInlineCompletionController } from "../types";
import type { AIControllerImpl } from "./aiController";
import {
	acceptAllSuggestions,
	acceptSuggestion,
	rejectAllSuggestions,
	rejectSuggestion,
	rejectSuggestions,
} from "../suggestions/acceptReject";
import { AI_SESSION_SUGGESTION_ORIGIN } from "../suggestions/suggestMode";
import { areSuggestionsEqual } from "../helpers";

export const suggestionControllerMethods = {
	showEphemeralSuggestion(
		this: AIControllerImpl,
		suggestion: Parameters<
			AIInlineCompletionController["showSuggestion"]
		>[0],
	): void {
		this._inlineCompletion.showSuggestion(suggestion);
		announceEditorA11y(this._editor, "suggestionAppeared");
	},

	dismissEphemeralSuggestion(this: AIControllerImpl): void {
		this._inlineCompletion.dismissSuggestion();
	},

	acceptEphemeralSuggestion(this: AIControllerImpl): void {
		this._inlineCompletion.acceptSuggestion();
	},

	getSuggestions(this: AIControllerImpl) {
		return this._suggestions;
	},

	handleDocumentChange(
		this: AIControllerImpl,
		events: readonly CommitEvent[],
	): void {
		if (events.length > 0) {
			this._documentVersion += 1;
		}
		const previousState = this._state;
		const suggestionsChanged = this._syncSuggestionsFromDocument(
			events.map((event) => event.summary),
		);
		const sessionsChanged = this._syncSessionsFromDocument();
		this.handleExternalCommit(events);
		if (this._state === previousState) {
			this._editor.requestDecorationUpdate();
			if (suggestionsChanged || sessionsChanged) {
				this._emit();
			}
		}
	},

	_syncSuggestionResolutionState(this: AIControllerImpl): void {
		const suggestionsChanged = this._syncSuggestionsFromDocument();
		const sessionsChanged = this._syncSessionsFromDocument();
		if (!suggestionsChanged && !sessionsChanged) {
			return;
		}
		this._editor.requestDecorationUpdate();
		this._emit();
	},

	acceptSuggestion(this: AIControllerImpl, id: string): boolean {
		const accepted = acceptSuggestion(this._editor, id);
		if (accepted) {
			this._syncSuggestionResolutionState();
		}
		return accepted;
	},

	rejectSuggestion(this: AIControllerImpl, id: string): boolean {
		const rejected = rejectSuggestion(this._editor, id);
		if (rejected) {
			this._syncSuggestionResolutionState();
		}
		return rejected;
	},

	_rejectPreviewSuggestions(
		this: AIControllerImpl,
		suggestionIds: readonly string[],
	): void {
		if (suggestionIds.length === 0) {
			return;
		}
		const rejected = rejectSuggestions(this._editor, suggestionIds, {
			origin: AI_SESSION_SUGGESTION_ORIGIN,
			undoGroupId: this._state.activeGeneration?.undoGroupId,
		});
		if (rejected) {
			this._syncSuggestionResolutionState();
		}
	},

	acceptAllSuggestions(this: AIControllerImpl): void {
		acceptAllSuggestions(this._editor);
		this._syncSuggestionResolutionState();
	},

	rejectAllSuggestions(this: AIControllerImpl): void {
		rejectAllSuggestions(this._editor);
		this._syncSuggestionResolutionState();
	},

	/**
	 * With summaries, re-reads only the blocks they touched; without, re-reads
	 * every block (activation, and resolution paths that may run before the
	 * resolving commit is observed).
	 */
	_syncSuggestionsFromDocument(
		this: AIControllerImpl,
		summaries?: readonly ChangeSummary[],
	): boolean {
		const previousCount = this._suggestions.length;
		if (summaries) {
			this._suggestionList.refreshForSummaries(this._editor, summaries);
		} else {
			this._suggestionList.refreshAll(this._editor);
		}
		const nextSuggestions = this._suggestionList.list(this._editor);
		if (areSuggestionsEqual(this._suggestions, nextSuggestions)) {
			return false;
		}
		this._suggestions = nextSuggestions;
		if (nextSuggestions.length > previousCount) {
			announceEditorA11y(this._editor, "suggestionAppeared");
		}
		return true;
	},
};
