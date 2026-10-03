import type { PenStreamPart } from "./stream";
import type { Editor } from "./editor";
import type { Position } from "./ops";
import type { PropSchema } from "./schema";

// ── Tool Registry + Runtime ────────────────────────────────

export interface ToolRegistry {
	registerTool(def: ToolDefinition): void;
	unregisterTool(name: string): void;
	listTools(): readonly ToolDefinition[];
	getTool(name: string): ToolDefinition | null;
}

export interface ToolRuntime extends ToolRegistry {
	executeTool(
		name: string,
		input: unknown,
		ctx: ToolContext,
	): Promise<unknown> | AsyncIterable<unknown>;
}
export type ToolExecutionResult = Promise<unknown> | AsyncIterable<unknown>;

/** Per-call facts a destructive resolver may read (AIB3). */
export interface ToolAuthorityContext {
	/** True when this call's writes stage as suggestions instead of landing (RS2, EC11). */
	readonly staged: boolean;
}

/**
 * Classifies one call from its complete input (AIB3). `true` routes the call
 * through the confirmation seam.
 */
export type ToolDestructiveResolver = (
	input: unknown,
	context: ToolAuthorityContext,
) => boolean;

export interface ToolDefinition {
	name: string;
	description: string;
	inputSchema: PropSchema;
	handler: (
		input: unknown,
		ctx: ToolContext,
	) => Promise<unknown> | AsyncIterable<unknown>;
	/**
	 * Tool authority (AIB3). A tool that writes to the document declares
	 * `mutating: true` and is default-denied unless the grant allowlists it;
	 * `destructive` additionally marks calls that remove or replace content
	 * and so pass through the confirmation seam.
	 *
	 * Left undefined, authority falls back to name-based classification, which
	 * is a heuristic — declare these on any tool whose name is not obviously
	 * read-only.
	 */
	mutating?: boolean;
	/**
	 * AIB3. `true` or `false` classifies every call. A resolver classifies
	 * each call from its complete input and context; a resolver that throws
	 * or returns a non-boolean classifies the call as destructive.
	 */
	destructive?: boolean | ToolDestructiveResolver;
}

// ── Model Adapter ───────────────────────────────────────────

export type ModelToolChoice =
	| { type: "auto" }
	| { type: "any" }
	| { type: "tool"; name: string };

export interface ModelAdapterCapabilities {
	partialToolInput?: boolean;
	forcedToolChoice?: boolean;
}

export interface ModelAdapter {
	capabilities?: ModelAdapterCapabilities;
	stream(options: {
		messages: ModelMessage[];
		tools: ToolSchema[];
		signal?: AbortSignal;
		requestMode?: string;
		operation?: ModelRequestedOperation;
		sessionId?: string;
		turnId?: string;
		generationId?: string;
		toolChoice?: ModelToolChoice;
	}): AsyncIterable<ModelStreamEvent>;
}

export type ModelOperationKind =
	| "rewrite-selection"
	| "rewrite-block"
	| "continue-block"
	| "document-transform";

export interface ModelOperationSelectionTarget {
	kind: "selection";
	blockId: string | null;
	anchor: { blockId: string; offset: number };
	focus: { blockId: string; offset: number };
	sourceText: string;
}

export interface ModelOperationScopedRangeTarget {
	kind: "scoped-range";
	blockId: string | null;
	anchor: { blockId: string; offset: number };
	focus: { blockId: string; offset: number };
	sourceText: string;
	blockIds: readonly string[];
	contentFormat: "text" | "markdown";
	scope: "block" | "paragraph" | "document" | "heading";
}

export type ModelOperationRangeTarget =
	| ModelOperationSelectionTarget
	| ModelOperationScopedRangeTarget;

export function isScopedSelectionTarget(
	target: ModelOperationRangeTarget,
): target is ModelOperationScopedRangeTarget {
	return target.kind === "scoped-range";
}

export interface ModelOperationBlockTarget {
	kind: "block";
	blockId: string;
	blockType: string | null;
	sourceText: string;
	insertionOffset?: number;
}

export interface ModelOperationDocumentTarget {
	kind: "document";
	activeBlockId: string | null;
	blockIds?: readonly string[];
	placement?: "append-after-block" | "replace-empty-block" | "replace-blocks";
	transform?: "write" | "rewrite" | "remove";
}

export interface ModelOperationProvenance {
	documentVersion?: number | null;
	blockRevision?: number | null;
	selectionSignature?: string | null;
	syncedGeneration?: number | null;
}

export interface ModelRequestedOperation {
	kind: ModelOperationKind;
	target:
		| ModelOperationSelectionTarget
		| ModelOperationScopedRangeTarget
		| ModelOperationBlockTarget
		| ModelOperationDocumentTarget;
	promptIntent?: string;
	provenance?: ModelOperationProvenance | null;
}

export type ModelStreamEvent =
	| { type: "text-delta"; delta: string }
	| {
			type: "replace-preview";
			operation: ModelRequestedOperation;
			text: string;
	  }
	| {
			type: "replace-final";
			operation: ModelRequestedOperation;
			text: string;
	  }
	| {
			type: "insert-preview";
			operation: ModelRequestedOperation;
			text: string;
	  }
	| {
			type: "insert-final";
			operation: ModelRequestedOperation;
			text: string;
	  }
	| {
			type: "conflict";
			reason: string;
			operation?: ModelRequestedOperation;
	  }
	| {
			type: "structured-data";
			contract?: "grid" | "app";
			data: unknown;
			final?: boolean;
	  }
	| {
			type: "tool-input-start";
			toolCallId: string;
			toolName: string;
	  }
	| {
			type: "tool-input-delta";
			toolCallId: string;
			inputTextDelta: string;
	  }
	| {
			type: "tool-call";
			toolCallId: string;
			toolName: string;
			input: unknown;
	  }
	| {
			type: "done";
			usage?: { promptTokens: number; completionTokens: number };
	  }
	| { type: "error"; error: unknown };

export interface ToolSchema {
	name: string;
	description: string;
	inputSchema: PropSchema;
}

// ── Model Messages ──────────────────────────────────────────

export interface ModelMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string | ModelMessagePart[];
	toolCallId?: string;
	toolName?: string;
}

export type ModelMessagePart =
	| { type: "text"; text: string }
	| {
			type: "tool-call";
			toolCallId: string;
			toolName: string;
			input: unknown;
	  }
	| {
			type: "tool-result";
			toolCallId: string;
			result: unknown;
			isError?: boolean;
	  };

// ── Tool Context ────────────────────────────────────────────

export interface ToolContext {
	readonly editor: Editor;
	readonly docId: string;
	emit(part: PenStreamPart): void;

	insertBlock(
		blockType: string,
		props: Record<string, unknown>,
		position: Position,
	): string;
	updateBlock(blockId: string, props: Record<string, unknown>): void;
	deleteBlock(blockId: string): void;
	beginStreaming(zoneId: string, blockId: string): void;
	appendDelta(delta: string): void;
	endStreaming(status: "complete" | "cancelled" | "error"): void;
}

export function isAsyncIterable(
	value: unknown,
): value is AsyncIterable<unknown> {
	return (
		value != null &&
		typeof value === "object" &&
		Symbol.asyncIterator in (value as object)
	);
}
