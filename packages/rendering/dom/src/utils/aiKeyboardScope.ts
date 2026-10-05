import type { Editor } from "@input/pen-types";
import { DATA_ATTRS } from "./dataAttributes";
import { closestDomElement, isDomHTMLElement } from "./domNodes";

const FORM_CONTROL_NAMES = new Set(["input", "textarea", "select"]);

export function shouldIgnoreAIKeyboardEvent(
	editor: Editor,
	event: KeyboardEvent,
): boolean {
	const eventElement = resolveEventElement(event.target);
	const editorRoot = resolveEditorRootForAI(
		editor,
		eventElement?.ownerDocument ?? document,
	);

	if (editorRoot && eventElement && !editorRoot.contains(eventElement)) {
		return true;
	}

	if (eventElement && FORM_CONTROL_NAMES.has(eventElement.localName)) {
		return true;
	}

	return (
		eventElement?.isContentEditable === true &&
		!editorRoot?.contains(eventElement)
	);
}

function resolveEditorRootForAI(
	editor: Editor,
	doc: Document,
): HTMLElement | null {
	const selection = editor.getSelection();
	const activeBlockId =
		selection?.type === "text"
			? selection.focus.blockId
			: selection?.type === "block"
				? (selection.blockIds[0] ?? null)
				: selection?.type === "cell"
					? selection.blockId
					: null;

	if (activeBlockId) {
		const activeBlock = doc.querySelector<HTMLElement>(
			`[${DATA_ATTRS.blockId}="${escapeForAttributeSelector(activeBlockId)}"]`,
		);
		const activeRoot = activeBlock?.closest(`[${DATA_ATTRS.editorRoot}]`);
		if (isDomHTMLElement(activeRoot)) {
			return activeRoot;
		}
	}

	const roots = doc.querySelectorAll<HTMLElement>(
		`[${DATA_ATTRS.editorRoot}]`,
	);
	return roots.length === 1 ? roots[0] : null;
}

function resolveEventElement(target: EventTarget | null): HTMLElement | null {
	const element = closestDomElement(target);
	return isDomHTMLElement(element) ? element : null;
}

function escapeForAttributeSelector(value: string): string {
	return typeof CSS !== "undefined" && CSS.escape
		? CSS.escape(value)
		: value.replace(/(["\\\]])/g, "\\$1");
}
