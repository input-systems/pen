import { resolveAnthropicKey, streamChatLines } from "../server/chatEvents";
import { CHAT_CONTENT_TYPE, type ChatRequest } from "../server/protocol";

/**
 * `POST /api/chat` for the Cloudflare worker. Same body and stream as the
 * Vite middleware, on Fetch instead of Node's request and response.
 */
export async function handleChatFetch(
	request: Request,
	envKey: string | undefined,
): Promise<Response> {
	let body: ChatRequest;
	try {
		body = (await request.json()) as ChatRequest;
	} catch {
		return new Response("Expected a JSON body", { status: 400 });
	}

	const apiKey = resolveAnthropicKey(
		request.headers.get("x-anthropic-api-key") ?? undefined,
		envKey,
	);
	const lines = streamChatLines(body, apiKey, request.signal);

	return new Response(toByteStream(lines), {
		headers: {
			"content-type": CHAT_CONTENT_TYPE,
			"cache-control": "no-cache",
		},
	});
}

function toByteStream(
	lines: AsyncGenerator<string>,
): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			const { done, value } = await lines.next();
			if (done) {
				controller.close();
				return;
			}
			controller.enqueue(encoder.encode(value));
		},
		cancel() {
			void lines.return(undefined);
		},
	});
}
