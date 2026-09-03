import { streamAnthropic } from "./anthropicModel";
import { encodeChatEvent, type ChatEvent, type ChatRequest } from "./protocol";
import { streamScripted } from "./scriptedModel";

/**
 * Everything `/api/chat` does between reading the body and writing bytes,
 * shared by the Vite middleware and the Cloudflare worker.
 */

/**
 * The key from the agent bar (`x-anthropic-api-key`) wins over the server's
 * env key for that request; neither means the scripted model answers.
 */
export function resolveAnthropicKey(
	headerValue: string | undefined,
	envKey: string | undefined,
): string | undefined {
	const fromHeader = headerValue?.trim() ?? "";
	return fromHeader.length > 0 ? fromHeader : envKey;
}

/** Pick a model and stream `ChatEvent`s. */
export async function* streamChatEvents(
	request: ChatRequest,
	apiKey: string | undefined,
	signal: AbortSignal,
): AsyncGenerator<ChatEvent> {
	if (apiKey) {
		yield* streamAnthropic(request, apiKey, signal);
		return;
	}
	yield* streamScripted(request);
}

/**
 * The same events as newline-delimited JSON, ready to write. A provider error
 * becomes the last line instead of a broken response — unless the browser
 * already hung up, in which case nobody is listening.
 */
export async function* streamChatLines(
	request: ChatRequest,
	apiKey: string | undefined,
	signal: AbortSignal,
): AsyncGenerator<string> {
	try {
		for await (const event of streamChatEvents(request, apiKey, signal)) {
			if (signal.aborted) {
				return;
			}
			yield encodeChatEvent(event);
		}
	} catch (error) {
		if (!signal.aborted) {
			yield encodeChatEvent({
				type: "error",
				error: describeError(error),
			});
		}
	}
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
