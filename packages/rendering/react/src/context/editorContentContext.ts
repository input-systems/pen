import { createContext, useContext } from "react";

/** Kept to what blocks cannot read from their notifier slices (SCALE6). */
export interface EditorContentContextValue {
	emptyPlaceholder?: string;
}

const EMPTY_EDITOR_CONTENT_CONTEXT: EditorContentContextValue = {
	emptyPlaceholder: undefined,
};

export const EditorContentContext =
	createContext<EditorContentContextValue | null>(null);

export function useEditorContentContext(): EditorContentContextValue {
	return useContext(EditorContentContext) ?? EMPTY_EDITOR_CONTENT_CONTEXT;
}
