import React from "react";
import { useListSegments } from "../../hooks/useBlockNotifier";
import { renderListSegments } from "./listSegments";

/** Props for {@link BlockChildren}, the React outlet for a container's child blocks. */
export interface BlockChildrenProps {
	parentBlockId: string;
	containerProps?: React.HTMLAttributes<HTMLDivElement> &
		Record<string, unknown>;
}

/**
 * Renders a container block's child blocks, by either nesting route, with
 * each run of list items in a `role="list"` group (AX1).
 *
 * Custom container renderers compose this to get an editable children outlet;
 * without it a host-defined container can hold children that never render.
 */
export function BlockChildren(
	props: BlockChildrenProps,
): React.ReactElement | null {
	const { parentBlockId, containerProps } = props;
	const childSegments = useListSegments(parentBlockId);

	if (childSegments.length === 0) {
		return null;
	}

	const childBlocks = renderListSegments(childSegments);

	return <div {...containerProps}>{childBlocks}</div>;
}
