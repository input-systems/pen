import { isCollapsed, isMultiBlock } from "@input/pen-core";
import type { ReadonlySelectionState } from "@input/pen-types";
import { DATA_ATTRS } from "./dataAttributes";
import { closestDomElement, isDomHTMLElement, isDomNode } from "./domNodes";

const TEXTBOX_ROLE_SELECTOR = '[role~="textbox"]';
const FIELD_EDITOR_SURFACE_SELECTOR = `[${DATA_ATTRS.fieldEditorSurface}]`;
const ACTIVE_FIELD_EDITOR_SURFACE_SELECTOR = `[${DATA_ATTRS.fieldEditorActiveSurface}]`;
const DETACHED_SURFACE_SELECTOR = [
	'[role="toolbar"]',
	'[role="menu"]',
	'[role="dialog"]',
	"[data-pen-selection-toolbar-content]",
	"[data-pen-toolbar]",
].join(",");

type KeyboardRoutingSelection = ReadonlySelectionState | undefined;

type EditorKeyboardRoutingOptions = {
	root: HTMLElement;
	event: KeyboardEvent;
	selection: KeyboardRoutingSelection;
	hasMappedDomSelection?: () => boolean;
	handleCollapsedTextSelection?: boolean;
};

export function isNativeTextEntryTarget(
	target: EventTarget | null,
): target is HTMLElement {
	if (!isDomHTMLElement(target)) {
		return false;
	}

	// Tag names, not constructors: a host iframe's controls are not
	// instances of this window's `HTMLInputElement`.
	if (target.localName === "input") {
		return isTextEntryInput(target as HTMLInputElement);
	}

	if (
		target.isContentEditable ||
		target.localName === "textarea" ||
		target.localName === "select"
	) {
		return true;
	}

	const textbox = target.closest(TEXTBOX_ROLE_SELECTOR);
	if (!isDomHTMLElement(textbox)) {
		return false;
	}

	// AX1 marks the editor root as a textbox. That is surface semantics,
	// not a nested native control, so descendants stay document-routable.
	return !textbox.hasAttribute(DATA_ATTRS.editorRoot);
}

export function isFieldEditorTextEntryTarget(
	target: EventTarget | null,
): target is HTMLElement {
	const element = closestDomElement(target);
	return element
		? element.closest(FIELD_EDITOR_SURFACE_SELECTOR) !== null
		: false;
}

export function isActiveFieldEditorTextEntryTarget(
	target: EventTarget | null,
): target is HTMLElement {
	const element = closestDomElement(target);
	return element
		? element.closest(ACTIVE_FIELD_EDITOR_SURFACE_SELECTOR) !== null
		: false;
}

export function isTextEntryTarget(
	target: EventTarget | null,
): target is HTMLElement {
	return (
		isNativeTextEntryTarget(target) || isFieldEditorTextEntryTarget(target)
	);
}

/**
 * Text entry that is not `root`'s own field. Host chrome — a prompt textarea
 * nested in the root, or an input outside it — keeps its own caret, and so
 * does another editor's field surface (HOST9). `root`'s field surface is
 * contenteditable, so it is not this case.
 */
export function isForeignNativeTextEntryTarget(
	target: EventTarget | null,
	root: HTMLElement,
): boolean {
	if (isFieldEditorTextEntryTarget(target)) {
		return getClosestEditorRoot(target) !== root;
	}
	return isNativeTextEntryTarget(target);
}

export function isFieldEditorTextEditingKey(event: KeyboardEvent): boolean {
	if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) {
		return false;
	}

	return (
		event.key.length === 1 ||
		event.key === "Enter" ||
		event.key === "Backspace" ||
		event.key === "Delete" ||
		event.key === "ArrowUp" ||
		event.key === "ArrowDown" ||
		event.key === "ArrowLeft" ||
		event.key === "ArrowRight" ||
		event.key === "Home" ||
		event.key === "End"
	);
}

export function shouldHandleEditorKeyboardEvent({
	root,
	event,
	selection,
	hasMappedDomSelection,
	handleCollapsedTextSelection = false,
}: EditorKeyboardRoutingOptions): boolean {
	const targetRoot = getClosestEditorRoot(event.target);
	if (targetRoot && targetRoot !== root) {
		return false;
	}

	if (
		isFieldEditorTextEditingKey(event) &&
		isActiveFieldEditorTextEntryTarget(event.target)
	) {
		return isSelectionThatOverridesActiveTextEditingKey(selection);
	}

	if (
		isNativeTextEntryTarget(event.target) &&
		!isFieldEditorTextEntryTarget(event.target) &&
		!root.contains(event.target)
	) {
		return false;
	}

	const activeElement = root.ownerDocument?.activeElement;
	const activeRoot = getClosestEditorRoot(activeElement);
	if (activeRoot && activeRoot !== root) {
		return false;
	}

	if (isDomNode(activeElement) && root.contains(activeElement)) {
		if (isFieldEditorTextEntryTarget(activeElement)) {
			if (event.key === "Escape" || isCollapsedSelectAll(event)) {
				return true;
			}

			return isDocumentSelection(selection, handleCollapsedTextSelection);
		}

		if (isNativeTextEntryTarget(activeElement)) {
			return false;
		}

		if (isDetachedLibrarySurface(activeElement)) {
			return false;
		}

		return true;
	}

	if (
		isDomNode(activeElement) &&
		!root.contains(activeElement) &&
		isNativeTextEntryTarget(activeElement)
	) {
		return false;
	}

	if (hasMappedDomSelection?.()) {
		return true;
	}

	if (isDocumentShortcut(event)) {
		return isDocumentSelection(selection, true);
	}

	return isDocumentSelection(selection, handleCollapsedTextSelection);
}

export function getClosestEditorRoot(
	target: EventTarget | null,
): HTMLElement | null {
	const element = closestDomElement(target);
	return element?.closest(`[${DATA_ATTRS.editorRoot}]`) as HTMLElement | null;
}

function isDetachedLibrarySurface(target: EventTarget | null): boolean {
	const element = closestDomElement(target);
	return element?.closest(DETACHED_SURFACE_SELECTOR) !== null;
}

function isDocumentSelection(
	selection: KeyboardRoutingSelection,
	handleCollapsedTextSelection: boolean,
): boolean {
	if (selection?.type === "cell") {
		return true;
	}

	if (selection?.type === "block") {
		return (selection.blockIds?.length ?? 0) > 0;
	}

	if (selection?.type === "text") {
		return (
			handleCollapsedTextSelection ||
			isMultiBlock(selection) ||
			!isCollapsed(selection)
		);
	}

	return false;
}

function isSelectionThatOverridesActiveTextEditingKey(
	selection: KeyboardRoutingSelection,
): boolean {
	return selection?.type === "cell" || isMultiBlock(selection ?? null);
}

function isCollapsedSelectAll(event: KeyboardEvent): boolean {
	return (
		event.key.toLowerCase() === "a" &&
		!event.shiftKey &&
		!event.altKey &&
		(event.metaKey || event.ctrlKey)
	);
}

function isDocumentShortcut(event: KeyboardEvent): boolean {
	const key = event.key.toLowerCase();
	return (
		!event.altKey &&
		(event.metaKey || event.ctrlKey) &&
		(key === "a" || key === "z")
	);
}

function isTextEntryInput(input: HTMLInputElement): boolean {
	return !(
		input.type === "checkbox" ||
		input.type === "radio" ||
		input.type === "button" ||
		input.type === "submit" ||
		input.type === "reset" ||
		input.type === "range" ||
		input.type === "color" ||
		input.type === "file"
	);
}
