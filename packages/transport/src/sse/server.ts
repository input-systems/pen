import type { PenStreamPart } from "@input/pen-types";
import {
	createAIToolTurn,
	isAIToolCallDenied,
	openAIToolCall,
	resolveAIToolConfirmPolicy,
} from "@input/pen-ai/tools";
import { generateId, isAsyncIterable } from "@input/pen-types";
import { createTransportToolContext } from "../toolContext";
import {
	MAX_PEN_STREAM_REQUEST_BYTES,
	parsePenStreamRequest,
} from "./parsePenStreamRequest";
import type { SSEServerOptions } from "./types";

export function createSSEHandler(
	options: SSEServerOptions,
): (request: Request) => Response | Promise<Response> {
	const {
		toolRuntime,
		editor,
		onRequest,
		onError,
		pingInterval = 15_000,
		allowedMutatingTools = [],
	} = options;
	const confirmPolicy = resolveAIToolConfirmPolicy(editor, options);

	return async (request: Request): Promise<Response> => {
		if (request.method === "GET") {
			return new Response("Method Not Allowed", {
				status: 405,
				headers: { Allow: "POST" },
			});
		}

		let text: string;
		try {
			text = await request.text();
		} catch {
			return new Response("Bad Request", { status: 400 });
		}
		if (text.length > MAX_PEN_STREAM_REQUEST_BYTES) {
			return new Response("Bad Request", { status: 400 });
		}
		let raw: unknown;
		try {
			raw = JSON.parse(text);
		} catch {
			return new Response("Bad Request", { status: 400 });
		}
		const body = parsePenStreamRequest(raw);
		if (!body) {
			return new Response("Bad Request", { status: 400 });
		}
		onRequest?.(body);

		const streamId = generateId();
		let eventIndex = 0;

		const stream = new ReadableStream({
			async start(controller) {
				const encoder = new TextEncoder();
				let pingTimer: ReturnType<typeof setInterval> | null = null;

				const send = (part: PenStreamPart): void => {
					const id = `${streamId}:${eventIndex++}`;
					const data = JSON.stringify(part);
					const event = `id: ${id}\ndata: ${data}\n\n`;
					controller.enqueue(encoder.encode(event));
				};

				const sendPing = (): void => {
					send({ type: "ping" } as PenStreamPart);
				};

				try {
					pingTimer = setInterval(sendPing, pingInterval);

					if (toolRuntime && body.toolCalls) {
						const turn = createAIToolTurn({
							allowedMutatingTools,
							...confirmPolicy,
						});
						for (const toolCall of body.toolCalls) {
							const context = createTransportToolContext(
								body.context,
								send,
								editor,
							);
							const opened = await openAIToolCall(
								toolRuntime,
								toolCall.name,
								toolCall.input,
								context,
								turn,
							);
							if (!opened.ok) {
								send({
									type: "tool-error",
									toolCallId: toolCall.toolCallId,
									error: opened.denial.reason,
								} as PenStreamPart);
								continue;
							}
							try {
								const result = toolRuntime.executeTool(
									toolCall.name,
									toolCall.input,
									context,
								);
								const resolved = await result;
								if (isAsyncIterable(resolved)) {
									for await (const part of resolved) {
										send(part as PenStreamPart);
									}
									const closed = opened.close();
									if (isAIToolCallDenied(closed)) {
										send({
											type: "tool-error",
											toolCallId: toolCall.toolCallId,
											error: closed.reason,
										} as PenStreamPart);
									}
								} else {
									const closed = opened.close(resolved);
									if (isAIToolCallDenied(closed)) {
										send({
											type: "tool-error",
											toolCallId: toolCall.toolCallId,
											error: closed.reason,
										} as PenStreamPart);
									} else {
										send({
											type: "tool-output",
											toolCallId: toolCall.toolCallId,
											output: closed,
										} as PenStreamPart);
									}
								}
							} finally {
								// Matches the direct transport: `close()` is
								// idempotent, and a `finally` also covers any
								// non-throw unwind that would otherwise leave the
								// write guard patched onto the host's editor.
								opened.close();
							}
						}
					}

					send({ type: "done" } as PenStreamPart);
				} catch (error) {
					onError?.(error);
					send({
						type: "error",
						errorText:
							error instanceof Error
								? error.message
								: String(error),
					} as PenStreamPart);
				} finally {
					if (pingTimer) clearInterval(pingTimer);
					controller.close();
				}
			},
		});

		return new Response(stream, {
			status: 200,
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
				"X-Stream-Id": streamId,
			},
		});
	};
}

