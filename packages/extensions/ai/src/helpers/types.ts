import {
	getSelectionBlockRange,
	isCollapsed,
	isMultiBlock,
	selectionToRange,
} from "@input/pen-core";
import type {
	Editor,
	ModelAdapter,
	SelectionState,
	TextSelection,
	ToolDefinition,
	ToolRuntime,
} from "@input/pen-types";
import type {
	AIControllerState,
	AIInlineHistoryDirection,
	AIRequestedOperation,
	AISession,
	AISessionSelectionSnapshot,
	AIStreamEvent,
	AISurface,
	GenerationState,
} from "../types";

export type GenerationTarget =
	| {
			type: "block";
			blockId: string;
			offset: number;
	  }
	| {
			type: "selection";
			selection: TextSelection;
	  };

export interface GenerationExecutionContext {
	sessionId?: string;
	surface?: AISurface;
	targetType?: GenerationTarget["type"];
	/** "document" when the prompt may edit anywhere, not just around the anchor block. */
	scope?: "document" | "block";
	operation?: AIRequestedOperation | null;
	replaceTargetBlock?: boolean;
	replaceBlockIds?: string[];
}

export function resolveGenerationRequestMode(
	context?: GenerationExecutionContext,
): string | undefined {
	if (context?.operation?.kind === "rewrite-selection") {
		if (context.surface === "inline-edit") {
			return "inline-edit";
		}
		if (context.surface === "bottom-chat") {
			return "selection-rewrite";
		}
	}
	if (context?.targetType === "selection") {
		if (context.surface === "inline-edit") {
			return "inline-edit";
		}
		if (context.surface === "bottom-chat") {
			return "selection-rewrite";
		}
	}
	if (context?.surface === "inline-edit") {
		return "inline-edit";
	}
	if (context?.surface === "bottom-chat") {
		return "bottom-chat";
	}
	return undefined;
}

export function isLocalRequestedOperation(
	operation: AIRequestedOperation | null | undefined,
): operation is AIRequestedOperation {
	return (
		operation?.kind === "rewrite-selection" ||
		operation?.kind === "rewrite-block" ||
		operation?.kind === "continue-block" ||
		(operation?.kind === "document-transform" &&
			operation.target.kind === "document" &&
			(operation.target.transform === "rewrite" ||
				operation.target.transform === "remove" ||
				operation.target.placement === "replace-blocks"))
	);
}

export const EMPTY_TOOL_RUNTIME: ToolRuntime = {
	registerTool(_def: ToolDefinition): void {},
	unregisterTool(_name: string): void {},
	listTools(): readonly ToolDefinition[] {
		return [];
	},
	getTool(): ToolDefinition | null {
		return null;
	},
	async executeTool(name: string): Promise<unknown> {
		throw new Error(`Unknown tool: "${name}"`);
	},
};

export const MAX_STREAM_EVENTS = 200;

export const AI_UNDO_HISTORY_METADATA_KEY = "ai:inline-session-history";

export interface AIInlineHistoryRestoreRequest {
	direction: AIInlineHistoryDirection;
	targetSnapshotId: string;
	targetDocumentVersion: number;
	shortcutOnly?: boolean;
	sessionId?: string | null;
	targetState?: AIInlineShortcutHistoryState | null;
}

type AIInlineShortcutHistoryPhase = "none" | "review" | "resolved";

export interface AIInlineShortcutHistoryState {
	sessionId: string | null;
	phase: AIInlineShortcutHistoryPhase;
	turnCount: number;
	turnId: string | null;
	resolution?: "accepted" | "rejected";
}

export interface AIInlineShortcutHistoryWaypoint {
	startIndex: number;
	endIndex: number;
	representativeIndex: number;
	state: AIInlineShortcutHistoryState;
}

export function resolveActiveBlockId(selection: SelectionState): string | null {
	if (!selection) return null;
	if (selection.type === "text") return selection.focus.blockId;
	if (selection.type === "block") return selection.blockIds[0] ?? null;
	if (selection.type === "cell") return selection.blockId;
	return null;
}

export function readModelId(
	model: ModelAdapter | undefined,
): string | undefined {
	if (!model || typeof model !== "object") return undefined;
	const candidate = model as ModelAdapter & {
		name?: string;
		modelId?: string;
	};
	return candidate.modelId ?? candidate.name;
}

type AIStreamEventInput =
	| {
			type: "generation-start";
			prompt: string;
			target: GenerationState["target"];
	  }
	| {
			type: "status";
			status: AIControllerState["status"];
	  }
	| {
			type: "text-delta";
			delta: string;
			text: string;
	  }
	| {
			type: "operation";
			operation: AIRequestedOperation;
			phase: "preview" | "final" | "conflict";
			text?: string;
			reason?: string;
	  }
	| {
			type: "tool-call";
			toolCallId: string;
			toolName: string;
			input: unknown;
	  }
	| {
			type: "tool-output";
			toolCallId: string;
			toolName: string;
			part: unknown;
			output: unknown;
	  }
	| {
			type: "tool-result";
			toolCallId: string;
			toolName: string;
			output: unknown;
			state: "complete" | "error";
	  }
	| {
			type: "generation-finish";
			status: GenerationState["status"];
			text: string;
	  };

export function createAIStreamEvent(
	generation: Pick<
		GenerationState,
		"id" | "zoneId" | "blockId" | "sessionId"
	>,
	event: AIStreamEventInput,
): AIStreamEvent {
	return {
		...event,
		generationId: generation.id,
		sessionId: generation.sessionId,
		zoneId: generation.zoneId,
		blockId: generation.blockId,
		timestamp: Date.now(),
	};
}

export function resolvePromptTarget(
	selection: SelectionState,
	target: "auto" | "selection" | "block" | "document" | undefined,
): "selection" | "block" | "document" {
	if (target === "selection") {
		return "selection";
	}
	if (target === "block") {
		return "block";
	}
	if (target === "document") {
		return "document";
	}
	return selection?.type === "text" && !isCollapsed(selection)
		? "selection"
		: "block";
}

export function resolveSessionAnchor(
	editor: Editor,
	selection: SelectionState | TextSelection,
): AISession["anchor"] | undefined {
	if (selection?.type !== "text") {
		return undefined;
	}
	const range = selectionToRange(editor.internals.doc, selection);
	return {
		blockId: range.start.blockId,
		from: range.start.offset,
		to: range.end.offset,
	};
}

export function resolveSessionSelectionSnapshot(
	editor: Editor,
	selection: TextSelection,
): AISessionSelectionSnapshot {
	return {
		anchor: { ...selection.anchor },
		focus: { ...selection.focus },
		blockRange: [
			...getSelectionBlockRange(editor.internals.doc, selection),
		],
		isMultiBlock: isMultiBlock(selection),
	};
}

export function resolveSessionBlockId(
	editor: Editor,
	session: AISession,
): string | null {
	if (session.target.kind === "block") {
		return session.target.blockId;
	}
	if (session.target.kind === "selection") {
		return session.target.blockId;
	}
	return (
		resolveActiveBlockId(editor.selection) ??
		editor.lastBlock()?.id ??
		editor.firstBlock()?.id ??
		null
	);
}
