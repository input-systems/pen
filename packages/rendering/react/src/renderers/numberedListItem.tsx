import React from "react";
import type { BlockHandle, BlockRenderContext } from "@input/pen-types";
import { useNumberedListItemValue } from "../hooks/useNumberedListItemValue";
import {
	ListItemLayout,
	type ListItemHostAttributes,
} from "../utils/listItemLayout";

type NumberedListItemViewProps = {
	block: BlockHandle;
	ctx: BlockRenderContext;
} & ListItemHostAttributes;

export function NumberedListItemRenderer(
	block: BlockHandle,
	ctx: BlockRenderContext,
): React.ReactElement<ListItemHostAttributes> {
	return <NumberedListItemView block={block} ctx={ctx} />;
}

function NumberedListItemView({
	block,
	ctx,
	extraAttributes,
	...rest
}: NumberedListItemViewProps): React.ReactElement {
	const indent = (block.props?.indent as number) ?? 0;
	const counterValue = useNumberedListItemValue(block.id);

	return (
		<ListItemLayout
			{...rest}
			ref={ctx.ref as React.Ref<HTMLDivElement>}
			blockId={block.id}
			blockType="numberedListItem"
			indent={indent}
			selected={ctx.selected}
			decorations={ctx.decorations}
			extraAttributes={extraAttributes}
			libraryAttributes={{ "data-counter": counterValue }}
			marker={
				<span
					data-pen-list-marker=""
					// Justified decorative list marker
					aria-hidden="true"
				>
					{counterValue}.
				</span>
			}
		/>
	);
}
