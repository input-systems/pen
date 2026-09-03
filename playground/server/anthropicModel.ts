import type { ModelMessage } from "@input/pen-types";
import type { ChatEvent, ChatRequest } from "./protocol";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-5";

function readEnv(name: string): string | undefined {
	if (typeof process === "undefined") {
		return undefined;
	}
	return process.env[name];
}

const PROMPT_PREAMBLE =
	"You are a writing assistant embedded in a rich text document.";

/**
 * Any text the model writes is inserted into the document, so a chatty preamble
 * ends up in the user's paragraph — hence the blunt instruction.
 */
const NO_TOOLS_PROMPT = [
	"When the request offers no tools: follow the output contract stated in the",
	"request exactly. If it asks for a specific format (such as an XML plan),",
	"return only that. Otherwise reply with the document text itself and nothing",
	"else — no preamble, no explanation, no quotes around it.",
].join("\n");

const MULTI_TOOL_PROMPT = [
	"When the request offers tools: first call read_document with format",
	'"markdown" and annotateBlocks true — the `<!-- block:<id> <type> -->`',
	"comments give you the block ids every other tool expects. Then edit:",
	"update_block rewrites, converts, or restyles one existing block in place;",
	"write_document with markdown inserts new content (pass replaceBlockIds to",
	"swap existing blocks for it); delete_block and move_block do what they say.",
	"Cover every part of the request before stopping. Do not write any prose in",
	"your reply — it would be inserted into the document as content.",
].join("\n");

/**
 * The edit_document channel is one edit, preceded by a read only when the
 * request carries no block annotations. The earlier version of this prompt
 * mandated the read unconditionally — but the working set already annotates
 * documents up to the annotation bound, so an obedient model paid a full
 * model round trip to fetch ids it had been handed. Refusals answer
 * themselves: a rejected operation comes back with the reason and a fresh
 * outline (`spec/packages/extensions/ai.md` EC5, EC10, EC14).
 */
const EDIT_DOCUMENT_PROMPT = [
	"When the request offers tools: the block ids edit_document expects come",
	"from `<!-- block:<id> <type> -->` annotations. If the request already",
	"carries them, call edit_document directly — reading first adds a round",
	'trip for ids you have. Only call read_document (format "markdown",',
	"annotateBlocks true) when no annotations are present. Send every operation",
	"the request needs in one operations array, in document order. If the",
	"result reports rejected operations, read the reason and the outline it",
	"returns and retry only those operations. Cover every part of the request",
	"before stopping. On this channel your reply text is never applied to the",
	"document; keep it to one short sentence or none.",
].join("\n");

function buildSystemPrompt(request: ChatRequest): string {
	const offersEditDocument = request.tools.some(
		(tool) => tool.name === "edit_document",
	);
	return [
		PROMPT_PREAMBLE,
		"",
		offersEditDocument ? EDIT_DOCUMENT_PROMPT : MULTI_TOOL_PROMPT,
		"",
		NO_TOOLS_PROMPT,
	].join("\n");
}

/**
 * Talks to Anthropic and translates its stream into `ChatEvent`s.
 *
 * Two translations happen here, and they are the only reason this file is
 * longer than the scripted model: Pen's message shape into Anthropic's content
 * blocks on the way out, and Anthropic's server-sent events into our
 * newline-delimited events on the way back.
 */
export async function* streamAnthropic(
	request: ChatRequest,
	apiKey: string,
	signal: AbortSignal,
): AsyncGenerator<ChatEvent> {
	const response = await fetch(ANTHROPIC_URL, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-api-key": apiKey,
			"anthropic-version": "2023-06-01",
		},
		body: JSON.stringify({
			model: readEnv("ANTHROPIC_MODEL") ?? DEFAULT_MODEL,
			max_tokens: 8192,
			stream: true,
			system: buildSystemPrompt(request),
			messages: request.messages.map(toAnthropicMessage),
			tools: request.tools.map((tool) => ({
				name: tool.name,
				description: tool.description,
				input_schema: tool.inputSchema,
				...(tool.name === "edit_document"
					? { eager_input_streaming: true }
					: {}),
			})),
			...anthropicToolChoice(request),
		}),
		signal,
	});

	if (!response.ok || !response.body) {
		yield {
			type: "error",
			error: `Anthropic responded ${response.status}: ${await response.text()}`,
		};
		return;
	}

	yield* readAnthropicStream(response.body, signal);
}

// ── Pen messages → Anthropic content blocks ─────────────────

function toAnthropicMessage(message: ModelMessage) {
	// Anthropic has no tool role: tool results are user turns.
	const role = message.role === "assistant" ? "assistant" : "user";

	if (typeof message.content === "string") {
		return { role, content: message.content };
	}

	const content = message.content.map((part) => {
		switch (part.type) {
			case "text":
				return { type: "text", text: part.text };
			case "tool-call":
				return {
					type: "tool_use",
					id: part.toolCallId,
					name: part.toolName,
					input: part.input,
				};
			case "tool-result":
				return {
					type: "tool_result",
					tool_use_id: part.toolCallId,
					content: JSON.stringify(part.result ?? null),
					is_error: part.isError === true,
				};
			default: {
				const unhandled: never = part;
				throw new Error(
					`Unsupported message part: ${JSON.stringify(unhandled)}`,
				);
			}
		}
	});

	return { role, content };
}

// ── Anthropic server-sent events → ChatEvents ───────────────

interface PendingToolCall {
	toolCallId: string;
	toolName: string;
	json: string;
}

/**
 * Anthropic sends tool arguments as a stream of JSON fragments, so a tool call
 * is only complete at `content_block_stop` — or when the stream is cut short
 * by `max_tokens` or simply ends. Everything else maps one to one.
 */
async function* readAnthropicStream(
	body: ReadableStream<Uint8Array>,
	signal: AbortSignal,
): AsyncGenerator<ChatEvent> {
	let pendingToolCall: PendingToolCall | null = null;

	for await (const event of readServerSentEvents(body, signal)) {
		switch (event.type) {
			case "content_block_start": {
				if (event.content_block?.type === "tool_use") {
					pendingToolCall = {
						toolCallId: event.content_block.id ?? "",
						toolName: event.content_block.name ?? "",
						json: "",
					};
					yield {
						type: "tool-input-start",
						toolCallId: pendingToolCall.toolCallId,
						toolName: pendingToolCall.toolName,
					};
				}
				break;
			}

			case "content_block_delta": {
				if (event.delta?.type === "text_delta" && event.delta.text) {
					yield { type: "text-delta", delta: event.delta.text };
				}
				if (
					event.delta?.type === "input_json_delta" &&
					pendingToolCall
				) {
					const fragment = event.delta.partial_json ?? "";
					pendingToolCall.json += fragment;
					if (fragment.length > 0) {
						yield {
							type: "tool-input-delta",
							toolCallId: pendingToolCall.toolCallId,
							inputTextDelta: fragment,
						};
					}
				}
				break;
			}

			case "content_block_stop": {
				if (pendingToolCall) {
					yield completeToolCall(pendingToolCall);
					pendingToolCall = null;
				}
				break;
			}

			case "message_delta": {
				if (
					event.delta?.stop_reason === "max_tokens" &&
					pendingToolCall
				) {
					yield completeToolCall(pendingToolCall);
					pendingToolCall = null;
				}
				break;
			}

			case "error": {
				yield {
					type: "error",
					error: event.error?.message ?? "Unknown error",
				};
				return;
			}

			default:
				break;
		}
	}

	if (pendingToolCall) {
		yield completeToolCall(pendingToolCall);
	}

	yield { type: "done" };
}

function completeToolCall(pending: PendingToolCall): ChatEvent {
	return {
		type: "tool-call",
		toolCallId: pending.toolCallId,
		toolName: pending.toolName,
		input: parseToolInput(pending.json),
	};
}

function anthropicToolChoice(
	request: ChatRequest,
):
	| { tool_choice: { type: "auto" | "any" | "tool"; name?: string } }
	| Record<string, never> {
	const choice = request.toolChoice;
	if (!choice) {
		return {};
	}
	// Forced tool choice is rejected alongside extended thinking; this
	// adapter does not send thinking, so it can state the loop's intent.
	if (choice.type === "tool") {
		return { tool_choice: { type: "tool", name: choice.name } };
	}
	return { tool_choice: { type: choice.type } };
}

/** What the tool receives when the model ran out of tokens mid-argument. */
const TRUNCATED_TOOL_INPUT = {
	truncated: true,
	reason: "Tool input was truncated (max_tokens); the argument JSON did not parse.",
};

function parseToolInput(json: string): unknown {
	try {
		return JSON.parse(json);
	} catch {
		return TRUNCATED_TOOL_INPUT;
	}
}

interface AnthropicStreamEvent {
	type: string;
	content_block?: { type?: string; id?: string; name?: string };
	delta?: {
		type?: string;
		text?: string;
		partial_json?: string;
		stop_reason?: string;
	};
	error?: { message?: string };
}

/** Minimal SSE reader: we only need the `data:` lines. */
async function* readServerSentEvents(
	body: ReadableStream<Uint8Array>,
	signal: AbortSignal,
): AsyncGenerator<AnthropicStreamEvent> {
	const decoder = new TextDecoder();
	let pending = "";

	for await (const chunk of body) {
		if (signal.aborted) {
			return;
		}

		pending += decoder.decode(chunk, { stream: true });
		const lines = pending.split("\n");
		pending = lines.pop() ?? "";

		for (const line of lines) {
			if (!line.startsWith("data:")) {
				continue;
			}
			try {
				yield JSON.parse(
					line.slice("data:".length),
				) as AnthropicStreamEvent;
			} catch {
				// Keep-alive or partial frame: nothing to report.
			}
		}
	}
}
