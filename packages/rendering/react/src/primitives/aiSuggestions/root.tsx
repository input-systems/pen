import React from "react";
import type { Editor } from "@input/pen-types";
import { EditorContext } from "../../context/editorContext";
import { renderAsChild, type AsChildProps } from "../../utils/asChild";
import { captureFocusReturn, restoreFocusReturn } from "@input/pen-dom";
import { isDomElement, isDomNode } from "@input/pen-dom/utils/domNodes";
import {
	resolveEditorOwnerDocument,
	resolveEditorRootElement,
} from "../../utils/aiDomScope";
import { getAttachedFieldEditorSession } from "../../utils/fieldEditor";
import { useAISuggestionPopover } from "../../hooks/useAISuggestionPopover";

interface AISuggestionsContextValue {
	editor: Editor;
	popover: ReturnType<typeof useAISuggestionPopover>;
}

const AISuggestionsContext =
	React.createContext<AISuggestionsContextValue | null>(null);

const AI_SUGGESTIONS_STYLESHEET_ID = "pen-ai-suggestions-styles";
const AI_SUGGESTIONS_STYLES = `
.pen-ai-suggestion-underline {
	cursor: pointer;
	background-image: linear-gradient(
		90deg,
		var(--pen-ai-suggestion-line, #3b82f6),
		var(--pen-ai-suggestion-line, #3b82f6)
	);
	background-repeat: no-repeat;
	background-size: 100% 2px;
	background-position: 0 100%;
	transition: filter 180ms ease;
}

[data-pen-reduced-motion] .pen-ai-suggestion-underline {
	transition: none;
}

.pen-ai-suggestion-underline:hover {
	--pen-ai-suggestion-line: var(--pen-ai-suggestion-line-hover, #1d4ed8);
	filter: saturate(1.08);
}

.pen-ai-suggestion-active {
	--pen-ai-suggestion-line: var(--pen-ai-suggestion-line-active, #1d4ed8);
	filter: saturate(1.08);
}

.pen-ai-suggestion-active:hover {
	--pen-ai-suggestion-line: var(--pen-ai-suggestion-line-active-hover, #1e40af);
}
`;

/**
 * AX3 detached-surface host. Escape on the open suggestion popover
 * (`role="dialog"`) closes it and restores focus to the editing position.
 */
export interface AISuggestionsRootProps extends AsChildProps {
	editor?: Editor;
	ref?: React.Ref<HTMLElement>;
}

export function AISuggestionsRoot(props: AISuggestionsRootProps) {
	const { editor: editorProp, ...rest } = props;
	const editorContext = React.useContext(EditorContext);
	const editor = editorProp ?? editorContext?.editor;
	if (!editor) {
		throw new Error(
			"Pen AI suggestions primitives require an editor or Pen.Editor.Root context.",
		);
	}

	const popover = useAISuggestionPopover(editor);
	const { closeSuggestion, openSuggestion } = popover;

	React.useEffect(() => {
		const handleClick = (event: MouseEvent) => {
			const target = isDomElement(event.target) ? event.target : null;
			const anchor = target?.closest(
				"[data-ai-suggestion-id]",
			) as HTMLElement | null;
			if (!anchor) {
				if (
					target?.closest("[data-pen-ai-suggestions-popover]") == null
				) {
					closeSuggestion();
				}
				return;
			}

			const suggestionId = anchor.dataset.aiSuggestionId;
			if (!suggestionId) {
				return;
			}

			event.preventDefault();
			openSuggestion(suggestionId);
		};

		const doc = resolveEditorOwnerDocument(editor);
		doc.addEventListener("click", handleClick, true);
		return () => {
			doc.removeEventListener("click", handleClick, true);
		};
	}, [closeSuggestion, editor, openSuggestion]);

	const isPopoverOpen = Boolean(popover.activeSuggestion && popover.position);

	React.useEffect(() => {
		if (!isPopoverOpen) {
			return;
		}

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			restoreEditorFocus(editor);
			closeSuggestion();
		};

		const doc = resolveEditorOwnerDocument(editor);
		doc.addEventListener("keydown", handleKeyDown, true);
		return () => {
			doc.removeEventListener("keydown", handleKeyDown, true);
		};
	}, [closeSuggestion, editor, isPopoverOpen]);

	React.useEffect(() => {
		const doc = resolveEditorOwnerDocument(editor);
		let styleElement = doc.getElementById(
			AI_SUGGESTIONS_STYLESHEET_ID,
		) as HTMLStyleElement | null;

		if (!styleElement) {
			styleElement = doc.createElement("style");
			styleElement.id = AI_SUGGESTIONS_STYLESHEET_ID;
			doc.head.appendChild(styleElement);
		}
		styleElement.textContent = AI_SUGGESTIONS_STYLES;

		const nextRefCount = Number(styleElement.dataset.refCount ?? "0") + 1;
		styleElement.dataset.refCount = String(nextRefCount);

		return () => {
			if (!styleElement) {
				return;
			}
			const currentRefCount =
				Number(styleElement.dataset.refCount ?? "1") - 1;
			if (currentRefCount <= 0) {
				styleElement.remove();
				return;
			}
			styleElement.dataset.refCount = String(currentRefCount);
		};
	}, [editor]);

	return (
		<AISuggestionsContext.Provider value={{ editor, popover }}>
			{renderAsChild(rest, "div", {
				"data-pen-ai-suggestions-root": "",
			})}
		</AISuggestionsContext.Provider>
	);
}

export function useAISuggestionsContext(): AISuggestionsContextValue {
	const context = React.useContext(AISuggestionsContext);
	if (!context) {
		throw new Error(
			"Pen AI suggestions primitives must be used within <Pen.AISuggestions.Root>.",
		);
	}
	return context;
}

/**
 * AX3: a caret-anchored popup never takes focus, so Escape leaves focus
 * where it is when the editor holds it; focus that fell out of the editor
 * goes to the editor surface.
 */
function restoreEditorFocus(editor: Editor): void {
	const root = resolveEditorRootElement(editor);
	if (!root) {
		return;
	}
	const active = root.ownerDocument.activeElement;
	if (isDomNode(active) && root.contains(active)) {
		return;
	}
	restoreFocusReturn(
		captureFocusReturn(root),
		getAttachedFieldEditorSession(editor),
		"surface",
	);
}
