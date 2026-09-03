import type { IncomingMessage, ServerResponse } from "node:http";
import { resolveAnthropicKey, streamChatLines } from "./chatEvents";
import { CHAT_CONTENT_TYPE, type ChatRequest } from "./protocol";

/**
 * `POST /api/chat` on Node: the one endpoint the playground has.
 *
 * Reads the body, streams lines, ends. Which model answers and what a line
 * looks like is decided in `chatEvents.ts`; this file only knows Node's
 * request and response objects.
 */
export async function handleChatRequest(
	incoming: IncomingMessage,
	response: ServerResponse,
	envKey: string | undefined,
): Promise<void> {
	let request: ChatRequest;
	try {
		request = JSON.parse(await readBody(incoming)) as ChatRequest;
	} catch {
		response.statusCode = 400;
		response.end("Expected a JSON body");
		return;
	}

	incoming.socket?.setNoDelay(true);
	response.writeHead(200, {
		"content-type": CHAT_CONTENT_TYPE,
		"cache-control": "no-cache",
		"x-accel-buffering": "no",
	});

	// Stopping a generation aborts the browser request; pass that on to the
	// provider so we are not billed for tokens nobody will read.
	const controller = new AbortController();
	incoming.on("close", () => controller.abort());

	const apiKey = resolveAnthropicKey(
		headerValue(incoming.headers["x-anthropic-api-key"]),
		envKey,
	);

	for await (const line of streamChatLines(
		request,
		apiKey,
		controller.signal,
	)) {
		response.write(line);
	}

	response.end();
}

function headerValue(
	header: string | string[] | undefined,
): string | undefined {
	return typeof header === "string" ? header : undefined;
}

function readBody(incoming: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let body = "";
		incoming.on("data", (chunk) => {
			body += chunk;
		});
		incoming.on("end", () => resolve(body));
		incoming.on("error", reject);
	});
}
