import React, { useContext, useEffect } from "react";
import { createPortal } from "react-dom";
import {
	attachRemoteCarets,
	getRemoteCaretSource,
	getRootOverlay,
	overlayItemStyle,
	overlayLabelStyle,
	REMOTE_CARET_CONTRIBUTOR,
	remoteCaretKey,
	type OverlayPaintItem,
	type OverlayPaintMode,
} from "@input/pen-dom";
import type { PeerState, RemoteCursorState } from "@input/pen-multiplayer";
import type { Editor } from "@input/pen-types";
import { EditorContext } from "../../context/editorContext";
import { useMultiplayer } from "../../hooks/useMultiplayer";
import { useOverlayPaintPlan } from "../../hooks/useOverlayPaintPlan";
import { useRemoteCursors } from "../../hooks/useRemoteCursors";
import { renderAsChild, type AsChildProps } from "../../utils/asChild";
import {
	toOverlayReactStyle,
	type OverlayReactStyle,
} from "../../utils/overlayStyle";
import { EditorRegionSelectionContext } from "../editor/regionSelectionState";

type MultiplayerStyle = OverlayReactStyle;

export interface MultiplayerCaretRenderProps {
	cursor: RemoteCursorState;
	peer: PeerState | null;
	/**
	 * Positioned with `transform: translate3d(...)` relative to the overlay
	 * layer, with `left: 0` and `top: 0` so an RTL host does not move it to
	 * its static position (OV2).
	 */
	caretStyle: MultiplayerStyle;
	/** Positioned with `transform` above the caret, relative to the overlay layer; `left` and `top` are `0`. */
	labelStyle: MultiplayerStyle;
	attributes: Record<string, string | undefined>;
}

export interface MultiplayerCaretOverlayProps extends AsChildProps {
	editor?: Editor;
	renderCaret?: (props: MultiplayerCaretRenderProps) => React.ReactNode;
	renderLabel?: (props: MultiplayerCaretRenderProps) => React.ReactNode;
	ref?: React.Ref<HTMLElement>;
}

/**
 * Remote carets as a binding over `@input/pen-dom`'s root overlay (OV3,
 * W35.R12). While mounted, the multiplayer controller's cursors are a
 * registered contributor: pen-dom measures them in the read phase and
 * paints them, with their name labels, into the overlay layer. This
 * component measures nothing. With `renderCaret` or `renderLabel`, pen-dom
 * leaves the remote carets to this binding, which renders the host's nodes
 * into the layer at the plan's positions.
 */
export function MultiplayerCaretOverlay(props: MultiplayerCaretOverlayProps) {
	const { editor: editorProp, renderCaret, renderLabel, ...rest } = props;
	const editorContext = useContext(EditorContext);
	const regionSelection = useContext(EditorRegionSelectionContext);
	const editor = editorProp ?? editorContext?.editor;

	if (!editor) {
		throw new Error("Missing editor for Pen.Multiplayer.CaretOverlay");
	}

	const multiplayerState = useMultiplayer(editor);
	const remoteCursors = useRemoteCursors(editor);
	const rootElement = regionSelection?.rootElement ?? null;
	const overlay = rootElement ? getRootOverlay(rootElement) : null;
	const paint: OverlayPaintMode =
		renderCaret || renderLabel ? "binding" : "layer";
	const plan = useOverlayPaintPlan(paint === "binding" ? overlay : null);

	const peerMap = new Map<number, PeerState>();
	for (const peer of multiplayerState.peers) {
		peerMap.set(peer.clientId, peer);
	}
	const cursorByKey = new Map<string, RemoteCursorState>();
	for (const cursor of remoteCursors) {
		cursorByKey.set(remoteCaretKey(cursor.clientId), cursor);
	}

	useEffect(() => {
		const source = overlay ? getRemoteCaretSource(editor) : null;
		if (!overlay || !source) {
			return;
		}
		return attachRemoteCarets(overlay, source, { paint });
	}, [overlay, editor, paint]);

	if (!overlay) {
		return null;
	}

	const bindingItems = (plan?.items ?? []).filter(isBindingRemoteCaret);
	const overlayItems = bindingItems.map((item) => {
		const cursor = cursorByKey.get(item.key);
		if (!cursor) {
			return null;
		}
		const renderProps = createCaretRenderProps(
			item,
			cursor,
			peerMap.get(cursor.clientId) ?? null,
		);
		const caretNode = renderCaret ? (
			renderCaret(renderProps)
		) : (
			<div {...renderProps.attributes} style={renderProps.caretStyle} />
		);
		const labelNode = renderLabel ? (
			renderLabel(renderProps)
		) : (
			<div
				data-pen-overlay-label=""
				data-pen-multiplayer-caret-label=""
				style={renderProps.labelStyle}
			>
				{cursor.user.name}
			</div>
		);
		return (
			<React.Fragment key={item.key}>
				{caretNode}
				{labelNode}
			</React.Fragment>
		);
	});

	const host = renderAsChild(
		{
			...rest,
			children: rest.children ?? overlayItems,
		},
		"div",
		{
			"data-pen-multiplayer-caret-overlay": "",
			"data-cursor-count": String(remoteCursors.length),
			// AX7 overlay — collaborator caret is presentation
			"aria-hidden": "true",
			style: {
				position: "absolute",
				top: 0,
				left: 0,
				pointerEvents: "none",
			},
		},
	);
	return createPortal(host, overlay.layer);
}

function isBindingRemoteCaret(item: OverlayPaintItem): boolean {
	return (
		item.kind === "caret" &&
		item.role === "remote" &&
		item.paint === "binding" &&
		item.contributor === REMOTE_CARET_CONTRIBUTOR
	);
}

function createCaretRenderProps(
	item: OverlayPaintItem,
	cursor: RemoteCursorState,
	peer: PeerState | null,
): MultiplayerCaretRenderProps {
	const caretStyle = toOverlayReactStyle(
		overlayItemStyle(item, { variant: "default", solidCaret: true }),
	);
	const labelStyle = toOverlayReactStyle(overlayLabelStyle(item));
	const attributes = {
		...item.attributes,
		"data-block-id": cursor.blockId,
	};

	return {
		cursor,
		peer,
		caretStyle,
		labelStyle,
		attributes,
	};
}
