import { announceEditorA11y } from "@input/pen-core";
import {
	generateId,
	type DocumentOp,
	type Editor,
	type OpOrigin,
} from "@input/pen-types";
import type { PersistentTextSuggestion } from "../types";
import {
	readAllSuggestions,
	readBlockSuggestionMeta,
	readSuggestionsFromBlock,
} from "./persistent";
import { SUGGESTION_RESOLUTION_ORIGIN } from "./suggestMode";

const RESOLUTION_ORIGIN = SUGGESTION_RESOLUTION_ORIGIN;
type SuggestionResolution = "accept" | "reject";

export function acceptSuggestion(
	editor: Editor,
	suggestionId: string,
): boolean {
	const groupId = generateId();
	return acceptSuggestions(editor, [suggestionId], {
		origin: RESOLUTION_ORIGIN,
		undoGroupId: groupId,
	});
}

export function rejectSuggestion(
	editor: Editor,
	suggestionId: string,
): boolean {
	return rejectSuggestions(editor, [suggestionId]);
}

/**
 * Accepts the given suggestion ids as one undo group.
 *
 * Hosts that staged persistent suggestions headlessly can resolve a chosen
 * id set under their own origin instead of looping {@link acceptSuggestion}
 * or calling {@link acceptAllSuggestions}.
 */
export function acceptSuggestions(
	editor: Editor,
	suggestionIds: readonly string[],
	options?: { origin?: OpOrigin; undoGroupId?: string },
): boolean {
	return resolveSuggestions(editor, suggestionIds, "accept", options);
}

/**
 * Rejects the given suggestion ids as one undo group.
 *
 * Same grouping and origin options as {@link acceptSuggestions}; withdraws
 * the staged writes rather than applying them.
 */
export function rejectSuggestions(
	editor: Editor,
	suggestionIds: readonly string[],
	options?: { origin?: OpOrigin; undoGroupId?: string },
): boolean {
	return resolveSuggestions(editor, suggestionIds, "reject", options);
}

export function acceptAllSuggestions(editor: Editor): void {
	const groupId = generateId();
	resolveSuggestions(editor, getAllSuggestionIds(editor), "accept", {
		origin: RESOLUTION_ORIGIN,
		undoGroupId: groupId,
	});
}

export function rejectAllSuggestions(editor: Editor): void {
	resolveSuggestions(editor, getAllSuggestionIds(editor), "reject");
}

function resolveSuggestions(
	editor: Editor,
	suggestionIds: readonly string[],
	resolution: SuggestionResolution,
	options?: { origin?: OpOrigin; undoGroupId?: string },
): boolean {
	const ops = buildResolutionOps(editor, suggestionIds, resolution);
	if (ops.length === 0) {
		return false;
	}
	editor.apply(ops, {
		origin: options?.origin ?? RESOLUTION_ORIGIN,
		...(options?.undoGroupId
			? { undoGroupId: options.undoGroupId }
			: { undoGroup: true }),
	});
	announceEditorA11y(
		editor,
		resolution === "accept" ? "suggestionAccepted" : "suggestionRejected",
	);
	return true;
}

function buildResolutionOps(
	editor: Editor,
	suggestionIds: readonly string[],
	resolution: SuggestionResolution,
): DocumentOp[] {
	const remainingIds = new Set(suggestionIds);
	if (remainingIds.size === 0) {
		return [];
	}

	const ops: DocumentOp[] = [];
	for (const block of editor.documentState.allBlocks()) {
		const blockSuggestion = readBlockSuggestionMeta(block);
		const blockOps = buildBlockSuggestionResolutionOps(
			block.id,
			blockSuggestion,
			remainingIds,
			resolution,
		);
		if (blockOps.length > 0) {
			ops.push(...blockOps);
		}
		const deletesBlock = blockOps.some((op) => op.type === "delete-block");
		if (deletesBlock) {
			continue;
		}

		const matches = readSuggestionsFromBlock(editor, block.id)
			.filter(
				(item): item is PersistentTextSuggestion =>
					item.kind === "text" && remainingIds.has(item.id),
			)
			.sort((left, right) => right.offset - left.offset);
		if (matches.length === 0) {
			continue;
		}

		for (const suggestion of matches) {
			remainingIds.delete(suggestion.id);
			const cell = suggestion.cell ? { cell: suggestion.cell } : {};
			if (resolution === "accept") {
				if (suggestion.action === "insert") {
					ops.push({
						type: "format-text",
						blockId: block.id,
						from: suggestion.offset,
						to: suggestion.offset + suggestion.length,
						marks: { suggestion: null },
						...cell,
					});
					continue;
				}
				ops.push({
					type: "splice-text",
					blockId: block.id,
					from: suggestion.offset,
					to: suggestion.offset + suggestion.length,
					insert: "",
					...cell,
				});
				continue;
			}

			if (suggestion.action === "insert") {
				ops.push({
					type: "splice-text",
					blockId: block.id,
					from: suggestion.offset,
					to: suggestion.offset + suggestion.length,
					insert: "",
					...cell,
				});
				continue;
			}
			ops.push({
				type: "format-text",
				blockId: block.id,
				from: suggestion.offset,
				to: suggestion.offset + suggestion.length,
				marks: { suggestion: null },
				...cell,
			});
		}
	}

	return ops;
}

function buildBlockSuggestionResolutionOps(
	blockId: string,
	blockSuggestion: ReturnType<typeof readBlockSuggestionMeta>,
	remainingIds: Set<string>,
	resolution: SuggestionResolution,
): DocumentOp[] {
	if (!blockSuggestion || !remainingIds.has(blockSuggestion.id)) {
		return [];
	}
	remainingIds.delete(blockSuggestion.id);

	if (resolution === "accept") {
		switch (blockSuggestion.action) {
			case "insert-block":
			case "split-block":
			case "move-block":
				return [clearSuggestionMeta(blockId)];
			case "convert-block":
				return blockSuggestion.previousState?.props
					? [
							{
								type: "set-props",
								blockId,
								props: blockSuggestion.previousState.props,
							},
							clearSuggestionMeta(blockId),
						]
					: [clearSuggestionMeta(blockId)];
			case "format-text":
				return blockSuggestion.previousState?.format
					? [
							{
								type: "format-text",
								blockId,
								from: blockSuggestion.previousState.format.from,
								to: blockSuggestion.previousState.format.to,
								marks: blockSuggestion.previousState.format
									.marks,
								...(blockSuggestion.previousState.format.cell
									? {
											cell: blockSuggestion.previousState
												.format.cell,
										}
									: {}),
							},
							clearSuggestionMeta(blockId),
						]
					: [clearSuggestionMeta(blockId)];
			case "delete-block":
				return [{ type: "delete-block", blockId }];
			default: {
				const _exhaustive: never = blockSuggestion.action;
				return _exhaustive;
			}
		}
	}

	switch (blockSuggestion.action) {
		case "insert-block":
		case "split-block":
			return [{ type: "delete-block", blockId }];
		case "delete-block":
		case "convert-block":
		case "format-text":
			return [clearSuggestionMeta(blockId)];
		case "move-block":
			return blockSuggestion.previousState?.position
				? [
						{
							type: "move-block",
							blockId,
							position: blockSuggestion.previousState.position,
						},
						clearSuggestionMeta(blockId),
					]
				: [clearSuggestionMeta(blockId)];
		default: {
			const _exhaustive: never = blockSuggestion.action;
			return _exhaustive;
		}
	}
}

function clearSuggestionMeta(blockId: string): DocumentOp {
	return {
		type: "set-meta",
		blockId,
		namespace: "suggestion",
		data: null,
	};
}

function getAllSuggestionIds(editor: Editor): string[] {
	const ids = new Set<string>();
	for (const suggestion of readAllSuggestions(editor)) {
		ids.add(suggestion.id);
	}
	for (const block of editor.documentState.allBlocks()) {
		const meta = readBlockSuggestionMeta(block);
		if (meta?.id) {
			ids.add(meta.id);
		}
	}
	return [...ids];
}
