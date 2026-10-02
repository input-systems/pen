import React from "react";
import { useEditorContext } from "../../context/editorContext";
import { useChildBlockIds } from "../../hooks/useChildBlockIds";
import { EditorBlock } from "./block";

/** Props for {@link BlockChildren}, the React outlet for a container's child blocks. */
export interface BlockChildrenProps {
	parentBlockId: string;
	containerProps?: React.HTMLAttributes<HTMLDivElement> &
		Record<string, unknown>;
}

/**
 * Renders a container block's child blocks, by either nesting route.
 *
 * Custom container renderers compose this to get an editable children outlet;
 * without it a host-defined container can hold children that never render.
 */
export function BlockChildren(
	props: BlockChildrenProps,
): React.ReactElement | null {
	const { parentBlockId, containerProps } = props;
	const { editor } = useEditorContext();
	const childBlockIds = useChildBlockIds(parentBlockId);

	if (childBlockIds.length === 0) {
		return null;
	}

	const childBlocks = childBlockIds.map((blockId) => (
		<EditorBlock key={blockId} blockId={blockId} />
	));

	return <div {...containerProps}>{childBlocks}</div>;
}
