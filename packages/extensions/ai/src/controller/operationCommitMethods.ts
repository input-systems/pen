import type { TextSelection } from "@input/pen-types";
import type { AIContentFormat } from "../runtime/contracts";
import { stagesAsSuggestions } from "../runtime/mutationPolicy";
import { buildMutationReceipt } from "../runtime/mutationReceipt";
import type {
	AIMutationReceipt,
	AIRequestedOperation,
	GenerationState,
} from "../types";
import {
	buildSelectionReplacementOps,
	resolveCommonSelectionMarks,
	resolveFullBlockTextSelection,
	resolveRequestedOperationConflict,
	resolveSelectionForRequestedOperation,
	resolveSelectionText,
} from "../helpers";
import type { AIControllerImpl } from "./aiController";

export const operationCommitMethods = {
	_commitRequestedOperationResult(
		this: AIControllerImpl,
		operation: AIRequestedOperation,
		text: string,
		sessionId: string | undefined,
		options: {
			contentFormat: AIContentFormat;
		},
	): AIMutationReceipt {
		const conflictReason = resolveRequestedOperationConflict(
			this._editor,
			operation,
			this._createSelectionSignature(this._editor.selection),
		);
		if (conflictReason) {
			return buildMutationReceipt({
				status: "invalid",
				issues: [conflictReason],
			});
		}

		if (operation.kind === "rewrite-selection") {
			const selection = resolveSelectionForRequestedOperation(
				this._editor,
				operation,
			);
			if (!selection) {
				return buildMutationReceipt({
					status: "invalid",
					issues: [
						"The requested selection rewrite target is no longer available.",
					],
				});
			}
			const markdownBlockIds =
				options.contentFormat === "markdown" &&
				operation.target.kind === "scoped-range" &&
				operation.target.blockIds.length > 0
					? operation.target.blockIds
					: null;
			if (markdownBlockIds) {
				return this._commitBufferedBlockGeneration(
					markdownBlockIds[0],
					text,
					"persistent-suggestions",
					"markdown",
					sessionId,
					{
						replaceTargetBlock: true,
						replaceBlockIds: markdownBlockIds,
					},
				);
			}
			return this._commitSelectionRewrite(
				selection,
				text,
				"persistent-suggestions",
				sessionId,
			);
		}

		if (operation.kind === "rewrite-block") {
			const target =
				operation.target.kind === "block" ? operation.target : null;
			if (!target) {
				return buildMutationReceipt({
					status: "invalid",
					issues: ["The requested block rewrite target is invalid."],
				});
			}
			const selection = resolveFullBlockTextSelection(
				this._editor,
				target.blockId,
			);
			if (selection && options.contentFormat === "text") {
				return this._commitSelectionRewrite(
					selection,
					text,
					"persistent-suggestions",
					sessionId,
				);
			}
			return this._commitBufferedBlockGeneration(
				target.blockId,
				text,
				"persistent-suggestions",
				options.contentFormat,
				sessionId,
				{
					replaceTargetBlock: true,
				},
			);
		}

		if (operation.kind === "document-transform") {
			const target =
				operation.target.kind === "document" ? operation.target : null;
			if (!target) {
				return buildMutationReceipt({
					status: "invalid",
					issues: [
						"The requested document transform target is invalid.",
					],
				});
			}
			const replaceBlockIds = target.blockIds?.filter(
				(blockId) => this._editor.getBlock(blockId) != null,
			);
			if (target.transform === "remove") {
				const deleteBlockIds =
					replaceBlockIds && replaceBlockIds.length > 0
						? replaceBlockIds
						: this._editor.documentState.blockOrder.filter(
								(blockId) =>
									this._editor.getBlock(blockId) != null,
							);
				const ops = deleteBlockIds.map((blockId) => ({
					type: "delete-block" as const,
					blockId,
				}));
				if (ops.length === 0) {
					return buildMutationReceipt({
						status: "noop",
					});
				}
				this._applySuggestedAIOps(ops, sessionId);
				return buildMutationReceipt({
					status: "staged_suggestions",
					ops,
				});
			}
			const targetBlockId =
				target.activeBlockId ??
				replaceBlockIds?.[0] ??
				this._editor.lastBlock()?.id ??
				this._editor.firstBlock()?.id ??
				null;
			if (!targetBlockId) {
				return buildMutationReceipt({
					status: "invalid",
					issues: [
						"The requested document transform target is no longer available.",
					],
				});
			}
			return this._commitBufferedBlockGeneration(
				targetBlockId,
				text,
				"persistent-suggestions",
				options.contentFormat,
				sessionId,
				{
					replaceTargetBlock:
						target.placement === "replace-blocks" ||
						target.placement === "replace-empty-block" ||
						(replaceBlockIds?.length ?? 0) > 0,
					replaceBlockIds,
				},
			);
		}

		const target =
			operation.target.kind === "block" ? operation.target : null;
		if (!target) {
			return buildMutationReceipt({
				status: "invalid",
				issues: ["The requested continuation target is invalid."],
			});
		}
		return this._commitBufferedBlockGeneration(
			target.blockId,
			text,
			"persistent-suggestions",
			"text",
			sessionId,
			{
				insertionOffset: target.insertionOffset,
			},
		);
	},

	_commitSelectionRewrite(
		this: AIControllerImpl,
		selection: TextSelection,
		text: string,
		mutationMode: NonNullable<GenerationState["mutationMode"]>,
		sessionId?: string,
	): AIMutationReceipt {
		const selectedText = resolveSelectionText(this._editor, selection);
		const commonMarks = resolveCommonSelectionMarks(
			this._editor,
			selection,
		);
		const ops = buildSelectionReplacementOps(
			this._editor,
			selection,
			text,
			commonMarks,
		);
		if (stagesAsSuggestions(mutationMode)) {
			this._applySuggestedAIOps(ops, sessionId);
			this._recordCommitDebug({
				attempted: true,
				succeeded: true,
				executionPath: "selection-replacement",
				contextChars: selectedText.length,
				diffChars: text.length,
			});
			return buildMutationReceipt({
				status: "staged_suggestions",
				ops,
			});
		}
		this._editor.selectTextRange(selection.anchor, selection.focus);
		this._editor.deleteSelection({ origin: "ai" });
		const nextSelection = this._editor.selection;
		if (nextSelection?.type !== "text") {
			this._recordCommitDebug({
				attempted: true,
				succeeded: false,
				contextChars: selectedText.length,
				diffChars: text.length,
				fallbackReason: "selection-lost",
			});
			return buildMutationReceipt({
				status: "invalid",
				ops,
				issues: ["Selection rewrite lost the active text selection."],
			});
		}
		const caret = nextSelection.anchor;
		if (text.length > 0) {
			this._editor.apply(
				[
					{
						type: "splice-text",
						blockId: caret.blockId,
						from: caret.offset,
						to: caret.offset,
						insert: text,
						...(commonMarks ? { marks: commonMarks } : {}),
					},
				],
				{ origin: "ai" },
			);
		}
		this._editor.selectTextRange(
			{
				blockId: caret.blockId,
				offset: caret.offset + text.length,
			},
			{
				blockId: caret.blockId,
				offset: caret.offset + text.length,
			},
		);
		this._recordCommitDebug({
			attempted: true,
			succeeded: true,
			executionPath: "selection-replacement",
			contextChars: selectedText.length,
			diffChars: text.length,
		});
		return buildMutationReceipt({
			status: "applied",
			ops,
		});
	},
};
