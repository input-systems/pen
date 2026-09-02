import { usesInlineTextSelection } from "@input/pen-core";
import type { Editor } from "@input/pen-types";
import { pointToEditorSelectionPoint } from "../field-editor/selectionBridge";
import { findInlineContentElement } from "../field-editor/selectionDomQueries";
import { DATA_ATTRS } from "../utils/dataAttributes";

export interface FieldEditorPointerTarget {
	getSnapshot(): {
		isEditing: boolean;
		focusBlockId: string | null;
	};
	activateTextSelection(
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
	): void;
	attachElement(element: HTMLElement): void;
}

export interface FieldEditorPointerActivateOptions {
	event: MouseEvent;
	editor: Editor;
	fieldEditor: FieldEditorPointerTarget;
	root: HTMLElement;
	blocksHost: HTMLElement;
	readonly?: boolean;
}

export function handleFieldEditorPointerActivate(
	options: FieldEditorPointerActivateOptions,
): boolean {
	const { event, editor, fieldEditor, root, blocksHost, readonly } = options;
	if (readonly === true || event.button !== 0) {
		return false;
	}

	const target = resolveEventElement(event.target);
	if (!target) {
		return false;
	}
	const isHostChrome = isEditorHostChrome(target, root, blocksHost);
	if (!isHostChrome && !blocksHost.contains(target)) {
		return false;
	}
	if (target.closest(`[${DATA_ATTRS.ignorePointerGesture}]`)) {
		return false;
	}

	const owningRoot = target.closest(`[${DATA_ATTRS.editorRoot}]`);
	if (owningRoot && owningRoot !== root) {
		return false;
	}

	const clickedBlock = target.closest(`[${DATA_ATTRS.editorBlock}]`);
	const hostFallback =
		clickedBlock instanceof HTMLElement && blocksHost.contains(clickedBlock)
			? null
			: resolveHostChromeFallbackBlock(event, editor, root, blocksHost);
	const blockElement =
		hostFallback?.element ??
		(clickedBlock instanceof HTMLElement &&
		blocksHost.contains(clickedBlock)
			? clickedBlock
			: null);
	if (!blockElement) {
		return false;
	}

	const blockId = blockElement.getAttribute(DATA_ATTRS.blockId);
	if (!blockId) {
		return false;
	}

	const block = editor.getBlock(blockId);
	const schema = block ? editor.schema.resolve(block.type) : null;
	if (!usesInlineTextSelection(schema)) {
		return false;
	}

	const snapshot = fieldEditor.getSnapshot();
	if (snapshot.isEditing && snapshot.focusBlockId === blockId) {
		return false;
	}

	event.preventDefault();
	if (hostFallback) {
		fieldEditor.activateTextSelection(
			blockId,
			hostFallback.offset,
			hostFallback.offset,
		);
	} else {
		const point = pointToEditorSelectionPoint(
			root,
			event.clientX,
			event.clientY,
		);
		if (point && point.blockId === blockId) {
			fieldEditor.activateTextSelection(
				point.blockId,
				point.offset,
				point.offset,
			);
		} else {
			const offset = block?.length() ?? 0;
			fieldEditor.activateTextSelection(blockId, offset, offset);
		}
	}

	const inline =
		target.closest(`[${DATA_ATTRS.inlineContent}]`) ??
		findInlineContentElement(blockElement);
	if (inline instanceof HTMLElement) {
		fieldEditor.attachElement(inline);
	}
	return true;
}

function resolveEventElement(target: EventTarget | null): Element | null {
	if (target instanceof Element) {
		return target;
	}
	if (target instanceof Node) {
		return target.parentElement;
	}
	return null;
}

function isEditorHostChrome(
	target: Element,
	root: HTMLElement,
	blocksHost: HTMLElement,
): boolean {
	return (
		target === root ||
		target === blocksHost ||
		target === blocksHost.parentElement
	);
}

function resolveHostChromeFallbackBlock(
	event: MouseEvent,
	editor: Editor,
	root: HTMLElement,
	blocksHost: HTMLElement,
): { element: HTMLElement; offset: number } | null {
	const textBlocks = collectHostTextBlocks(editor, root, blocksHost);
	if (textBlocks.length === 0) {
		return null;
	}

	let first: HTMLElement | null = null;
	let last: HTMLElement | null = null;
	let firstTop = Infinity;
	let lastBottom = -Infinity;
	for (const block of textBlocks) {
		const rect = block.getBoundingClientRect();
		if (rect.top < firstTop) {
			firstTop = rect.top;
			first = block;
		}
		if (rect.bottom > lastBottom) {
			lastBottom = rect.bottom;
			last = block;
		}
	}

	// strict compare keeps the zero-rect host-gap case inactive in jsdom
	if (last && event.clientY > lastBottom) {
		const blockId = last.getAttribute(DATA_ATTRS.blockId);
		const length = blockId ? (editor.getBlock(blockId)?.length() ?? 0) : 0;
		return { element: last, offset: length };
	}
	if (first && event.clientY < firstTop) {
		return { element: first, offset: 0 };
	}
	return null;
}

function collectHostTextBlocks(
	editor: Editor,
	root: HTMLElement,
	blocksHost: HTMLElement,
): HTMLElement[] {
	const textBlocks: HTMLElement[] = [];
	for (const element of blocksHost.querySelectorAll(
		`[${DATA_ATTRS.editorBlock}]`,
	)) {
		if (
			!(element instanceof HTMLElement) ||
			!blocksHost.contains(element)
		) {
			continue;
		}
		const owningRoot = element.closest(`[${DATA_ATTRS.editorRoot}]`);
		if (owningRoot && owningRoot !== root) {
			continue;
		}
		const blockId = element.getAttribute(DATA_ATTRS.blockId);
		if (!blockId) {
			continue;
		}
		const block = editor.getBlock(blockId);
		const schema = block ? editor.schema.resolve(block.type) : null;
		if (!usesInlineTextSelection(schema)) {
			continue;
		}
		textBlocks.push(element);
	}
	return textBlocks;
}
