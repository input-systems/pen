import {
	isCollapsed,
	renderSelectionTargetBlockText,
	resolveSelectionTargetBlockIds,
} from "@input/pen-core";
import {
	isScopedSelectionTarget,
	type Editor,
	type TextSelection,
} from "@input/pen-types";
import type { AIContentFormat } from "../runtime/contracts";
import { isClearDocumentPrompt } from "../runtime/promptTargeting";
import { classifyPromptIntent } from "../runtime/router";
import type {
	AICommandExecutionOptions,
	AIRequestedOperation,
	AISession,
	ResolvedEditTarget,
} from "../types";
import { areStructuredValuesEqual } from "./equality";
import {
	canUseLocalBlockTextOperation,
	createContinueBlockOperation,
	createDocumentTransformOperation,
	createRewriteBlockOperation,
	createRewriteSelectionOperationFromResolvedTarget,
	resolveFullBlockTextSelection,
} from "./operationFactories";
import { resolveResolvedEditProposal } from "./resolvedEditTarget";
import { resolveSelectionText } from "./selection";
import { recreateTextSelection, selectionMatchesSnapshot } from "./session";
import {
	resolveActiveBlockId,
	resolveSessionBlockId,
	resolveSessionSelectionSnapshot,
} from "./types";

export function resolveRequestedOperationForSession(
	editor: Editor,
	session: AISession,
	prompt: string,
	options: AICommandExecutionOptions | undefined,
	documentVersion: number,
): AIRequestedOperation {
	const explicitTarget = options?.target;
	const promptIntent = classifyPromptIntent(prompt);
	const capturedSelection = resolveSessionSelectionTarget(editor, session);
	const liveSelection =
		session.surface === "inline-edit"
			? capturedSelection
			: editor.selection?.type === "text" &&
				  !isCollapsed(editor.selection)
				? editor.selection
				: capturedSelection;
	const activeBlockId =
		options?.blockId ??
		resolveSessionBlockId(editor, session) ??
		resolveActiveBlockId(editor.selection) ??
		editor.lastBlock()?.id ??
		editor.firstBlock()?.id ??
		null;
	const documentActiveBlockId =
		options?.blockId ??
		resolveActiveBlockId(editor.selection) ??
		session.anchor?.blockId ??
		null;
	const resolvedEditProposal = resolveResolvedEditProposal(
		editor,
		session,
		prompt,
		promptIntent,
		explicitTarget,
		liveSelection,
		"markdown",
	);
	const clearDocument =
		session.target.kind === "document" && isClearDocumentPrompt(prompt);
	const documentBlockIds = editor.documentState.blockOrder.filter(
		(blockId) => editor.getBlock(blockId) != null,
	);
	const documentTransformPlan = clearDocument
		? {
				blockIds: documentBlockIds,
				placement: "replace-blocks" as const,
				transform: "remove" as const,
			}
		: undefined;

	if (resolvedEditProposal) {
		return createRewriteSelectionOperationFromResolvedTarget(
			editor,
			resolvedEditProposal.target,
			resolvedEditProposal.promptIntent,
			documentVersion,
		);
	}
	if (promptIntent === "continue" && activeBlockId) {
		if (!canUseLocalBlockTextOperation(editor, activeBlockId)) {
			return createDocumentTransformOperation(
				editor,
				activeBlockId,
				promptIntent,
				documentVersion,
				{
					blockIds: [activeBlockId],
					placement: "append-after-block",
					transform: "write",
				},
			);
		}
		return createContinueBlockOperation(
			editor,
			activeBlockId,
			promptIntent,
			documentVersion,
		);
	}
	if (
		activeBlockId &&
		(promptIntent === "rewrite" ||
			(promptIntent === "local-edit" &&
				(editor.getBlock(activeBlockId)?.textContent().length ?? 0) >
					0) ||
			explicitTarget === "block")
	) {
		if (!canUseLocalBlockTextOperation(editor, activeBlockId)) {
			return createDocumentTransformOperation(
				editor,
				activeBlockId,
				promptIntent,
				documentVersion,
				{
					blockIds: [activeBlockId],
					placement: "replace-blocks",
					transform: "rewrite",
				},
			);
		}
		return createRewriteBlockOperation(
			editor,
			activeBlockId,
			promptIntent,
			documentVersion,
		);
	}
	if (explicitTarget === "document") {
		return createDocumentTransformOperation(
			editor,
			documentActiveBlockId,
			promptIntent,
			documentVersion,
			documentTransformPlan,
		);
	}
	return createDocumentTransformOperation(
		editor,
		session.target.kind === "document"
			? documentActiveBlockId
			: activeBlockId,
		promptIntent,
		documentVersion,
		documentTransformPlan,
	);
}

export function resolveLocalOperationContentFormat(
	editor: Editor,
	operation: AIRequestedOperation,
	defaultBlockFormat: AIContentFormat,
): AIContentFormat {
	if (operation.kind === "rewrite-selection") {
		return operation.target.kind === "scoped-range"
			? operation.target.contentFormat
			: "text";
	}
	if (operation.kind === "document-transform") {
		return defaultBlockFormat;
	}
	if (operation.kind !== "rewrite-block") {
		return "text";
	}
	const blockId =
		operation.target.kind === "block" ? operation.target.blockId : null;
	if (blockId && resolveFullBlockTextSelection(editor, blockId)) {
		return "text";
	}
	return defaultBlockFormat;
}

/**
 * The content format a block-scoped selection rewrite committed to when it
 * was resolved, or null for any other operation. A live selection over whole
 * blocks is resolved this way so the reply lands as blocks; the generation
 * that runs it has to request, preview, and commit in that same format.
 */
export function resolveScopedSelectionRewriteContentFormat(
	operation: AIRequestedOperation | null | undefined,
): AIContentFormat | null {
	return operation?.kind === "rewrite-selection" &&
		operation.target.kind === "scoped-range"
		? operation.target.contentFormat
		: null;
}

export function canReuseBottomChatSessionOperation(
	previousOperation: AIRequestedOperation,
	nextOperation: AIRequestedOperation,
): boolean {
	const previousResolvedTarget =
		resolveResolvedEditTargetFromRequestedOperation(previousOperation);
	const nextResolvedTarget =
		resolveResolvedEditTargetFromRequestedOperation(nextOperation);
	if (previousResolvedTarget && nextResolvedTarget) {
		return areResolvedEditTargetsEqual(
			previousResolvedTarget,
			nextResolvedTarget,
		);
	}
	if (previousOperation.kind !== nextOperation.kind) {
		return false;
	}
	if (previousOperation.target.kind !== nextOperation.target.kind) {
		return false;
	}
	if (
		previousOperation.target.kind === "selection" ||
		previousOperation.target.kind === "scoped-range"
	) {
		if (
			nextOperation.target.kind !== "selection" &&
			nextOperation.target.kind !== "scoped-range"
		) {
			return false;
		}
		return (
			previousOperation.provenance?.selectionSignature ===
				nextOperation.provenance?.selectionSignature &&
			previousOperation.target.sourceText ===
				nextOperation.target.sourceText
		);
	}
	if (previousOperation.target.kind === "block") {
		if (nextOperation.target.kind !== "block") {
			return false;
		}
		return (
			previousOperation.target.blockId === nextOperation.target.blockId &&
			previousOperation.provenance?.syncedGeneration ===
				nextOperation.provenance?.syncedGeneration
		);
	}
	if (nextOperation.target.kind !== "document") {
		return false;
	}
	return (
		previousOperation.target.activeBlockId ===
			nextOperation.target.activeBlockId &&
		areStructuredValuesEqual(
			previousOperation.target.blockIds ?? [],
			nextOperation.target.blockIds ?? [],
		) &&
		(previousOperation.target.placement ?? null) ===
			(nextOperation.target.placement ?? null) &&
		(previousOperation.target.transform ?? null) ===
			(nextOperation.target.transform ?? null)
	);
}

function resolveResolvedEditTargetFromRequestedOperation(
	operation: AIRequestedOperation,
): ResolvedEditTarget | null {
	if (
		operation.target.kind !== "selection" &&
		operation.target.kind !== "scoped-range"
	) {
		return null;
	}
	return operation.target;
}

function areResolvedEditTargetsEqual(
	previousTarget: ResolvedEditTarget,
	nextTarget: ResolvedEditTarget,
): boolean {
	if (previousTarget.kind !== nextTarget.kind) {
		return false;
	}
	if (
		previousTarget.blockId !== nextTarget.blockId ||
		previousTarget.sourceText !== nextTarget.sourceText ||
		previousTarget.anchor.blockId !== nextTarget.anchor.blockId ||
		previousTarget.anchor.offset !== nextTarget.anchor.offset ||
		previousTarget.focus.blockId !== nextTarget.focus.blockId ||
		previousTarget.focus.offset !== nextTarget.focus.offset
	) {
		return false;
	}
	if (
		previousTarget.kind === "scoped-range" &&
		nextTarget.kind === "scoped-range"
	) {
		return (
			previousTarget.scope === nextTarget.scope &&
			previousTarget.contentFormat === nextTarget.contentFormat &&
			areStructuredValuesEqual(
				previousTarget.blockIds,
				nextTarget.blockIds,
			)
		);
	}
	return true;
}

export function resolveSelectionForRequestedOperation(
	editor: Editor,
	operation: AIRequestedOperation,
): TextSelection | null {
	if (
		operation.target.kind !== "selection" &&
		operation.target.kind !== "scoped-range"
	) {
		return null;
	}
	return recreateTextSelection(editor, {
		anchor: operation.target.anchor,
		focus: operation.target.focus,
		blockRange: resolveSelectionTargetBlockIds(editor, operation.target),
		isMultiBlock:
			resolveSelectionTargetBlockIds(editor, operation.target).length >
				1 ||
			operation.target.anchor.blockId !== operation.target.focus.blockId,
	});
}

export function resolveBlockIdForRequestedOperation(
	operation: AIRequestedOperation,
): string | null {
	if (operation.target.kind === "block") {
		return operation.target.blockId;
	}
	if (
		operation.target.kind === "selection" ||
		operation.target.kind === "scoped-range"
	) {
		return operation.target.blockId;
	}
	return operation.target.activeBlockId;
}

export function resolveRequestedOperationConflict(
	editor: Editor,
	operation: AIRequestedOperation,
	currentSelectionSignature: string | null,
): string | null {
	if (
		operation.target.kind === "selection" ||
		operation.target.kind === "scoped-range"
	) {
		const selection = resolveSelectionForRequestedOperation(
			editor,
			operation,
		);
		if (!selection) {
			return "The selected range no longer exists.";
		}
		if (isScopedSelectionTarget(operation.target)) {
			if (
				renderSelectionTargetBlockText(editor, operation.target) !==
				operation.target.sourceText
			) {
				return "The selected text changed before the rewrite completed.";
			}
			return null;
		}
		if (
			operation.provenance?.selectionSignature != null &&
			operation.provenance.selectionSignature !==
				currentSelectionSignature
		) {
			return "The selected range changed before the rewrite completed.";
		}
		if (
			resolveSelectionText(editor, selection) !==
			operation.target.sourceText
		) {
			return "The selected text changed before the rewrite completed.";
		}
		return null;
	}
	if (operation.target.kind === "block") {
		const block = editor.getBlock(operation.target.blockId);
		if (!block) {
			return "The target block no longer exists.";
		}
		return null;
	}
	if (
		operation.provenance?.syncedGeneration != null &&
		editor.documentState.generation !==
			operation.provenance.syncedGeneration
	) {
		return "The document changed before the operation completed.";
	}
	return null;
}

function resolveSessionSelectionTarget(
	editor: Editor,
	session: AISession,
): TextSelection | null {
	const anchorSelection = session.contextualPrompt?.anchor.selectionSnapshot;
	if (session.target.kind !== "selection" && !anchorSelection) {
		return null;
	}
	const activeTurnSelection = session.activeTurnId
		? session.turns.find((turn) => turn.id === session.activeTurnId)
				?.selection
		: session.turns[session.turns.length - 1]?.selection;
	if (activeTurnSelection) {
		const restoredSelection = recreateTextSelection(
			editor,
			activeTurnSelection,
		);
		if (!isCollapsed(restoredSelection)) {
			return restoredSelection;
		}
	}
	const selection = editor.selection;
	if (
		selection?.type === "text" &&
		!isCollapsed(selection) &&
		selectionMatchesSnapshot(
			editor,
			selection,
			session.target.kind === "selection"
				? resolveSessionSelectionSnapshot(
						editor,
						session.target.selection,
					)
				: (anchorSelection ?? null),
		)
	) {
		return selection;
	}
	if (anchorSelection) {
		const restoredSelection = recreateTextSelection(
			editor,
			anchorSelection,
		);
		if (!isCollapsed(restoredSelection)) {
			return restoredSelection;
		}
	}
	if (
		session.target.kind === "selection" &&
		!isCollapsed(session.target.selection)
	) {
		return session.target.selection;
	}
	return null;
}
