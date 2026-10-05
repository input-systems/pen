// @vitest-environment jsdom

import type { CellSelection } from "@input/pen-types";
import { describe, expect, it, vi } from "vitest";
import {
	DEFAULT_SELECT_ALL_BEHAVIOR,
	handleEditorDocumentKeyDown,
	handleFieldEditorPointerActivate,
	isActiveFieldEditorTextEntryTarget,
	isFieldEditorTextEditingKey,
	isFieldEditorTextEntryTarget,
	isNativeTextEntryTarget,
	mountEditor,
	resolveSelectAllBehavior,
	shouldHandleEditorKeyboardEvent,
} from "../index";
import {
	DATA_ATTRS,
	buildDataAttributes,
	penDataAttr,
} from "../utils/dataAttributes";

function collapsedTextSelection() {
	return {
		type: "text" as const,
		anchor: { blockId: "a", offset: 0 },
		focus: { blockId: "a", offset: 0 },
	};
}

function multiBlockTextSelection() {
	return {
		type: "text" as const,
		anchor: { blockId: "a", offset: 0 },
		focus: { blockId: "b", offset: 1 },
	};
}

function expandedTextSelection() {
	return {
		type: "text" as const,
		anchor: { blockId: "a", offset: 0 },
		focus: { blockId: "a", offset: 3 },
	};
}

describe("@input/pen-dom public helpers", () => {
	it("exports mountEditor as the document-shell composition", () => {
		expect(typeof mountEditor).toBe("function");
	});

	it("exports handleFieldEditorPointerActivate for host click-to-edit", () => {
		expect(typeof handleFieldEditorPointerActivate).toBe("function");
	});

	it("resolves select-all behavior from the interaction model", () => {
		expect(DEFAULT_SELECT_ALL_BEHAVIOR).toBe("document-first");
		expect(resolveSelectAllBehavior("block-first")).toBe("block-first");
		expect(resolveSelectAllBehavior("content-first")).toBe(
			"document-first",
		);
	});

	it("builds DOM data attributes predictably", () => {
		expect(penDataAttr("editor-root")).toBe("data-pen-editor-root");
		expect(DATA_ATTRS.editorRoot).toBe("data-pen-editor-root");
		expect(DATA_ATTRS.inlineAtomCaretBoundary).toBe(
			"data-pen-inline-atom-caret-boundary",
		);
		expect(DATA_ATTRS.inlineAtomCaretSide).toBe(
			"data-pen-inline-atom-caret-side",
		);
		expect(DATA_ATTRS.inlineAtomDragging).toBe(
			"data-pen-inline-atom-dragging",
		);
		expect(
			buildDataAttributes({
				role: "editor",
				active: true,
				hidden: false,
				index: 2,
				empty: undefined,
				[DATA_ATTRS.focused]: true,
			}),
		).toEqual({
			"data-role": "editor",
			"data-active": "",
			"data-index": "2",
			"data-focused": "",
		});
	});

	it("classifies native and field-editor text entry targets", () => {
		const input = document.createElement("input");
		const checkbox = document.createElement("input");
		checkbox.type = "checkbox";
		const textbox = document.createElement("div");
		textbox.setAttribute("role", "textbox");
		const fieldSurface = document.createElement("div");
		fieldSurface.setAttribute(DATA_ATTRS.fieldEditorSurface, "");
		const activeFieldSurface = document.createElement("div");
		activeFieldSurface.setAttribute(
			DATA_ATTRS.fieldEditorActiveSurface,
			"",
		);

		expect(isNativeTextEntryTarget(input)).toBe(true);
		expect(isNativeTextEntryTarget(checkbox)).toBe(false);
		expect(isNativeTextEntryTarget(textbox)).toBe(true);
		const editorRoot = document.createElement("div");
		editorRoot.setAttribute("role", "textbox");
		editorRoot.setAttribute(DATA_ATTRS.editorRoot, "");
		const insideEditor = document.createElement("div");
		editorRoot.append(insideEditor);
		expect(isNativeTextEntryTarget(editorRoot)).toBe(false);
		expect(isNativeTextEntryTarget(insideEditor)).toBe(false);
		expect(isFieldEditorTextEntryTarget(fieldSurface)).toBe(true);
		expect(isActiveFieldEditorTextEntryTarget(activeFieldSurface)).toBe(
			true,
		);
	});

	it("rejects modified or composing field-editor editing keys", () => {
		expect(
			isFieldEditorTextEditingKey(
				new KeyboardEvent("keydown", { key: "a" }),
			),
		).toBe(true);
		expect(
			isFieldEditorTextEditingKey(
				new KeyboardEvent("keydown", { key: "a", metaKey: true }),
			),
		).toBe(false);
		expect(
			isFieldEditorTextEditingKey(
				new KeyboardEvent("keydown", {
					key: "Backspace",
					isComposing: true,
				}),
			),
		).toBe(false);
	});

	it("routes document keyboard handling through the shared text-entry model", () => {
		const root = document.createElement("div");
		root.setAttribute(DATA_ATTRS.editorRoot, "");
		const activeFieldSurface = document.createElement("div");
		activeFieldSurface.setAttribute(DATA_ATTRS.fieldEditorSurface, "");
		activeFieldSurface.setAttribute(
			DATA_ATTRS.fieldEditorActiveSurface,
			"",
		);
		root.append(activeFieldSurface);
		document.body.append(root);

		let shouldHandleCollapsedText = true;
		activeFieldSurface.addEventListener(
			"keydown",
			(event) => {
				shouldHandleCollapsedText = shouldHandleEditorKeyboardEvent({
					root,
					event,
					selection: collapsedTextSelection(),
				});
			},
			{ once: true },
		);
		activeFieldSurface.dispatchEvent(
			new KeyboardEvent("keydown", { key: "a", bubbles: true }),
		);
		expect(shouldHandleCollapsedText).toBe(false);

		let shouldHandleMultiBlockText = false;
		activeFieldSurface.addEventListener(
			"keydown",
			(event) => {
				shouldHandleMultiBlockText = shouldHandleEditorKeyboardEvent({
					root,
					event,
					selection: multiBlockTextSelection(),
				});
			},
			{ once: true },
		);
		activeFieldSurface.dispatchEvent(
			new KeyboardEvent("keydown", { key: "a", bubbles: true }),
		);
		expect(shouldHandleMultiBlockText).toBe(true);

		// T6/A1: an edited cell's Backspace belongs to its field, while a
		// grid selection's Backspace still clears cells at the document.
		const routeBackspace = (selection: CellSelection): boolean => {
			let routed = false;
			activeFieldSurface.addEventListener(
				"keydown",
				(event) => {
					routed = shouldHandleEditorKeyboardEvent({
						root,
						event,
						selection,
					});
				},
				{ once: true },
			);
			activeFieldSurface.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "Backspace",
					bubbles: true,
				}),
			);
			return routed;
		};
		const gridCell: CellSelection = {
			type: "cell",
			blockId: "table-1",
			anchor: { row: 0, col: 0 },
			head: { row: 0, col: 0 },
		};
		expect(
			routeBackspace({ ...gridCell, text: { anchor: 4, focus: 2 } }),
		).toBe(false);
		expect(routeBackspace(gridCell)).toBe(true);

		expect(
			shouldHandleEditorKeyboardEvent({
				root,
				event: new KeyboardEvent("keydown", { key: "Backspace" }),
				selection: {
					type: "block",
					blockIds: ["block-1"],
				},
			}),
		).toBe(true);

		expect(
			shouldHandleEditorKeyboardEvent({
				root,
				event: new KeyboardEvent("keydown", {
					key: "z",
					metaKey: true,
				}),
				selection: collapsedTextSelection(),
			}),
		).toBe(true);

		const externalInput = document.createElement("input");
		document.body.append(externalInput);
		externalInput.focus();
		expect(
			shouldHandleEditorKeyboardEvent({
				root,
				event: new KeyboardEvent("keydown", {
					key: "z",
					metaKey: true,
				}),
				selection: collapsedTextSelection(),
			}),
		).toBe(false);
		externalInput.remove();

		root.remove();
	});

	it("keeps keyboard routing scoped to the active editor root", () => {
		const root = document.createElement("div");
		root.setAttribute(DATA_ATTRS.editorRoot, "");
		const otherRoot = document.createElement("div");
		otherRoot.setAttribute(DATA_ATTRS.editorRoot, "");
		const otherFieldSurface = document.createElement("div");
		otherFieldSurface.setAttribute(DATA_ATTRS.fieldEditorSurface, "");
		otherRoot.append(otherFieldSurface);
		document.body.append(root, otherRoot);

		expect(
			shouldHandleEditorKeyboardEvent({
				root,
				event: new KeyboardEvent("keydown", {
					key: "Backspace",
				}),
				selection: null,
				hasMappedDomSelection: () => true,
			}),
		).toBe(true);

		let shouldHandleOtherRootEvent = true;
		otherFieldSurface.addEventListener(
			"keydown",
			(event) => {
				shouldHandleOtherRootEvent = shouldHandleEditorKeyboardEvent({
					root,
					event,
					selection: {
						type: "block",
						blockIds: ["block-1"],
					},
				});
			},
			{ once: true },
		);
		otherFieldSurface.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }),
		);
		expect(shouldHandleOtherRootEvent).toBe(false);

		root.remove();
		otherRoot.remove();
	});

	it("does not route document keys while a detached surface holds focus", () => {
		const root = document.createElement("div");
		root.setAttribute(DATA_ATTRS.editorRoot, "");
		root.setAttribute("role", "textbox");
		const toolbar = document.createElement("div");
		toolbar.setAttribute("role", "toolbar");
		const button = document.createElement("button");
		toolbar.append(button);
		root.append(toolbar);
		document.body.append(root);
		button.focus();

		let shouldHandle = true;
		button.addEventListener(
			"keydown",
			(event) => {
				shouldHandle = shouldHandleEditorKeyboardEvent({
					root,
					event,
					selection: expandedTextSelection(),
				});
			},
			{ once: true },
		);
		button.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
		expect(shouldHandle).toBe(false);

		root.remove();
	});

	it("deletes document selections through the shared keydown handler with user origin", () => {
		const root = document.createElement("div");
		const deleteSelection = vi.fn();
		const deactivate = vi.fn();
		const editor = {
			selection: {
				type: "block",
				blockIds: ["block-1"],
			},
			deleteSelection,
			firstBlock: () => null,
			internals: {},
		};
		const fieldEditor = {
			deactivate,
			isComposing: false,
			isEditing: false,
		};

		const handled = handleEditorDocumentKeyDown({
			event: new KeyboardEvent("keydown", { key: "Backspace" }),
			editor: editor as never,
			fieldEditor: fieldEditor as never,
			root,
		});

		expect(handled).toBe(true);
		expect(deleteSelection).toHaveBeenCalledWith({ origin: "user" });
		expect(deactivate).toHaveBeenCalled();
	});
});
