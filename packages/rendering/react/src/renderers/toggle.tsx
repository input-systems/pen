import React from "react";
import { resolveEditorMessage } from "@input/pen-core";
import type { BlockHandle, BlockRenderContext } from "@input/pen-types";
import { generateId } from "@input/pen-types";
import { InlineContent } from "../primitives/editor/inlineContent";
import { useEditorContext } from "../context/editorContext";
import { getAttachedFieldEditor } from "../utils/fieldEditor";
import { appendParentIdChildBlock } from "../utils/parentIdTree";
import { useChildBlockIds } from "../hooks/useChildBlockIds";
import { BlockChildren } from "../primitives/editor/blockChildren";

const TOGGLE_TRIGGER_MIN_SIZE_PX = 24;

export function ToggleRenderer(
	block: BlockHandle,
	ctx: BlockRenderContext,
): React.ReactElement {
	return <ToggleView block={block} ctx={ctx} />;
}

function ToggleView({
	block,
	ctx,
}: {
	block: BlockHandle;
	ctx: BlockRenderContext;
}): React.ReactElement {
	const open = (block.props?.open as boolean) ?? false;
	const { editor } = useEditorContext();
	const childBlockIds = useChildBlockIds(editor, block.id);
	const toggleBodyProps: React.HTMLAttributes<HTMLDivElement> &
		Record<string, unknown> = {
		"data-pen-toggle-body": "",
	};

	return (
		<div
			ref={ctx.ref as React.Ref<HTMLDivElement>}
			data-block-type="toggle"
			data-selected={ctx.selected ? "" : undefined}
		>
			<div data-pen-toggle-header="">
				<ToggleTrigger blockId={block.id} open={open} />
				<div data-pen-toggle-title="">
					<InlineContent
						blockId={block.id}
						decorations={ctx.decorations}
					/>
				</div>
			</div>
			{open ? (
				childBlockIds.length > 0 ? (
					<BlockChildren
						parentBlockId={block.id}
						containerProps={toggleBodyProps}
					/>
				) : (
					<ToggleEmptyState parentBlockId={block.id} />
				)
			) : null}
		</div>
	);
}

function ToggleTrigger({ blockId, open }: { blockId: string; open: boolean }) {
	const { editor, readonly } = useEditorContext();

	const handleMouseDown = (event: React.MouseEvent<HTMLButtonElement>) => {
		event.preventDefault();
		event.stopPropagation();

		const fieldEditor = getAttachedFieldEditor(editor);
		fieldEditor?.blur();
		fieldEditor?.suspendForPointerSelection?.();
	};

	const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
		event.preventDefault();
		event.stopPropagation();
		if (readonly) return;
		editor.apply(
			[
				{
					type: "set-props",
					blockId,
					props: { open: !open },
				},
			],
			{ origin: "user" },
		);
	};

	return (
		<button
			type="button"
			data-pen-toggle-trigger=""
			data-pen-ignore-pointer-gesture=""
			style={{
				minWidth: TOGGLE_TRIGGER_MIN_SIZE_PX,
				minHeight: TOGGLE_TRIGGER_MIN_SIZE_PX,
			}}
			aria-expanded={open}
			aria-label={
				open
					? resolveEditorMessage(editor, "pen.toggle.collapse")
					: resolveEditorMessage(editor, "pen.toggle.expand")
			}
			onMouseDown={handleMouseDown}
			onClick={handleClick}
		>
			<span
				data-pen-toggle-trigger-icon=""
				// Justified decorative chevron; name lives on the button
				aria-hidden="true"
			>
				{open ? "▾" : "▸"}
			</span>
		</button>
	);
}

function ToggleEmptyState({ parentBlockId }: { parentBlockId: string }) {
	const { editor, readonly } = useEditorContext();

	const handleMouseDown = (event: React.MouseEvent<HTMLButtonElement>) => {
		event.preventDefault();
		event.stopPropagation();
	};

	const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
		event.preventDefault();
		event.stopPropagation();
		if (readonly) return;

		const newBlockId = generateId();
		appendParentIdChildBlock(editor, {
			parentBlockId,
			childBlockId: newBlockId,
			blockType: "paragraph",
		});

		const fieldEditor = getAttachedFieldEditor(editor);
		const activateChild = () => {
			fieldEditor?.activateTextSelection?.(newBlockId, 0, 0);
		};

		if (typeof window !== "undefined") {
			window.requestAnimationFrame(activateChild);
		} else {
			activateChild();
		}
	};

	return (
		<div data-pen-toggle-empty-state="">
			<button
				type="button"
				data-pen-toggle-empty-button=""
				data-pen-ignore-pointer-gesture=""
				onMouseDown={handleMouseDown}
				onClick={handleClick}
			>
				{resolveEditorMessage(editor, "pen.toggle.empty")}
			</button>
		</div>
	);
}
