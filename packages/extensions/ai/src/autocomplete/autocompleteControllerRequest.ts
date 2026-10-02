import {
	fieldEditorHostFacet,
	isCollapsed,
	isMultiBlock,
} from "@input/pen-core";
import { deriveContentMoves, repairAnchor } from "@input/pen-core";
import type { ChangeSummary, FieldEditor } from "@input/pen-types";
import {
	handleModelEvent,
	head,
	normalizeCompletionText,
	tail,
} from "./autocompleteCompletionText";
import type { AutocompleteControllerHost } from "./autocompleteControllerHost";
import {
	resolveContextEligibilityFailure,
	setBlockedReason,
	setState,
} from "./autocompleteControllerState";
import {
	logAutocompleteEvent,
	previewAutocompleteTextForLog,
} from "./autocompleteDebug";
import { buildAutocompleteAIRequest, streamThroughEgress } from "./aiEgress";
import { AUTOCOMPLETE_REQUEST_MODE } from "./constants";
import { showSequenceSuggestion } from "./autocompleteControllerContinuation";
import { buildAutocompleteMessages } from "./promptBuilder";
import { createAutocompleteStructuredCandidate } from "./structuredCandidate";
import type { AutocompleteRequestContext } from "./types";

export async function runRequest(
	controller: AutocompleteControllerHost,
	requestId: string,
): Promise<void> {
	if (controller._state.activeRequestId !== requestId || !controller._model) {
		logAutocompleteEvent("request skipped before start", {
			requestId,
			hasModel: !!controller._model,
			activeRequestId: controller._state.activeRequestId,
		});
		return;
	}
	controller._abortController?.abort();
	const abortController = new AbortController();
	controller._abortController = abortController;
	const context = buildContext(controller);
	if (!context) {
		logAutocompleteEvent("request blocked before prompt build", {
			requestId,
			lastBlockedReason: controller._state.diagnostics.lastBlockedReason,
		});
		setState(controller, {
			status: "idle",
			activeRequestId: null,
		});
		return;
	}
	setState(controller, {
		status: "requesting",
		activeRequestId: requestId,
	});
	logAutocompleteEvent("request started", {
		requestId,
		blockId: context.blockId,
		offset: context.offset,
	});

	const { messages, providerTimings } = await buildAutocompleteMessages({
		context,
		registry: controller._providerRegistry,
		maxProviderChars: controller._maxProviderChars,
		maxProviderTimeMs: controller._maxProviderTimeMs,
		continuationDepth: 0,
	});
	if (!shouldContinueRequest(controller, requestId, context)) {
		logAutocompleteEvent("request cancelled after prompt build", {
			requestId,
			activeRequestId: controller._state.activeRequestId,
			lastBlockedReason: controller._state.diagnostics.lastBlockedReason,
		});
		return;
	}
	setState(controller, { providerTimings });
	logAutocompleteEvent("request prompt ready", {
		requestId,
		providerTimings,
		promptLength: String(messages[1]?.content ?? "").length,
	});
	const startedAt = Date.now();

	let text = "";
	try {
		logAutocompleteEvent("request model stream opening", { requestId });
		for await (const event of streamThroughEgress(
			controller._editor,
			controller._model,
			buildAutocompleteAIRequest(context, messages),
			{
				signal: abortController.signal,
				requestMode: AUTOCOMPLETE_REQUEST_MODE,
			},
		)) {
			if (!shouldContinueRequest(controller, requestId, context)) {
				logAutocompleteEvent("request cancelled during stream", {
					requestId,
					activeRequestId: controller._state.activeRequestId,
					lastBlockedReason:
						controller._state.diagnostics.lastBlockedReason,
				});
				abortController.abort();
				return;
			}
			logAutocompleteEvent("request model event", {
				requestId,
				type: event.type,
			});
			if (
				!handleModelEvent(event, (delta) => {
					text += delta;
				})
			) {
				break;
			}
		}
	} catch {
		// request stream threw; debug log + idle reset below.
		logAutocompleteEvent("request stream threw", {
			requestId,
			aborted: abortController.signal.aborted,
		});
		if (!abortController.signal.aborted) {
			setState(controller, {
				status: "idle",
				activeRequestId: null,
			});
		}
		return;
	}

	if (!shouldContinueRequest(controller, requestId, context)) {
		logAutocompleteEvent("request cancelled after stream", {
			requestId,
			activeRequestId: controller._state.activeRequestId,
			lastBlockedReason: controller._state.diagnostics.lastBlockedReason,
		});
		return;
	}
	if (Date.now() - startedAt > controller._staleAfterMs) {
		logAutocompleteEvent("request dropped as stale", {
			requestId,
			elapsedMs: Date.now() - startedAt,
			staleAfterMs: controller._staleAfterMs,
		});
		setState(controller, {
			status: "idle",
			activeRequestId: null,
			metrics: {
				...controller._state.metrics,
				staleDropCount: controller._state.metrics.staleDropCount + 1,
			},
			diagnostics: {
				...controller._state.diagnostics,
				lastDismissReason: "stale",
			},
		});
		return;
	}
	const normalizedText = normalizeCompletionText(context, text);
	logAutocompleteEvent("request normalized text", {
		requestId,
		blockType: context.blockType,
		rawLength: text.length,
		rawPreview: previewAutocompleteTextForLog(text),
		normalizedLength: normalizedText.length,
		normalizedPreview: previewAutocompleteTextForLog(normalizedText),
	});
	if (!normalizedText) {
		logAutocompleteEvent("request produced empty normalized text", {
			requestId,
			rawLength: text.length,
		});
		setState(controller, {
			status: "idle",
			activeRequestId: null,
		});
		return;
	}

	const candidate = createAutocompleteStructuredCandidate(
		controller._editor,
		normalizedText,
		{
			activeBlockType: context.blockType,
			continuationDepth: 0,
			paragraphGap: controller._paragraphGap,
		},
	);
	controller._continuation.setSequence(
		{
			requestId,
			blockId: context.blockId,
			startOffset: context.offset,
			candidate,
			continuationDepth: 0,
			requestPrefix: context.prefixText,
		},
		controller._editor,
	);
	setState(controller, {
		metrics: {
			...controller._state.metrics,
			successCount: controller._state.metrics.successCount + 1,
		},
	});
	logAutocompleteEvent("request produced suggestion", {
		requestId,
		blockType: context.blockType,
		normalizedLength: normalizedText.length,
		inlineLength: candidate.inlineText.length,
		inlinePreview: previewAutocompleteTextForLog(candidate.inlineText),
		appendedBlockCount: candidate.appendedBlocks.length,
		appendedBlockTypes: candidate.appendedBlocks.map((block) => block.type),
		previewBlockCount: candidate.previewBlocks.length,
	});
	showSequenceSuggestion(controller);
}

export function buildContext(
	controller: AutocompleteControllerHost,
): AutocompleteRequestContext | null {
	const selection = controller._editor.selection;
	if (selection == null) {
		setBlockedReason(controller, "missing-context");
		return null;
	}
	if (selection.type !== "text") {
		setBlockedReason(controller, "selection-not-text");
		return null;
	}
	if (!isCollapsed(selection)) {
		setBlockedReason(controller, "selection-not-collapsed");
		return null;
	}
	if (isMultiBlock(selection)) {
		setBlockedReason(controller, "selection-multi-block");
		return null;
	}
	const fieldEditor = getFieldEditor(controller);
	if (!fieldEditor) {
		setBlockedReason(controller, "field-editor-unavailable");
		return null;
	}
	if (!fieldEditor.isEditing) {
		setBlockedReason(controller, "field-editor-not-editing");
		return null;
	}
	if (!fieldEditor.isFocused) {
		setBlockedReason(controller, "field-editor-not-focused");
		return null;
	}
	if (fieldEditor.isComposing) {
		setBlockedReason(controller, "field-editor-composing");
		return null;
	}
	return buildContextForPosition(
		controller,
		selection.focus.blockId,
		selection.focus.offset,
	);
}

export function buildContextForPosition(
	controller: AutocompleteControllerHost,
	blockId: string,
	offset: number,
): AutocompleteRequestContext | null {
	const block = controller._editor.getBlock(blockId);
	if (!block) {
		setBlockedReason(controller, "block-missing");
		return null;
	}
	const blockPolicyFailure = resolveContextEligibilityFailure(
		controller,
		block.id,
		block.type,
	);
	if (blockPolicyFailure) {
		setBlockedReason(controller, blockPolicyFailure);
		return null;
	}
	const blockText = block.textContent();
	return {
		editor: controller._editor,
		blockId: block.id,
		blockType: block.type,
		offset,
		prefixText: tail(
			blockText.slice(0, offset),
			controller._maxPrefixChars,
		),
		suffixText: head(blockText.slice(offset), controller._maxSuffixChars),
		previousBlockText: tail(
			block.prev?.textContent() ?? "",
			controller._maxNeighborChars,
		),
		nextBlockText: head(
			block.next?.textContent() ?? "",
			controller._maxNeighborChars,
		),
	};
}

function shouldContinueRequest(
	controller: AutocompleteControllerHost,
	requestId: string,
	context: AutocompleteRequestContext,
): boolean {
	if (controller._state.activeRequestId !== requestId) {
		logAutocompleteEvent("request continuation blocked: replaced", {
			requestId,
			activeRequestId: controller._state.activeRequestId,
		});
		return false;
	}
	const selection = controller._editor.selection;
	if (
		selection?.type !== "text" ||
		!isCollapsed(selection) ||
		isMultiBlock(selection) ||
		selection.focus.blockId !== context.blockId ||
		selection.focus.offset !== context.offset
	) {
		logAutocompleteEvent(
			"request continuation blocked: selection changed",
			{
				requestId,
				expected: {
					blockId: context.blockId,
					offset: context.offset,
				},
				actual:
					selection?.type === "text"
						? {
								type: selection.type,
								blockId: selection.focus.blockId,
								offset: selection.focus.offset,
								isCollapsed: isCollapsed(selection),
								isMultiBlock: isMultiBlock(selection),
							}
						: selection,
			},
		);
		return false;
	}
	const fieldEditor = getFieldEditor(controller);
	if (
		!fieldEditor?.isEditing ||
		!fieldEditor.isFocused ||
		fieldEditor.isComposing
	) {
		logAutocompleteEvent(
			"request continuation blocked: field editor state",
			{
				requestId,
				fieldEditor: fieldEditor
					? {
							isEditing: fieldEditor.isEditing,
							isFocused: fieldEditor.isFocused,
							isComposing: fieldEditor.isComposing,
							focusBlockId: fieldEditor.focusBlockId,
						}
					: null,
			},
		);
		return false;
	}
	const block = controller._editor.getBlock(context.blockId);
	const policyFailure = block
		? resolveContextEligibilityFailure(controller, block.id, block.type)
		: "block-missing";
	if (policyFailure) {
		setBlockedReason(controller, policyFailure);
		return false;
	}
	return true;
}

export function remapVisibleSuggestion(
	controller: AutocompleteControllerHost,
	summary: ChangeSummary,
): boolean {
	const visibleSuggestion =
		controller._inlineCompletion.getState().visibleSuggestion;
	if (!visibleSuggestion) {
		controller._visibleAnchor = null;
		controller._visibleSuggestionId = null;
		return true;
	}
	if (
		controller._visibleSuggestionId !== visibleSuggestion.id ||
		!controller._visibleAnchor
	) {
		controller._visibleAnchor = controller._editor.anchors.create(
			{
				blockId: visibleSuggestion.blockId,
				offset: visibleSuggestion.offset,
			},
			1,
		);
		controller._visibleSuggestionId = visibleSuggestion.id;
	}
	if (!controller._visibleAnchor) {
		return controller._editor.getBlock(visibleSuggestion.blockId) != null;
	}
	const moves = deriveContentMoves(summary, undefined);
	controller._visibleAnchor = repairAnchor(
		controller._editor,
		controller._visibleAnchor,
		moves,
	);
	const target = controller._editor.anchors.resolve(
		controller._visibleAnchor,
	);
	if (!target) {
		return (
			controller._editor.getBlock(controller._visibleAnchor.blockId) !=
				null ||
			controller._editor.getBlock(visibleSuggestion.blockId) != null
		);
	}
	if (
		target.blockId !== visibleSuggestion.blockId ||
		target.offset !== visibleSuggestion.offset
	) {
		controller._inlineCompletion.showSuggestion({
			...visibleSuggestion,
			blockId: target.blockId,
			offset: target.offset,
		});
	}
	return true;
}

export function shouldDismissForSelectionChange(
	controller: AutocompleteControllerHost,
): boolean {
	const visibleSuggestion =
		controller._inlineCompletion.getState().visibleSuggestion;
	if (!visibleSuggestion || visibleSuggestion.type !== "inline") {
		return false;
	}
	const selection = controller._editor.selection;
	if (
		selection?.type !== "text" ||
		!isCollapsed(selection) ||
		isMultiBlock(selection)
	) {
		return true;
	}
	return (
		selection.focus.blockId !== visibleSuggestion.blockId ||
		selection.focus.offset !== visibleSuggestion.offset
	);
}

export function getFieldEditor(
	controller: AutocompleteControllerHost,
): FieldEditor | null {
	return (
		(controller._editor.facet(
			fieldEditorHostFacet,
		) as FieldEditor | null) ?? null
	);
}
