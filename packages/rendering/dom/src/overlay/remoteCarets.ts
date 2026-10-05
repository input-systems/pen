import { multiplayerControllerFacet } from "@input/pen-core";
import type { Editor, Unsubscribe } from "@input/pen-types";
import type { OverlayPaintMode, OverlayRequest, RootOverlay } from "./types";

/**
 * Remote (collaborator) carets as an overlay contributor (OV1, OV3,
 * W35.R12). The contributor turns a source's remote cursors into logical
 * `role: "remote"` caret requests; pen-dom measures and paints them in the
 * layer, so no binding measures or runs a frame driver for them. Shapes
 * mirror `RemoteCursorState` in `@input/pen-multiplayer` structurally: the
 * DOM engine sits below the extension packages and cannot import it.
 */

/** Peer identity on a remote cursor. Already validated by the multiplayer extension (COL2). */
export interface RemoteCaretUser {
	readonly id: string;
	readonly name: string;
	readonly color?: string;
}

/** One collaborator's collapsed caret. */
export interface RemoteCaretCursor {
	readonly clientId: number;
	readonly user: RemoteCaretUser;
	readonly blockId: string;
	readonly offset: number;
}

/** Where remote cursors come from: the multiplayer controller, or any store with the same two members. */
export interface RemoteCaretSource {
	getRemoteCursors(): readonly RemoteCaretCursor[];
	subscribe(listener: () => void): Unsubscribe;
}

export interface AttachRemoteCaretsOptions {
	/** `"binding"` when a framework binding renders the carets from the plan. Defaults to `"layer"`. */
	readonly paint?: OverlayPaintMode;
}

/** The contributor id remote carets are painted under (`OverlayPaintItem.contributor`). */
export const REMOTE_CARET_CONTRIBUTOR = "multiplayer";

/**
 * The paint-plan key of a collaborator's caret. Keyed by client only, so a
 * moving caret keeps its element and only its transform changes.
 *
 * @param clientId - The collaborator's awareness client id.
 * @returns The key of that client's caret item.
 */
export function remoteCaretKey(clientId: number): string {
	return `remote:${clientId}`;
}

/**
 * The editor's multiplayer controller as a remote-caret source.
 *
 * @param editor - An editor that may carry `@input/pen-multiplayer`.
 * @returns The source, or null when no multiplayer controller is installed.
 */
export function getRemoteCaretSource(editor: Editor): RemoteCaretSource | null {
	const controller = editor.facet(multiplayerControllerFacet);
	return isRemoteCaretSource(controller) ? controller : null;
}

/**
 * Register a source's remote carets on a root overlay. Each cursor becomes
 * one `role: "remote"` caret request with the peer's name as its label and
 * the peer's colour as `--pen-peer-color`; a cursor whose block is not
 * mounted lands in `plan.unresolved`. A source change requests a paint;
 * nothing here measures or schedules (OV1, S4).
 *
 * @param overlay - The root overlay, from `getRootOverlay(root)`.
 * @param source - Remote cursors, usually `getRemoteCaretSource(editor)`.
 * @param options - Who paints the carets.
 * @returns Releases the contributor and the source subscription.
 */
export function attachRemoteCarets(
	overlay: RootOverlay,
	source: RemoteCaretSource,
	options: AttachRemoteCaretsOptions = {},
): Unsubscribe {
	const paint = options.paint ?? "layer";
	let cursors = source.getRemoteCursors();
	const releaseContributor = overlay.registerContributor({
		id: REMOTE_CARET_CONTRIBUTOR,
		requests: () => {
			cursors = source.getRemoteCursors();
			return cursors.map((cursor) => remoteCaretRequest(cursor, paint));
		},
	});
	const unsubscribe = source.subscribe(() => {
		// The controller notifies on every presence change; only a new
		// cursor list can change what is painted.
		if (source.getRemoteCursors() !== cursors) {
			overlay.requestPaint();
		}
	});
	return () => {
		unsubscribe();
		releaseContributor();
	};
}

function remoteCaretRequest(
	cursor: RemoteCaretCursor,
	paint: OverlayPaintMode,
): OverlayRequest {
	const attributes: Record<string, string> = {
		"data-pen-multiplayer-caret": "",
		"data-client-id": String(cursor.clientId),
		"data-user-id": cursor.user.id,
		"data-user-name": cursor.user.name,
	};
	if (cursor.user.color !== undefined) {
		attributes["data-user-color"] = cursor.user.color;
	}
	return {
		kind: "caret",
		key: remoteCaretKey(cursor.clientId),
		role: "remote",
		point: { blockId: cursor.blockId, offset: cursor.offset },
		// Awareness carries no affinity; downstream is the stated default.
		affinity: "downstream",
		attributes,
		label: cursor.user.name,
		color: cursor.user.color,
		paint,
	};
}

function isRemoteCaretSource(value: unknown): value is RemoteCaretSource {
	const candidate = value as Partial<RemoteCaretSource> | null;
	return (
		typeof candidate?.getRemoteCursors === "function" &&
		typeof candidate?.subscribe === "function"
	);
}
