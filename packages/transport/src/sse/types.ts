import type {
	AIToolConfirmFn,
	AIUnconfirmedDestructivePolicy,
} from "@input/pen-ai/tools";
import type { Editor, PenStreamRequest, ToolRuntime } from "@input/pen-types";

export interface SSEEvent {
	id?: string;
	data: string;
	event?: string;
	retry?: number;
}

export interface SSEClientOptions {
	url: string;
	headers?: Record<string, string>;
	pingTimeout?: number;
	signal?: AbortSignal;
}

export interface SSEServerOptions {
	toolRuntime?: ToolRuntime;
	/**
	 * In-process editor for tool context. The SSE handler never reads an
	 * editor off the request body — that field is not on the wire type
	 * (AIB2), and a live `Editor` cannot survive `JSON.parse`.
	 */
	editor?: Editor;
	/**
	 * Mutating tools the model may invoke on this handler. Default deny.
	 */
	allowedMutatingTools?: readonly string[];
	/**
	 * Confirms destructive tool calls (AIB3). Defaults to the editor's
	 * `aiExtension({ confirm })`.
	 */
	confirm?: AIToolConfirmFn;
	/**
	 * A destructive call with no `confirm` resolver (AIB3): `"refuse"` is the
	 * production setting for an external tool surface. Defaults to the
	 * editor's `aiExtension({ unconfirmedDestructive })`, then `"allow"`, so
	 * a handler a client can reach runs `delete_block` and `write_document`
	 * unless this, `aiExtension`, or `confirm` says otherwise.
	 */
	unconfirmedDestructive?: AIUnconfirmedDestructivePolicy;
	onRequest?: (request: PenStreamRequest) => void;
	onError?: (error: unknown) => void;
	pingInterval?: number;
}
