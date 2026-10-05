import React from "react";
import type { RegionSelectionRect } from "@input/pen-dom";
import { useEditorContext } from "../../context/editorContext";
import { useSyncExternalStoreWithSelector } from "../../utils/useSyncExternalStoreWithSelector";
import { renderAsChild, type AsChildProps } from "../../utils/asChild";
import { useEditorRegionSelectionContext } from "./regionSelectionState";

export interface SelectionRectProps extends AsChildProps {
	ref?: React.Ref<HTMLElement>;
}

/**
 * The region-selection marquee while a drag is selecting blocks. A
 * committed block selection is not drawn here: `@input/pen-dom` paints it as
 * O3 outlines in the root's overlay layer.
 */
export function EditorSelectionRect(props: SelectionRectProps) {
	const { blockSelection } = useEditorContext();
	const { store } = useEditorRegionSelectionContext();
	const liveRect = useSyncExternalStoreWithSelector(
		store.subscribe,
		store.getSnapshot,
		store.getSnapshot,
		(snapshot) => snapshot.liveRect,
		rectsEqual,
	);

	if (!blockSelection.enabled || !liveRect) {
		return null;
	}

	return renderAsChild(props, "div", {
		"data-pen-selection-rect": "",
		"data-selecting": "",
		// AX7 overlay — the marquee is presentation
		"aria-hidden": "true",
		role: "presentation",
		style: {
			position: "fixed",
			top: `${liveRect.top}px`,
			left: `${liveRect.left}px`,
			width: `${liveRect.width}px`,
			height: `${liveRect.height}px`,
			pointerEvents: "none",
			zIndex: 10,
		},
	});
}

function rectsEqual(
	a: RegionSelectionRect | null,
	b: RegionSelectionRect | null,
): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	return (
		a.left === b.left &&
		a.top === b.top &&
		a.width === b.width &&
		a.height === b.height
	);
}
