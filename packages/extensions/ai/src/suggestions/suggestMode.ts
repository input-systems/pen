import type { DocumentOp, Editor, OpOrigin } from "@input/pen-types";
import { getOpOriginType } from "@input/pen-core";
import { generateId } from "@input/pen-types";
import {
	createSuggestionMark,
	serializeBlockSuggestionMeta,
	type BlockSuggestionMetaPayload,
	type SuggestionCreationOptions,
} from "./persistent";
import type { BlockSuggestionMeta, PersistentSuggestion } from "../types";

export const SUGGESTION_RESOLUTION_ORIGIN = "suggestion-resolution";
export const AI_SESSION_SUGGESTION_ORIGIN = "ai-session";

const BYPASS_ORIGINS = new Set([
	AI_SESSION_SUGGESTION_ORIGIN,
	"collaborator",
	"history",
	"import",
	"system",
	"extension",
	SUGGESTION_RESOLUTION_ORIGIN,
]);

export function shouldBypassSuggestMode(origin?: OpOrigin): boolean {
	return origin != null && BYPASS_ORIGINS.has(getOpOriginType(origin));
}

export function transformOpsForSuggestMode(
	ops: DocumentOp[],
	editor: Editor,
	author: string,
	authorType: "user" | "ai",
	model?: string,
	sessionId?: string,
	options: SuggestModeSuggestionOptions = {},
): DocumentOp[] {
	return transformOpsForSuggestModeWithMetadata(
		ops,
		editor,
		author,
		authorType,
		model,
		sessionId,
		options,
	).operations;
}

export type SuggestModeTransformResult = {
	operations: DocumentOp[];
	suggestionIds: string[];
	suggestions: PersistentSuggestion[];
};

export function transformOpsForSuggestModeWithMetadata(
	ops: DocumentOp[],
	editor: Editor,
	author: string,
	authorType: "user" | "ai",
	model?: string,
	sessionId?: string,
	options: SuggestModeSuggestionOptions = {},
): SuggestModeTransformResult {
	const intercepted: DocumentOp[] = [];
	const suggestions: PersistentSuggestion[] = [];
	let suggestionIdIndex = 0;
	const nextSuggestionOptions = (): RequiredSuggestionCreationOptions => {
		const suggestionId =
			options.suggestionIds?.[suggestionIdIndex] ?? generateId();
		suggestionIdIndex += 1;
		return {
			requestId: options.requestId,
			sessionId,
			turnId: options.turnId,
			generationId: options.generationId,
			createdAt: options.createdAt ?? Date.now(),
			suggestionId,
		};
	};
	const pushTextSuggestion = (
		action: "insert" | "delete",
		blockId: string,
		offset: number,
		length: number,
		suggestionOptions: RequiredSuggestionCreationOptions,
		cell?: { row: number; col: number },
	) => {
		suggestions.push({
			kind: "text",
			id: suggestionOptions.suggestionId,
			action,
			author,
			authorType,
			createdAt: suggestionOptions.createdAt,
			model,
			sessionId: suggestionOptions.sessionId,
			requestId: suggestionOptions.requestId,
			turnId: suggestionOptions.turnId,
			generationId: suggestionOptions.generationId,
			blockId,
			offset,
			length,
			...(cell ? { cell } : {}),
		});
	};
	const pushBlockSuggestion = (
		action: BlockSuggestionMeta["action"],
		blockId: string,
		previousState: BlockSuggestionMeta["previousState"],
		suggestionOptions: RequiredSuggestionCreationOptions,
	) => {
		suggestions.push({
			kind: "block",
			id: suggestionOptions.suggestionId,
			action,
			author,
			authorType,
			createdAt: suggestionOptions.createdAt,
			model,
			sessionId: suggestionOptions.sessionId,
			requestId: suggestionOptions.requestId,
			turnId: suggestionOptions.turnId,
			generationId: suggestionOptions.generationId,
			blockId,
			previousState,
		});
	};

	const intent =
		options.origin && typeof options.origin === "object"
			? options.origin.intent
			: undefined;

	for (const op of ops) {
		const pushIntercepted = (nextOp: DocumentOp): void => {
			intercepted.push(copyOpSymbols(op, nextOp));
		};

		if (intent === "pen.splitBlock" && op.type === "insert-block") {
			const suggestionOptions = nextSuggestionOptions();
			pushBlockSuggestion(
				"split-block",
				op.blockId,
				undefined,
				suggestionOptions,
			);
			pushIntercepted(op);
			pushIntercepted({
				type: "set-meta",
				blockId: op.blockId,
				namespace: "suggestion",
				data: createBlockSuggestionMeta(
					"split-block",
					author,
					authorType,
					model,
					undefined,
					sessionId,
					suggestionOptions,
				),
			});
			continue;
		}

		switch (op.type) {
			case "splice-text": {
				const deleteLen = op.to - op.from;
				const insertLen = spliceInsertLength(op.insert);
				if (deleteLen > 0) {
					const suggestionOptions = nextSuggestionOptions();
					pushTextSuggestion(
						"delete",
						op.blockId,
						op.from,
						deleteLen,
						suggestionOptions,
						op.cell,
					);
					pushIntercepted({
						type: "format-text",
						blockId: op.blockId,
						from: op.from,
						to: op.to,
						marks: createSuggestionMark(
							"delete",
							author,
							authorType,
							model,
							sessionId,
							suggestionOptions,
						),
						...(op.cell ? { cell: op.cell } : {}),
					});
				}
				if (insertLen > 0) {
					const suggestionOptions = nextSuggestionOptions();
					pushTextSuggestion(
						"insert",
						op.blockId,
						op.from + deleteLen,
						insertLen,
						suggestionOptions,
						op.cell,
					);
					pushIntercepted({
						...op,
						from: op.from + deleteLen,
						to: op.from + deleteLen,
						marks: {
							...(op.marks ?? {}),
							...createSuggestionMark(
								"insert",
								author,
								authorType,
								model,
								sessionId,
								suggestionOptions,
							),
						},
					});
				}
				if (deleteLen === 0 && insertLen === 0) {
					pushIntercepted(op);
				}
				break;
			}

			case "insert-block": {
				const suggestionOptions = nextSuggestionOptions();
				pushBlockSuggestion(
					"insert-block",
					op.blockId,
					undefined,
					suggestionOptions,
				);
				pushIntercepted(op);
				pushIntercepted({
					type: "set-meta",
					blockId: op.blockId,
					namespace: "suggestion",
					data: createBlockSuggestionMeta(
						"insert-block",
						author,
						authorType,
						model,
						undefined,
						sessionId,
						suggestionOptions,
					),
				});
				break;
			}

			case "delete-block": {
				const suggestionOptions = nextSuggestionOptions();
				pushBlockSuggestion(
					"delete-block",
					op.blockId,
					undefined,
					suggestionOptions,
				);
				pushIntercepted({
					type: "set-meta",
					blockId: op.blockId,
					namespace: "suggestion",
					data: createBlockSuggestionMeta(
						"delete-block",
						author,
						authorType,
						model,
						undefined,
						sessionId,
						suggestionOptions,
					),
				});
				break;
			}

			case "move-block": {
				const block = editor.getBlock(op.blockId);
				const layoutParent = block?.layoutParent();
				const previousState: BlockSuggestionMeta["previousState"] = {
					position: layoutParent
						? {
								parent: layoutParent.id,
								index: block?.index ?? 0,
							}
						: block?.prev
							? { after: block.prev.id }
							: "first",
				};
				const suggestionOptions = nextSuggestionOptions();
				pushBlockSuggestion(
					"move-block",
					op.blockId,
					previousState,
					suggestionOptions,
				);
				pushIntercepted(op);
				pushIntercepted({
					type: "set-meta",
					blockId: op.blockId,
					namespace: "suggestion",
					data: createBlockSuggestionMeta(
						"move-block",
						author,
						authorType,
						model,
						previousState,
						sessionId,
						suggestionOptions,
					),
				});
				break;
			}

			case "set-props": {
				const previousState: BlockSuggestionMeta["previousState"] = {
					type:
						typeof op.props.type === "string"
							? op.props.type
							: undefined,
					props: { ...op.props },
				};
				const suggestionOptions = nextSuggestionOptions();
				pushBlockSuggestion(
					"convert-block",
					op.blockId,
					previousState,
					suggestionOptions,
				);
				pushIntercepted({
					type: "set-meta",
					blockId: op.blockId,
					namespace: "suggestion",
					data: createBlockSuggestionMeta(
						"convert-block",
						author,
						authorType,
						model,
						previousState,
						sessionId,
						suggestionOptions,
					),
				});
				break;
			}

			case "format-text": {
				const previousState: BlockSuggestionMeta["previousState"] = {
					format: {
						from: op.from,
						to: op.to,
						marks: { ...op.marks },
						...(op.cell ? { cell: op.cell } : {}),
					},
				};
				const suggestionOptions = nextSuggestionOptions();
				pushBlockSuggestion(
					"format-text",
					op.blockId,
					previousState,
					suggestionOptions,
				);
				pushIntercepted({
					type: "set-meta",
					blockId: op.blockId,
					namespace: "suggestion",
					data: createBlockSuggestionMeta(
						"format-text",
						author,
						authorType,
						model,
						previousState,
						sessionId,
						suggestionOptions,
					),
				});
				break;
			}

			case "set-meta":
			case "grid":
			case "app":
			case "stream-open":
				pushIntercepted(op);
				break;
			default: {
				const _exhaustive: never = op;
				void _exhaustive;
				pushIntercepted(op);
			}
		}
	}

	return {
		operations: intercepted,
		suggestionIds: suggestions.map((suggestion) => suggestion.id),
		suggestions,
	};
}

function copyOpSymbols(source: DocumentOp, target: DocumentOp): DocumentOp {
	if (source === target) {
		return target;
	}
	for (const key of Object.getOwnPropertySymbols(source)) {
		const descriptor = Object.getOwnPropertyDescriptor(source, key);
		if (descriptor?.enumerable) {
			Object.defineProperty(target, key, descriptor);
		}
	}
	return target;
}

export type SuggestModeSuggestionOptions = {
	requestId?: string;
	turnId?: string;
	generationId?: string;
	createdAt?: number;
	suggestionIds?: readonly string[];
	origin?: OpOrigin;
};

function spliceInsertLength(insert: unknown): number {
	const items = Array.isArray(insert) ? insert : [insert];
	let length = 0;
	for (const item of items) {
		length += typeof item === "string" ? item.length : 1;
	}
	return length;
}

type RequiredSuggestionCreationOptions = SuggestionCreationOptions & {
	suggestionId: string;
	createdAt: number;
};

function createBlockSuggestionMeta(
	action: BlockSuggestionMeta["action"],
	author: string,
	authorType: "user" | "ai",
	model?: string,
	previousState?: BlockSuggestionMeta["previousState"],
	sessionId?: string,
	options: SuggestionCreationOptions = {},
): BlockSuggestionMetaPayload {
	const resolvedSessionId = options.sessionId ?? sessionId;
	const meta: BlockSuggestionMeta = {
		id: options.suggestionId ?? generateId(),
		action,
		author,
		authorType,
		createdAt: options.createdAt ?? Date.now(),
		model,
		previousState,
		sessionId: resolvedSessionId,
		requestId: options.requestId,
		turnId: options.turnId,
		generationId: options.generationId,
	};
	return serializeBlockSuggestionMeta(meta);
}
