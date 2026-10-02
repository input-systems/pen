import {
	generateId,
	type BlockHandle,
	type Editor,
	type InlineDelta,
	type Position,
} from "@input/pen-types";
import type {
	BlockSuggestionMeta,
	BlockSuggestionPreviousState,
	PersistentSuggestion,
} from "../types";

export type BlockSuggestionMetaPayload = BlockSuggestionMeta &
	Record<string, unknown>;

export type SuggestionCreationOptions = {
	suggestionId?: string;
	requestId?: string;
	sessionId?: string;
	turnId?: string;
	generationId?: string;
	createdAt?: number;
};

export function readSuggestionsFromBlock(
	editor: Editor,
	blockId: string,
): PersistentSuggestion[] {
	const block = editor.getBlock(blockId);
	if (!block) {
		return [];
	}

	const suggestions = suggestionsFromDeltas(block.inlineDeltas(), blockId);
	const table = block.as("table");
	if (!table) {
		return suggestions;
	}

	for (let row = 0; row < table.tableRowCount(); row += 1) {
		for (let col = 0; col < table.tableColumnCount(); col += 1) {
			const cell = table.tableCell(row, col);
			if (!cell) {
				continue;
			}
			suggestions.push(
				...suggestionsFromDeltas(cell.inlineDeltas(), blockId, {
					row,
					col,
				}),
			);
		}
	}
	return suggestions;
}

export function readAllSuggestions(editor: Editor): PersistentSuggestion[] {
	const suggestions: PersistentSuggestion[] = [];
	for (const block of editor.documentState.allBlocks()) {
		suggestions.push(...readBlockSuggestions(editor, block));
	}
	return suggestions;
}

/** One block's suggestions: its block-level suggestion, then its inline marks. */
export function readBlockSuggestions(
	editor: Editor,
	block: BlockHandle,
): PersistentSuggestion[] {
	const suggestions: PersistentSuggestion[] = [];
	const blockSuggestion = readBlockSuggestionMeta(block);
	if (blockSuggestion) {
		suggestions.push({
			kind: "block",
			id: blockSuggestion.id,
			action: blockSuggestion.action,
			author: blockSuggestion.author,
			authorType: blockSuggestion.authorType,
			createdAt: blockSuggestion.createdAt,
			model: blockSuggestion.model,
			sessionId: blockSuggestion.sessionId,
			requestId: blockSuggestion.requestId,
			turnId: blockSuggestion.turnId,
			generationId: blockSuggestion.generationId,
			blockId: block.id,
			previousState: blockSuggestion.previousState,
		});
	}
	suggestions.push(...readSuggestionsFromBlock(editor, block.id));
	return suggestions;
}

export function readBlockSuggestionMeta(
	block: BlockHandle | null,
): BlockSuggestionMeta | null {
	if (!block) return null;
	const meta = block.meta("suggestion");
	return parseBlockSuggestionMeta(meta);
}

export function serializeBlockSuggestionMeta(
	meta: BlockSuggestionMeta,
): BlockSuggestionMetaPayload {
	return {
		id: meta.id,
		action: meta.action,
		author: meta.author,
		authorType: meta.authorType,
		createdAt: meta.createdAt,
		model: meta.model,
		sessionId: meta.sessionId,
		requestId: meta.requestId,
		turnId: meta.turnId,
		generationId: meta.generationId,
		previousState: meta.previousState,
	};
}

function parseBlockSuggestionMeta(meta: unknown): BlockSuggestionMeta | null {
	if (!meta || typeof meta !== "object") return null;
	const record = meta as Record<string, unknown>;
	if (
		typeof record.id !== "string" ||
		typeof record.action !== "string" ||
		typeof record.author !== "string" ||
		typeof record.authorType !== "string" ||
		typeof record.createdAt !== "number"
	) {
		return null;
	}

	const action = record.action;
	if (
		action !== "insert-block" &&
		action !== "delete-block" &&
		action !== "move-block" &&
		action !== "convert-block" &&
		action !== "split-block" &&
		action !== "format-text"
	) {
		return null;
	}

	return {
		id: record.id,
		action,
		author: record.author,
		authorType: record.authorType === "ai" ? "ai" : "user",
		createdAt: record.createdAt,
		model: typeof record.model === "string" ? record.model : undefined,
		sessionId:
			typeof record.sessionId === "string" ? record.sessionId : undefined,
		requestId:
			typeof record.requestId === "string" ? record.requestId : undefined,
		turnId: typeof record.turnId === "string" ? record.turnId : undefined,
		generationId:
			typeof record.generationId === "string"
				? record.generationId
				: undefined,
		previousState: readPreviousState(record.previousState),
	};
}

export function createSuggestionMark(
	action: "insert" | "delete",
	author: string,
	authorType: "user" | "ai",
	model?: string,
	sessionId?: string,
	options: SuggestionCreationOptions = {},
): Record<string, unknown> {
	const resolvedSessionId = options.sessionId ?? sessionId;
	return {
		suggestion: {
			id: options.suggestionId ?? generateId(),
			action,
			author,
			authorType,
			createdAt: options.createdAt ?? Date.now(),
			model,
			sessionId: resolvedSessionId,
			requestId: options.requestId,
			turnId: options.turnId,
			generationId: options.generationId,
		},
	};
}

function readPreviousState(
	value: unknown,
): BlockSuggestionMeta["previousState"] | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	return {
		type: typeof record.type === "string" ? record.type : undefined,
		position: isPosition(record.position) ? record.position : undefined,
		props:
			record.props && typeof record.props === "object"
				? { ...(record.props as Record<string, unknown>) }
				: undefined,
		format: readFormatState(record.format),
	};
}

function readFormatState(
	value: unknown,
): BlockSuggestionPreviousState["format"] {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	if (typeof record.from !== "number" || typeof record.to !== "number") {
		return undefined;
	}
	if (!record.marks || typeof record.marks !== "object") {
		return undefined;
	}
	const cell =
		record.cell && typeof record.cell === "object"
			? (record.cell as Record<string, unknown>)
			: null;
	return {
		from: record.from,
		to: record.to,
		marks: { ...(record.marks as Record<string, unknown | null>) },
		...(cell && typeof cell.row === "number" && typeof cell.col === "number"
			? { cell: { row: cell.row, col: cell.col } }
			: {}),
	};
}

function isPosition(value: unknown): value is Position {
	if (value === "first" || value === "last") return true;
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return (
		typeof record.before === "string" ||
		typeof record.after === "string" ||
		(typeof record.parent === "string" && typeof record.index === "number")
	);
}

function asSuggestion(value: unknown): {
	id: string;
	action: "insert" | "delete";
	author: string;
	authorType: "user" | "ai";
	createdAt: number;
	model?: string;
	sessionId?: string;
	requestId?: string;
	turnId?: string;
	generationId?: string;
} | null {
	if (!value || typeof value !== "object") return null;
	const record = value as Record<string, unknown>;
	const action = record.action;
	const authorType = record.authorType;
	if (
		typeof record.id !== "string" ||
		(action !== "insert" && action !== "delete") ||
		typeof record.author !== "string" ||
		(authorType !== "user" && authorType !== "ai") ||
		typeof record.createdAt !== "number"
	) {
		return null;
	}
	return {
		id: record.id,
		action,
		author: record.author,
		authorType,
		createdAt: record.createdAt,
		model: typeof record.model === "string" ? record.model : undefined,
		sessionId:
			typeof record.sessionId === "string" ? record.sessionId : undefined,
		requestId:
			typeof record.requestId === "string" ? record.requestId : undefined,
		turnId: typeof record.turnId === "string" ? record.turnId : undefined,
		generationId:
			typeof record.generationId === "string"
				? record.generationId
				: undefined,
	};
}

function suggestionsFromDeltas(
	deltas: readonly InlineDelta[],
	blockId: string,
	cell?: { row: number; col: number },
): PersistentSuggestion[] {
	const suggestions: PersistentSuggestion[] = [];
	let offset = 0;
	for (const delta of deltas) {
		const length =
			typeof delta.insert === "string" ? delta.insert.length : 1;
		const suggestion = asSuggestion(delta.attributes?.suggestion);
		if (suggestion) {
			suggestions.push({
				kind: "text",
				id: suggestion.id,
				action: suggestion.action,
				author: suggestion.author,
				authorType: suggestion.authorType,
				createdAt: suggestion.createdAt,
				model: suggestion.model,
				sessionId: suggestion.sessionId,
				requestId: suggestion.requestId,
				turnId: suggestion.turnId,
				generationId: suggestion.generationId,
				blockId,
				offset,
				length,
				...(cell ? { cell } : {}),
			});
		}
		offset += length;
	}
	return suggestions;
}
