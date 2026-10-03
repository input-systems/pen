import React, { useRef, useState } from "react";
import { resolveEditorMessage } from "@input/pen-core";
import type { Editor } from "@input/pen-types";
import { useEditorContext } from "../../context/editorContext";
import { useIsomorphicLayoutEffect } from "../../hooks/useIsomorphicLayoutEffect";
import { useBlockDragHandle } from "../../hooks/useBlockDragHandle";
import { renderAsChild, type AsChildProps } from "../../utils/asChild";
import { composeRefs } from "../../utils/composeRefs";
import { DATA_ATTRS } from "@input/pen-dom/utils/dataAttributes";
import {
	captureFocusReturn,
	restoreFocusReturn,
	type FocusReturnToken,
} from "@input/pen-dom";
import { useFieldEditorContext } from "../../context/fieldEditorContext";
import { resolveChromeEditorRoot } from "../../utils/aiDomScope";
import { buildMoveBlockOps } from "./blockDragSession";

/** Command name (`spec/rules/commands.md`). Menu items dispatch this even when the command is not wired. */
export const PEN_MOVE_BLOCK_UP = "pen.moveBlockUp";
/** Command name (`spec/rules/commands.md`). Menu items dispatch this even when the command is not wired. */
export const PEN_MOVE_BLOCK_DOWN = "pen.moveBlockDown";

export type BlockHandleMoveCommand =
	| typeof PEN_MOVE_BLOCK_UP
	| typeof PEN_MOVE_BLOCK_DOWN;

const MOVE_ITEMS: ReadonlyArray<{
	command: BlockHandleMoveCommand;
	messageKey: "pen.blockHandle.moveUp" | "pen.blockHandle.moveDown";
}> = [
	{ command: PEN_MOVE_BLOCK_UP, messageKey: "pen.blockHandle.moveUp" },
	{ command: PEN_MOVE_BLOCK_DOWN, messageKey: "pen.blockHandle.moveDown" },
];

export interface BlockHandleProps extends AsChildProps {
	blockId: string;
	ref?: React.Ref<HTMLElement>;
	/**
	 * AX3: invoked by the handle menu Move up / Move down items.
	 * Named for `pen.moveBlockUp` / `pen.moveBlockDown`. Command wiring is
	 * not required — if omitted, the primitive applies a `move-block` op.
	 */
	onMoveBlock?: (command: BlockHandleMoveCommand, blockId: string) => void;
}

export function EditorBlockHandle(props: BlockHandleProps) {
	const { blockId, onMoveBlock, ref, ...rest } = props;
	const { editor, readonly } = useEditorContext();
	const fieldEditor = useFieldEditorContext();
	const { props: dragProps } = useBlockDragHandle(blockId);
	const handleRef = useRef<HTMLElement | null>(null);
	const menuRef = useRef<HTMLDivElement | null>(null);
	const focusReturnRef = useRef<FocusReturnToken | null>(null);
	const [menuOpen, setMenuOpen] = useState(false);
	const menuId = `pen-block-handle-menu-${blockId}`;

	function closeMenu(): void {
		// D15: a detached menu returns focus to its invoker, this handle.
		const handle = handleRef.current;
		const root = resolveChromeEditorRoot(editor, handle);
		focusReturnRef.current = root ? captureFocusReturn(root, handle) : null;
		setMenuOpen(false);
	}

	function openMenu(): void {
		if (readonly) return;
		setMenuOpen(true);
	}

	function dispatchMove(command: BlockHandleMoveCommand): void {
		if (onMoveBlock) {
			onMoveBlock(command, blockId);
		} else {
			applyAdjacentMove(editor, blockId, command);
		}
		closeMenu();
	}

	// The move and the close commit together, so this runs after the
	// block's node has moved: synchronous, no microtask (AX3, S4).
	useIsomorphicLayoutEffect(() => {
		const token = focusReturnRef.current;
		if (menuOpen || !token) {
			return;
		}
		focusReturnRef.current = null;
		restoreFocusReturn(token, fieldEditor, "target");
	}, [menuOpen]);

	function handleTriggerKeyDown(
		event: React.KeyboardEvent<HTMLElement>,
	): void {
		if (readonly) return;
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			event.stopPropagation();
			openMenu();
		}
	}

	function handleMenuKeyDown(event: React.KeyboardEvent<HTMLElement>): void {
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			closeMenu();
			return;
		}

		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			event.stopPropagation();
			const items = Array.from(
				event.currentTarget.querySelectorAll<HTMLElement>(
					"[role='menuitem']",
				),
			);
			if (items.length === 0) return;
			const from = items.indexOf(document.activeElement as HTMLElement);
			const delta = event.key === "ArrowDown" ? 1 : -1;
			const next = items[(from + delta + items.length) % items.length];
			next?.focus();
		}
	}

	useIsomorphicLayoutEffect(() => {
		if (!menuOpen) return;
		const ownerDocument = handleRef.current?.ownerDocument;
		if (!ownerDocument) return;

		const onDocumentKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			const menu = menuRef.current;
			const handle = handleRef.current;
			const target = event.target;
			if (!(target instanceof Node)) return;
			if (
				(menu && menu.contains(target)) ||
				(handle && handle.contains(target))
			) {
				event.preventDefault();
				event.stopImmediatePropagation();
				closeMenu();
			}
		};

		ownerDocument.addEventListener("keydown", onDocumentKeyDown, true);
		return () => {
			ownerDocument.removeEventListener(
				"keydown",
				onDocumentKeyDown,
				true,
			);
		};
	}, [menuOpen]);

	useIsomorphicLayoutEffect(() => {
		if (!menuOpen) return;
		menuRef.current
			?.querySelector<HTMLElement>("[role='menuitem']")
			?.focus();
	}, [menuOpen]);

	const handleProps: Record<string, unknown> = {
		...dragProps,
		tabIndex: readonly ? -1 : 0,
		"aria-haspopup": "menu",
		"aria-expanded": menuOpen,
		"aria-controls": menuOpen ? menuId : undefined,
		onKeyDown: handleTriggerKeyDown,
	};

	const menuItems = MOVE_ITEMS.map((item) => (
		<button
			key={item.command}
			type="button"
			role="menuitem"
			data-pen-command={item.command}
			onClick={() => dispatchMove(item.command)}
		>
			{resolveEditorMessage(editor, item.messageKey)}
		</button>
	));

	return (
		<>
			{renderAsChild(
				{ ...rest, ref: composeRefs(ref, handleRef) },
				"div",
				handleProps,
			)}
			{menuOpen ? (
				<div
					ref={menuRef}
					id={menuId}
					role="menu"
					aria-label={resolveEditorMessage(
						editor,
						"pen.blockHandle.reorder",
					)}
					aria-orientation="vertical"
					data-pen-block-handle-menu=""
					onKeyDown={handleMenuKeyDown}
					{...{ [DATA_ATTRS.ignorePointerGesture]: "" }}
				>
					{menuItems}
				</div>
			) : null}
		</>
	);
}

function applyAdjacentMove(
	editor: Editor,
	blockId: string,
	command: BlockHandleMoveCommand,
): void {
	const order = editor.documentState.blockOrder;
	const index = order.indexOf(blockId);
	if (index < 0) return;

	switch (command) {
		case PEN_MOVE_BLOCK_UP: {
			if (index === 0) return;
			const targetBlockId = order[index - 1];
			if (!targetBlockId) return;
			editor.apply(
				buildMoveBlockOps({
					blockIds: [blockId],
					targetBlockId,
					dropPosition: "before",
				}),
				{ origin: "user" },
			);
			return;
		}
		case PEN_MOVE_BLOCK_DOWN: {
			if (index >= order.length - 1) return;
			const targetBlockId = order[index + 1];
			if (!targetBlockId) return;
			editor.apply(
				buildMoveBlockOps({
					blockIds: [blockId],
					targetBlockId,
					dropPosition: "after",
				}),
				{ origin: "user" },
			);
			return;
		}
		default: {
			const _exhaustive: never = command;
			return _exhaustive;
		}
	}
}
