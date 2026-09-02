import type { ModelMessage } from "@input/pen-types";
import { hasRunTools, type ChatEvent, type ChatRequest } from "./protocol";

const SCRIPTED_PARAGRAPH =
	"This paragraph came from the playground's scripted model, which answers " +
	"when ANTHROPIC_API_KEY is not set. Pen streamed it into the document in " +
	"clause-sized bursts, the way a real model dumps text — not one word per " +
	"tick. Smooth streaming paints that text at reading speed after it is " +
	"already in the document.";

/** Gap between prose bursts. Real models dump a clause, then stall. */
export const SCRIPTED_PROSE_BURST_GAP_MS = 320;

/** Characters per argument-JSON fragment, roughly a word. */
const TOOL_INPUT_FRAGMENT = 6;

const SCRIPTED_MARKDOWN = [
	"## Written by a tool call",
	"",
	"The scripted model asked for a document tool instead of writing prose, and",
	"Pen turned this markdown into blocks:",
	"",
	"- Every block here is a real document operation",
	"- The inspector on the right lists them",
	"- One press of undo removes the whole section",
].join("\n");

/**
 * The offline stand-in for a model, so the playground works with no API key.
 *
 * It answers in whichever form Pen asked for. When the request carries a write
 * tool, Pen wants structural edits, so it calls that tool and says nothing.
 * When it carries none, Pen wants prose to drop into a block, so it streams
 * text and calls nothing.
 */
export async function* streamScripted(
	request: ChatRequest,
): AsyncGenerator<ChatEvent> {
	const offered = new Set(request.tools.map((tool) => tool.name));

	if (offered.has("edit_document")) {
		yield* streamEditChannel(request);
		return;
	}

	// The tool already ran, so this pass has nothing left to do. Without this
	// the loop would keep calling the tool until it hit its step limit.
	if (offered.has("write_document") && !hasRunTools(request.messages)) {
		yield toolCall("write_document", {
			format: "markdown",
			content: SCRIPTED_MARKDOWN,
			position: "last",
		});
	} else if (!offered.has("write_document")) {
		yield* streamText(SCRIPTED_PARAGRAPH);
	}

	yield { type: "done" };
}

/**
 * `edit_document` names the blocks it edits, so this takes the same two passes
 * the real prompt asks for: read the annotated document, then edit by id.
 */
async function* streamEditChannel(
	request: ChatRequest,
): AsyncGenerator<ChatEvent> {
	if (!hasRunTools(request.messages)) {
		yield toolCall("read_document", {
			format: "markdown",
			annotateBlocks: true,
		});
		yield { type: "done" };
		return;
	}

	const blockIds = readAnnotatedBlockIds(request.messages);
	const lastBlockId = blockIds.at(-1);

	if (lastBlockId && !hasCalled(request.messages, "edit_document")) {
		yield* streamToolCall("edit_document", {
			operations: [
				{
					operation: "insert_blocks",
					blockId: lastBlockId,
					placement: "after",
					markdown: SCRIPTED_MARKDOWN,
				},
			],
		});
	}

	yield { type: "done" };
}

/**
 * The block ids `read_document` annotated its markdown with, in document
 * order. Scanning the serialized tool results avoids depending on the tool's
 * result shape beyond the `<!-- block:<id> <type> -->` comment itself.
 */
function readAnnotatedBlockIds(messages: ModelMessage[]): string[] {
	const pattern = /<!--\s*block:(\S+)\s/g;
	const results = messages
		.filter((message) => message.role === "tool")
		.map((message) => JSON.stringify(message.content))
		.join("\n");
	return [...results.matchAll(pattern)].map((match) => match[1]!);
}

function hasCalled(messages: ModelMessage[], toolName: string): boolean {
	return messages.some(
		(message) =>
			Array.isArray(message.content) &&
			message.content.some(
				(part) =>
					part.type === "tool-call" && part.toolName === toolName,
			),
	);
}

function toolCall(toolName: string, input: unknown): ChatEvent {
	return {
		type: "tool-call",
		toolCallId: `scripted-${Date.now()}`,
		toolName,
		input,
	};
}

/**
 * The same call, sent the way Anthropic sends one under eager input streaming:
 * argument JSON in fragments, then the complete call. Without this the offline
 * model could not show the streaming preview, so a fresh clone would conclude
 * the feature does not exist.
 */
async function* streamToolCall(
	toolName: string,
	input: unknown,
): AsyncGenerator<ChatEvent> {
	const toolCallId = `scripted-${Date.now()}`;
	const json = JSON.stringify(input);
	yield { type: "tool-input-start", toolCallId, toolName };
	for (let index = 0; index < json.length; index += TOOL_INPUT_FRAGMENT) {
		await sleep(20);
		yield {
			type: "tool-input-delta",
			toolCallId,
			inputTextDelta: json.slice(index, index + TOOL_INPUT_FRAGMENT),
		};
	}
	yield { type: "tool-call", toolCallId, toolName, input };
}

/**
 * Split on sentence and clause boundaries so each delta is a burst, not a
 * word. Smooth streaming is invisible against a word-at-a-time script.
 */
export function splitProseBursts(text: string): string[] {
	return text.split(/(?<=[.!?;]|—)\s+/).filter((part) => part.length > 0);
}

/** Streams clause-sized bursts with a few-hundred-ms stall between them. */
async function* streamText(text: string): AsyncGenerator<ChatEvent> {
	const bursts = splitProseBursts(text);
	for (let index = 0; index < bursts.length; index++) {
		if (index > 0) {
			await sleep(SCRIPTED_PROSE_BURST_GAP_MS);
		}
		const burst = bursts[index]!;
		const isLast = index === bursts.length - 1;
		yield {
			type: "text-delta",
			delta: isLast ? burst : `${burst} `,
		};
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
