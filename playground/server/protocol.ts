import type { ModelMessage, ToolSchema } from "@input/pen-types";

/** What the browser sends to `POST /api/chat`. */
export interface ChatRequest {
	/**
	 * The conversation so far, built by Pen's agentic loop: the user's prompt,
	 * then one assistant/tool pair per tool the model has already run.
	 */
	messages: ModelMessage[];
	/** The document tools Pen is offering for this turn. */
	tools: ToolSchema[];
	/** EC17: adapter-owned mapping onto Anthropic `tool_choice`. */
	toolChoice?:
		{ type: "auto" } | { type: "any" } | { type: "tool"; name: string };
}

/**
 * What the server streams back, one JSON object per line.
 *
 * Pen's `ModelStreamEvent` union is larger than this — it also carries inline
 * preview events for selection rewrites. A chat only needs these four, and
 * naming the subset keeps the wire format something you can read in one go.
 */
export type ChatEvent =
	| { type: "text-delta"; delta: string }
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
	| { type: "done" }
	| { type: "error"; error: string };

export const CHAT_CONTENT_TYPE = "application/x-ndjson";

/** One event per line; `penModel.ts` splits on the newline. */
export function encodeChatEvent(event: ChatEvent): string {
	return `${JSON.stringify(event)}\n`;
}

/** True once the model has run at least one tool this turn. */
export function hasRunTools(messages: ModelMessage[]): boolean {
	return messages.some((message) => message.role === "tool");
}
