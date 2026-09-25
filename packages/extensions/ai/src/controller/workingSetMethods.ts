import { selectionToRange } from "@input/pen-core";
import { exportDocumentRangeAsMarkdown } from "@input/pen-tools";
import type { ToolRuntime } from "@input/pen-types";
import { buildMutationReceipt } from "../runtime/mutationReceipt";
import {
	AI_ANNOTATED_WORKING_SET_MAX_BLOCKS,
	refineRouteWithNavigator,
	type RequestRouterDecision,
} from "../runtime/router";
import type { AIMutationReceipt, AIWorkingSetEnvelope } from "../types";
import type {
	AISelectionWorkingSetContext,
	AISelectionWorkingSetScope,
} from "../types/controller";
import {
	readWorkingSetNavigatorHints,
	readWorkingSetToolContext,
} from "../runtime/generationTarget";
import type { GenerationTarget } from "../helpers";
import { resolveSelectionText } from "../helpers";
import type { AIControllerImpl } from "./aiController";

export const workingSetMethods = {
	_buildFallbackMutationReceipt(
		this: AIControllerImpl,
		input: {
			/**
			 * Whether the assistant text this turn produced became a document
			 * commit. Text alone does not imply one: on the tool channel the
			 * text is the model talking and the edit arrives as a tool call,
			 * which applies directly and leaves no receipt for this path to
			 * describe (`spec/packages/extensions/ai.md` EC1).
			 */
			committedText: boolean;
			suggestionIds: readonly string[];
		},
	): AIMutationReceipt {
		if (input.suggestionIds.length > 0) {
			return buildMutationReceipt({
				status: "staged_suggestions",
			});
		}
		return buildMutationReceipt({
			status: input.committedText ? "applied" : "noop",
		});
	},

	async _buildWorkingSet(
		this: AIControllerImpl,
		toolRuntime: ToolRuntime,
		route: RequestRouterDecision,
		target: GenerationTarget,
		blockId: string,
		_prompt: string,
		scope?: "document" | "block",
		selectionScope: AISelectionWorkingSetScope = "partial",
	): Promise<AIWorkingSetEnvelope | null> {
		const selectionSignature = this._createSelectionSignature(
			this._editor.selection,
		);
		if (target.type === "selection") {
			const selectionRange = selectionToRange(
				this._editor.internals.doc,
				target.selection,
			);
			const trackedBlockIds = [...new Set(selectionRange.blockRange)];
			const viewMode = this._state.suggestMode ? "raw" : "resolved";
			const selectionContext: AISelectionWorkingSetContext =
				selectionScope === "whole-blocks"
					? {
							selectionScope,
							selection: target.selection,
							selectedText: resolveSelectionText(
								this._editor,
								target.selection,
							),
							markdown: exportDocumentRangeAsMarkdown(
								this._editor,
								{
									startBlockId: trackedBlockIds[0],
									endBlockId:
										trackedBlockIds[
											trackedBlockIds.length - 1
										],
								},
								viewMode,
							),
						}
					: {
							selectionScope,
							selection: target.selection,
							selectedText: resolveSelectionText(
								this._editor,
								target.selection,
							),
						};
			return {
				documentVersion: this._documentVersion,
				viewMode,
				source: "selection",
				routeConfidence: route.confidence,
				context: selectionContext,
				trackedBlockIds,
				viewHashes: this._captureBlockViewHashes(trackedBlockIds),
				selectionSignature,
			};
		}

		// Document-scope prompts (e.g. chat) may edit anywhere, so give the
		// editing lanes the whole annotated document instead of a narrow
		// window around the anchor block when the document is small enough.
		// `edit_document` addresses blocks by the ids these annotations carry.
		if (
			scope === "document" &&
			route.editsArriveAsToolCalls &&
			this._editor.blockCount() <= AI_ANNOTATED_WORKING_SET_MAX_BLOCKS
		) {
			const raw = await toolRuntime.executeTool(
				"get_context",
				{
					format: "markdown",
					annotateBlocks: true,
					includeSelection: true,
					includeSuggestions: this._state.suggestMode,
				},
				{} as never,
			);
			const context = readWorkingSetToolContext(raw);
			const trackedBlockIds = [
				...new Set([blockId, ...(context.blockIds ?? [])]),
			];
			return {
				documentVersion: this._documentVersion,
				viewMode: this._state.suggestMode ? "raw" : "resolved",
				source: "document-summary",
				context: {
					...context,
					markdownWindow: {
						blockIds: context.blockIds ?? [blockId],
					},
				},
				routeConfidence: route.confidence,
				trackedBlockIds,
				viewHashes: this._captureBlockViewHashes(trackedBlockIds),
				selectionSignature,
			};
		}

		if (route.useCursorContext) {
			const raw = await toolRuntime.executeTool(
				"get_cursor_context",
				{ includeSuggestions: this._state.suggestMode },
				{} as never,
			);
			const context = readWorkingSetToolContext(raw);
			const hints = readWorkingSetNavigatorHints(raw);
			const trackedBlockIds = [
				blockId,
				...(context.surroundingBlocks ?? []).map((block) => block.id),
			];
			return {
				documentVersion: this._documentVersion,
				viewMode: this._state.suggestMode ? "raw" : "resolved",
				source: "cursor-context",
				context,
				routeConfidence: refineRouteWithNavigator(route, hints)
					.confidence,
				trackedBlockIds: [...new Set(trackedBlockIds)],
				viewHashes: this._captureBlockViewHashes(trackedBlockIds),
				selectionSignature,
			};
		}

		if (route.useDocumentSummary) {
			const raw = await toolRuntime.executeTool(
				"get_context",
				scope === "document"
					? {
							format: "summary",
							includeSelection: true,
							includeSuggestions: this._state.suggestMode,
						}
					: {
							format: "markdown",
							includeSelection: true,
							includeSuggestions: this._state.suggestMode,
							range: {
								startBlockId: blockId,
								endBlockId: blockId,
							},
						},
				{} as never,
			);
			const context = readWorkingSetToolContext(raw);
			const hints = readWorkingSetNavigatorHints(raw);
			const trackedBlockIds = [
				blockId,
				...(context.surroundingBlocks ?? []).map((block) => block.id),
			];
			return {
				documentVersion: this._documentVersion,
				viewMode: this._state.suggestMode ? "raw" : "resolved",
				source: "document-summary",
				context,
				routeConfidence: refineRouteWithNavigator(route, hints)
					.confidence,
				trackedBlockIds: [...new Set(trackedBlockIds)],
				viewHashes: this._captureBlockViewHashes(trackedBlockIds),
				selectionSignature,
			};
		}

		return {
			documentVersion: this._documentVersion,
			viewMode: this._state.suggestMode ? "raw" : "resolved",
			source: "document-summary",
			context: null,
			routeConfidence: route.confidence,
			trackedBlockIds: [blockId],
			viewHashes: this._captureBlockViewHashes([blockId]),
			selectionSignature,
		};
	},

	_refineRouteWithWorkingSet(
		this: AIControllerImpl,
		route: RequestRouterDecision,
		workingSet: AIWorkingSetEnvelope | null,
	): RequestRouterDecision {
		if (!workingSet?.context || typeof workingSet.context !== "object") {
			return route;
		}
		const hints = readWorkingSetNavigatorHints(workingSet.context);
		return refineRouteWithNavigator(route, hints);
	},
};
