import { useState, useEffect } from "react";
import { aiControllerFacet, isCollapsed, isMultiBlock } from "@input/pen-core";
import type { Editor, TextSelection } from "@input/pen-types";
import type { AIController } from "@input/pen-ai";
import { DATA_ATTRS } from "@input/pen-dom/utils/dataAttributes";
import { queryBlockElement } from "@input/pen-dom/field-editor/selectionBridge";
import { resolveSelectionRect } from "../selection/placement";
import { useSyncExternalStoreWithSelector } from "../utils/useSyncExternalStoreWithSelector";

export interface SelectionToolbarState {
	isOpen: boolean;
	selectionRect: DOMRect | null;
}

const CLOSED_STATE: SelectionToolbarState = {
	isOpen: false,
	selectionRect: null,
};

/**
 * Tracks whether the editor has a non-collapsed text selection and
 * provides the native DOM rect of that selection for positioning a
 * floating toolbar.
 *
 * A selection inside one block reads the native DOM range and falls back
 * to canonical editor selection geometry when the browser selection is
 * transient. A selection that spans blocks reads the canonical geometry
 * first: it is measured per block, so the rect covers the selected text
 * rather than the border boxes of the blocks in between.
 */
export function useSelectionToolbar(editor: Editor): SelectionToolbarState {
	const [state, setState] = useState<SelectionToolbarState>(CLOSED_STATE);
	const controller =
		(editor.facet(aiControllerFacet) as AIController | null) ?? null;
	const isInlinePromptOpen = useSyncExternalStoreWithSelector(
		(callback) => {
			if (!controller) {
				return () => {};
			}
			return controller.subscribeSessions(callback);
		},
		() => controller?.getState() ?? null,
		() => null,
		(aiState) => {
			const activeSession =
				aiState?.sessions.find(
					(session) => session.id === aiState.activeSessionId,
				) ?? null;
			return (
				activeSession?.surface === "inline-edit" &&
				activeSession.contextualPrompt?.composer.isOpen === true &&
				activeSession.status !== "cancelled"
			);
		},
	);

	useEffect(() => {
		const update = () => {
			if (isInlinePromptOpen) {
				setState(CLOSED_STATE);
				return;
			}

			const selection = editor.selection;
			if (
				!selection ||
				selection.type !== "text" ||
				isCollapsed(selection)
			) {
				setState(CLOSED_STATE);
				return;
			}

			const rect = resolveToolbarRect(editor, selection);
			setState(
				rect ? { isOpen: true, selectionRect: rect } : CLOSED_STATE,
			);
		};

		const unsubs = [
			editor.on("selectionChange", update),
			editor.on("commit", () => update()),
		];
		window.addEventListener("resize", update);
		window.addEventListener("scroll", update, true);

		update();

		return () => {
			window.removeEventListener("resize", update);
			window.removeEventListener("scroll", update, true);
			unsubs.forEach((u) => u());
		};
	}, [editor, isInlinePromptOpen]);

	return state;
}

function resolveToolbarRect(
	editor: Editor,
	selection: TextSelection,
): DOMRect | null {
	// the native range rect of a spanning selection is the column width, so
	// measure per block first and keep the native rect as the fallback
	if (isMultiBlock(selection)) {
		const root = resolveEditorRoot(editor, selection);
		const rect = root ? resolveSelectionRect(root, selection) : null;
		if (rect) {
			return rect;
		}
	}

	const nativeRect = resolveNativeSelectionRect();
	if (nativeRect) {
		return nativeRect;
	}

	const root = resolveEditorRoot(editor, selection);
	return root ? resolveSelectionRect(root, selection) : null;
}

function resolveNativeSelectionRect(): DOMRect | null {
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0) {
		return null;
	}

	const rect = selection.getRangeAt(0).getBoundingClientRect();
	if (rect.width === 0 && rect.height === 0) {
		return null;
	}

	return rect;
}

function resolveEditorRoot(
	editor: Editor,
	selection: Editor["selection"],
): HTMLElement | null {
	if (selection?.type === "text") {
		const roots = document.querySelectorAll<HTMLElement>(
			`[${DATA_ATTRS.editorRoot}]`,
		);
		for (const root of roots) {
			if (queryBlockElement(root, selection.anchor.blockId)) {
				return root;
			}
		}
	}

	const domSelection = window.getSelection();
	const selectionRoot = resolveNodeRoot(domSelection?.anchorNode);
	if (selectionRoot) {
		return selectionRoot;
	}

	const activeRoot = resolveNodeRoot(document.activeElement);
	if (activeRoot) {
		return activeRoot;
	}

	const roots = document.querySelectorAll<HTMLElement>(
		`[${DATA_ATTRS.editorRoot}]`,
	);
	return roots.length === 1 ? roots[0] : null;
}

function resolveNodeRoot(node: Node | null | undefined): HTMLElement | null {
	if (!node) {
		return null;
	}

	if (node instanceof HTMLElement) {
		return node.closest(`[${DATA_ATTRS.editorRoot}]`);
	}

	return node.parentElement?.closest(`[${DATA_ATTRS.editorRoot}]`) ?? null;
}
