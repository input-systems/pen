import React, { createContext, useContext, useEffect } from "react";
import { aiControllerFacet } from "@input/pen-core";
import type { Editor } from "@input/pen-types";
import type { AIController } from "@input/pen-ai";
import { EditorContext } from "../../context/editorContext";
import { useAI } from "../../hooks/useAI";
import { DATA_ATTRS } from "@input/pen-dom/utils/dataAttributes";
import { getAutocompleteController } from "../../utils/autocompleteController";
import { shouldIgnoreAIKeyboardEvent } from "../../utils/aiKeyboardScope";
import { renderAsChild, type AsChildProps } from "../../utils/asChild";
import { resolveEditorOwnerDocument } from "../../utils/aiDomScope";
interface AIContextValue {
	editor: Editor;
	controller: AIController | null;
	state: ReturnType<typeof useAI>;
}

const AIContext = createContext<AIContextValue | null>(null);

export function useAIContext(): AIContextValue {
	const ctx = useContext(AIContext);
	if (!ctx) {
		throw new Error("Missing Pen.AI.Root context");
	}
	return ctx;
}

export interface AIRootProps extends AsChildProps {
	editor?: Editor;
	ref?: React.Ref<HTMLElement>;
}

export function AIRoot(props: AIRootProps) {
	const { editor: editorProp, ...rest } = props;
	const editorContext = useContext(EditorContext);
	const editor = editorProp ?? editorContext?.editor;
	if (!editor) {
		throw new Error("Missing editor for Pen.AI.Root");
	}

	const state = useAI(editor);
	const controller =
		(editor.facet(aiControllerFacet) as AIController | null) ?? null;
	const primitiveProps: Record<string, unknown> = {
		"data-pen-ai-root": "",
		[DATA_ATTRS.viewId]: editor.internals.viewId,
		"data-connected": controller ? "" : undefined,
		"data-generating":
			state.activeGeneration?.status === "streaming" ? "" : undefined,
		"data-suggest-mode": state.suggestMode ? "" : undefined,
	};

	useEffect(() => {
		if (!controller || !state.ephemeralSuggestion) {
			return;
		}

		const handleKeyDown = (event: KeyboardEvent) => {
			if (shouldIgnoreAIKeyboardEvent(editor, event)) {
				return;
			}
			const autocomplete = getAutocompleteController(editor);
			if (autocomplete?.hasVisibleSuggestion()) {
				return;
			}
			if (
				event.key.length === 1 ||
				event.key === "Backspace" ||
				event.key === "Delete" ||
				event.key === "Enter"
			) {
				controller.dismissEphemeralSuggestion();
			}
		};

		const doc = resolveEditorOwnerDocument(editor);
		doc.addEventListener("keydown", handleKeyDown, true);
		return () =>
			doc.removeEventListener("keydown", handleKeyDown, true);
	}, [controller, editor, state.ephemeralSuggestion]);

	return (
		<AIContext.Provider value={{ editor, controller, state }}>
			{renderAsChild(rest, "div", primitiveProps)}
		</AIContext.Provider>
	);
}
