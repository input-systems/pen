import type { Editor } from "@input/pen-types";
import { queryBlockElement } from "../field-editor/selectionBridge";
import { DATA_ATTRS } from "./dataAttributes";

const AI_ROOT_SELECTOR = "[data-pen-ai-root]";

export function resolveAIRootElement(editor: Editor): HTMLElement | null {
	const root = document.querySelector<HTMLElement>(
		`${AI_ROOT_SELECTOR}[${DATA_ATTRS.viewId}="${escapeForAttributeSelector(editor.internals.viewId)}"]`,
	);
	if (root) {
		return root;
	}
	const roots = document.querySelectorAll<HTMLElement>(AI_ROOT_SELECTOR);
	return roots.length === 1 ? roots[0] : null;
}

export function resolveEditorRootElement(editor: Editor): HTMLElement | null {
	const root = document.querySelector<HTMLElement>(
		`[${DATA_ATTRS.editorRoot}][${DATA_ATTRS.viewId}="${escapeForAttributeSelector(editor.internals.viewId)}"]`,
	);
	if (root) {
		return root;
	}
	const roots = document.querySelectorAll<HTMLElement>(
		`[${DATA_ATTRS.editorRoot}]`,
	);
	return roots.length === 1 ? roots[0] : null;
}

/**
 * The editor root a piece of chrome belongs to: the root that contains it,
 * else this editor's root by view id (chrome rendered or portaled outside
 * it). AX3 focus return scopes every lookup to this root.
 */
export function resolveChromeEditorRoot(
	editor: Editor,
	element: Element | null,
): HTMLElement | null {
	return (
		element?.closest<HTMLElement>(`[${DATA_ATTRS.editorRoot}]`) ??
		resolveEditorRootElement(editor)
	);
}

export function resolveEditorContentElement(
	editor: Editor,
): HTMLElement | null {
	const aiRoot = resolveAIRootElement(editor);
	const aiHost =
		aiRoot?.querySelector<HTMLElement>(`[${DATA_ATTRS.editorContent}]`) ??
		null;
	if (aiHost) {
		return aiHost;
	}
	const editorRoot = resolveEditorRootElement(editor);
	return (
		editorRoot?.querySelector<HTMLElement>(
			`[${DATA_ATTRS.editorContent}]`,
		) ?? null
	);
}

export function queryEditorBlockElement(
	editor: Editor,
	blockId: string,
): HTMLElement | null {
	const host =
		resolveEditorContentElement(editor) ?? resolveEditorRootElement(editor);
	return host ? queryBlockElement(host, blockId) : null;
}

export function querySuggestionAnchorElements(editor: Editor): HTMLElement[] {
	const scopeRoot =
		resolveAIRootElement(editor) ?? resolveEditorRootElement(editor);
	if (!scopeRoot) {
		return [];
	}
	return [...scopeRoot.querySelectorAll<HTMLElement>("[data-suggestion-id]")];
}

export function queryAISuggestionAnchorElement(
	editor: Editor,
	suggestionId: string,
): HTMLElement | null {
	const scopeRoot =
		resolveAIRootElement(editor) ?? resolveEditorRootElement(editor);
	if (!scopeRoot) {
		return null;
	}
	return scopeRoot.querySelector<HTMLElement>(
		`[data-ai-suggestion-id="${escapeForAttributeSelector(suggestionId)}"]`,
	);
}

function escapeForAttributeSelector(value: string): string {
	return typeof CSS !== "undefined" && CSS.escape
		? CSS.escape(value)
		: value.replace(/(["\\\]])/g, "\\$1");
}
