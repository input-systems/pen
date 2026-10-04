import React, { useContext, useEffect } from "react";
import { createPortal } from "react-dom";
import {
	getRootOverlay,
	overlayItemStyle,
	type Affinity,
	type OverlayPaintItem,
} from "@input/pen-dom";
import type { Editor, TextSelection } from "@input/pen-types";
import { EditorContext } from "../../context/editorContext";
import { useOverlayPaintPlan } from "../../hooks/useOverlayPaintPlan";
import { renderAsChild, type AsChildProps } from "../../utils/asChild";
import {
	toOverlayReactStyle,
	type OverlayReactStyle,
} from "../../utils/overlayStyle";
import { EditorRegionSelectionContext } from "./regionSelectionState";

type CaretStyle = OverlayReactStyle;

export const CARET = {
	DEFAULT: "default",
	MACOS: "macos",
} as const;

export type EditorCaretVariant = (typeof CARET)[keyof typeof CARET];

export interface EditorCaretRenderProps {
	selection: TextSelection;
	point: {
		blockId: string;
		offset: number;
	};
	/** The record's affinity the caret was measured with (G3). */
	affinity: Affinity;
	/**
	 * Positioned with `transform: translate3d(...)` relative to the overlay
	 * layer, with `left: 0` and `top: 0` so an RTL host does not move it to
	 * its static position (OV2).
	 */
	caretStyle: CaretStyle;
	attributes: Record<string, string | undefined>;
}

export interface EditorCaretOverlayProps extends AsChildProps {
	editor?: Editor;
	variant?: EditorCaretVariant;
	renderCaret?: (props: EditorCaretRenderProps) => React.ReactNode;
	ref?: React.Ref<HTMLElement>;
}

/**
 * `customCaret` mode as a binding over `@input/pen-dom`'s root overlay (OV3).
 * While mounted, every collapsed caret the field allows is overlay-drawn
 * (`holdCaretMode("all")`) in `variant`. pen-dom measures and paints it; this
 * component measures nothing. With `renderCaret`, pen-dom leaves the local
 * caret to this binding, which portals the host's node into the overlay
 * layer at the plan's position. Without it, it renders nothing.
 */
export function EditorCaretOverlay(props: EditorCaretOverlayProps) {
	const {
		editor: editorProp,
		variant = CARET.DEFAULT,
		renderCaret,
		...rest
	} = props;
	const editorContext = useContext(EditorContext);
	const regionSelection = useContext(EditorRegionSelectionContext);
	const editor = editorProp ?? editorContext?.editor;

	if (!editor) {
		throw new Error("Missing editor for Pen.Editor.CaretOverlay");
	}

	const rootElement = regionSelection?.rootElement ?? null;
	const overlay = rootElement ? getRootOverlay(rootElement) : null;
	const paintsCaret = renderCaret != null;
	const plan = useOverlayPaintPlan(paintsCaret ? overlay : null);

	const caretItem = plan?.items.find(isBindingLocalCaret) ?? null;

	useEffect(() => {
		return overlay?.holdCaretMode("all");
	}, [overlay]);

	useEffect(() => {
		if (!overlay) {
			return;
		}
		overlay.setCaretVariant(variant);
		return () => {
			overlay.setCaretVariant(CARET.DEFAULT);
		};
	}, [overlay, variant]);

	useEffect(() => {
		if (!overlay || !paintsCaret) {
			return;
		}
		return overlay.holdCaretPaint("binding");
	}, [overlay, paintsCaret]);

	if (!overlay || !renderCaret || !plan || !caretItem) {
		return null;
	}

	const renderProps = createCaretRenderProps(
		caretItem,
		plan.solidCaret,
		variant,
	);
	// The blink epoch is part of the caret's identity: a new epoch mounts a
	// new node, so the host's CSS animation restarts with no timer (D9).
	const caretNode = (
		<React.Fragment key={caretItem.epoch}>
			{renderCaret(renderProps)}
		</React.Fragment>
	);
	const host = renderAsChild(
		{
			...rest,
			children: rest.children ?? caretNode,
		},
		"div",
		{
			"data-pen-editor-caret-overlay": "",
			// AX7 overlay — library caret is presentation
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

type LocalCaretItem = OverlayPaintItem & {
	readonly blockId: string;
	readonly offset: number;
	readonly affinity: Affinity;
};

function isBindingLocalCaret(item: OverlayPaintItem): item is LocalCaretItem {
	return (
		item.kind === "caret" &&
		item.role === "local" &&
		item.paint === "binding" &&
		item.blockId !== undefined &&
		item.offset !== undefined &&
		item.affinity !== undefined
	);
}

// AX6: `solidCaret` is the root's reduced-motion signal; under it the host's
// --pen-editor-caret-animation never applies.
function createCaretRenderProps(
	item: LocalCaretItem,
	solidCaret: boolean,
	variant: EditorCaretVariant,
): EditorCaretRenderProps {
	const point = { blockId: item.blockId, offset: item.offset };
	const affinity = item.affinity;
	const caretStyle = toOverlayReactStyle(
		overlayItemStyle(item, { variant, solidCaret }),
	);
	const attributes = {
		"data-pen-editor-caret": "",
		"data-block-id": point.blockId,
		"data-offset": String(point.offset),
		"data-affinity": affinity,
		"data-pen-caret-epoch": String(item.epoch),
	};

	return {
		selection: { type: "text", anchor: point, focus: point, affinity },
		point,
		affinity,
		caretStyle,
		attributes,
	};
}
