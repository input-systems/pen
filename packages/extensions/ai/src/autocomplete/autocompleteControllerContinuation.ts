import { generateId } from "@input/pen-types";
import {
	handleModelEvent,
	normalizeCompletionText,
} from "./autocompleteCompletionText";
import type { AutocompleteControllerHost } from "./autocompleteControllerHost";
import { setState } from "./autocompleteControllerState";
import { acceptFullVisibleSuggestion } from "./autocompleteControllerLifecycle";
import { buildContextForPosition } from "./autocompleteControllerRequest";
import {
	logAutocompleteEvent,
	previewAutocompleteTextForLog,
} from "./autocompleteDebug";
import { buildAutocompleteAIRequest, streamThroughEgress } from "./aiEgress";
import { AUTOCOMPLETE_REQUEST_MODE } from "./constants";
import { buildAutocompleteMessages } from "./promptBuilder";
import { createAutocompleteStructuredCandidate } from "./structuredCandidate";
import type { AutocompleteRequestContext } from "./types";

export function showSequenceSuggestion(
	controller: AutocompleteControllerHost,
): void {
	const sequence = controller._continuation.sequence;
	if (!sequence) {
		return;
	}
	const suggestionId = sequence.requestId;
	const preview = sequence.candidate;
	controller._inlineCompletion.showSuggestion({
		id: suggestionId,
		blockId: sequence.blockId,
		offset: sequence.startOffset,
		text: preview.inlineText,
		type: "inline",
		previewBlocks: preview.previewBlocks,
		accept: () =>
			acceptFullVisibleSuggestion(controller, {
				activateContinuation: true,
			}),
	});
	controller._visibleAnchor = controller._editor.anchors.create(
		{ blockId: sequence.blockId, offset: sequence.startOffset },
		1,
	);
	controller._visibleSuggestionId = suggestionId;
	setState(controller, {
		status: "showing",
		activeRequestId: sequence.requestId,
		visibleSuggestionId: suggestionId,
	});
}

export function startPrefetchForAcceptedContinuation(
	controller: AutocompleteControllerHost,
	options: {
		sourceRequestId: string;
		blockId: string;
		startOffset: number;
		continuationDepth: number;
	},
): void {
	if (!controller._prefetchAfterAccept) {
		return;
	}
	const context = buildContextForPosition(
		controller,
		options.blockId,
		options.startOffset,
	);
	if (!context) {
		return;
	}
	controller._prefetchAbortController?.abort();
	const abortController = new AbortController();
	controller._prefetchAbortController = abortController;
	void runPrefetchRequest(controller, {
		abortController,
		context,
		continuationDepth: options.continuationDepth,
		sourceRequestId: options.sourceRequestId,
	});
}

async function runPrefetchRequest(
	controller: AutocompleteControllerHost,
	options: {
		abortController: AbortController;
		context: AutocompleteRequestContext;
		continuationDepth: number;
		sourceRequestId: string;
	},
): Promise<void> {
	if (!controller._model) {
		return;
	}
	const { abortController, context, continuationDepth, sourceRequestId } =
		options;
	const requestId = generateId();
	const { messages } = await buildAutocompleteMessages({
		context,
		registry: controller._providerRegistry,
		maxProviderChars: controller._maxProviderChars,
		maxProviderTimeMs: controller._maxProviderTimeMs,
		mode: "continuation",
		continuationDepth,
	});
	if (abortController.signal.aborted) {
		return;
	}

	let text = "";
	try {
		for await (const event of streamThroughEgress(
			controller._editor,
			controller._model,
			buildAutocompleteAIRequest(context, messages),
			{
				signal: abortController.signal,
				requestMode: AUTOCOMPLETE_REQUEST_MODE,
			},
		)) {
			if (abortController.signal.aborted) {
				return;
			}
			if (
				!handleModelEvent(event, (delta) => {
					text += delta;
				})
			) {
				break;
			}
		}
	} catch {
		// stream aborted or provider threw; drop this continuation.
		return;
	}

	if (abortController.signal.aborted) {
		return;
	}
	const normalizedText = normalizeCompletionText(context, text);
	if (!normalizedText) {
		logAutocompleteEvent("prefetch produced empty normalized text", {
			requestId,
			sourceRequestId,
			blockType: context.blockType,
			rawLength: text.length,
			rawPreview: previewAutocompleteTextForLog(text),
		});
		return;
	}
	const candidate = createAutocompleteStructuredCandidate(
		controller._editor,
		normalizedText,
		{
			activeBlockType: context.blockType,
			continuationDepth,
			paragraphGap: controller._paragraphGap,
		},
	);
	logAutocompleteEvent("prefetch produced suggestion", {
		requestId,
		sourceRequestId,
		blockType: context.blockType,
		rawLength: text.length,
		rawPreview: previewAutocompleteTextForLog(text),
		normalizedLength: normalizedText.length,
		normalizedPreview: previewAutocompleteTextForLog(normalizedText),
		inlineLength: candidate.inlineText.length,
		inlinePreview: previewAutocompleteTextForLog(candidate.inlineText),
		appendedBlockCount: candidate.appendedBlocks.length,
		appendedBlockTypes: candidate.appendedBlocks.map((block) => block.type),
		previewBlockCount: candidate.previewBlocks.length,
	});
	controller._continuation.setPrefetchedContinuation(
		{
			sourceRequestId,
			requestId,
			blockId: context.blockId,
			startOffset: context.offset,
			candidate,
			continuationDepth,
			requestPrefix: context.prefixText,
		},
		controller._editor,
	);
	activatePendingAcceptedContinuation(controller);
}

function activatePendingAcceptedContinuation(
	controller: AutocompleteControllerHost,
): boolean {
	if (
		!controller._continuation.activatePendingAcceptedContinuation(
			controller._editor.selection,
		)
	) {
		return false;
	}
	showSequenceSuggestion(controller);
	return true;
}

export function clearSequence(controller: AutocompleteControllerHost): void {
	controller._continuation.clearSequence();
}

export function clearVisibleSuggestionAfterAccept(
	controller: AutocompleteControllerHost,
): void {
	clearSequence(controller);
	setState(controller, {
		status: "idle",
		activeRequestId: null,
		visibleSuggestionId: null,
		diagnostics: {
			...controller._state.diagnostics,
			lastDismissReason: "accept",
		},
	});
	controller._inlineCompletion.dismissSuggestion();
}
