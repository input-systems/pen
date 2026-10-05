import type { BlockHandle, BlockRenderContext } from "@input/pen-types";
import { InlineContent } from "../../primitives/editor/inlineContent";
import React from "react";

export function PlaceholderParagraphRenderer(
	block: BlockHandle,
	ctx: BlockRenderContext,
): React.ReactElement {
	return (
		<div
			ref={ctx.ref as React.Ref<HTMLDivElement>}
			data-block-type="paragraph"
			data-selected={ctx.selected ? "" : undefined}
		>
			<InlineContent
				blockId={block.id}
				placeholder="Type ⌘I for AI Agent, or / for commands"
			/>
		</div>
	);
}
