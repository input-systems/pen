// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
	captureFocusReturn,
	restoreFocusReturn,
	type FocusReturnFieldEditor,
} from "../focusReturn";
import { createFocusSink } from "../focusSink";
import { DATA_ATTRS } from "../../utils/dataAttributes";

const cleanups: Array<() => void> = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) {
		cleanup();
	}
});

function mount<T extends HTMLElement>(
	element: T,
	parent: HTMLElement = document.body,
): T {
	parent.appendChild(element);
	cleanups.push(() => element.remove());
	return element;
}

function makeRoot(): { root: HTMLElement; field: HTMLElement } {
	const root = document.createElement("div");
	root.setAttribute(DATA_ATTRS.editorRoot, "");
	root.tabIndex = 0;
	const field = document.createElement("div");
	field.setAttribute(DATA_ATTRS.fieldEditorSurface, "");
	field.contentEditable = "true";
	field.tabIndex = 0;
	root.appendChild(field);
	mount(root);
	return { root, field };
}

/** The focus controller's write, as `FieldEditorImpl` routes it. */
function makeFieldEditor(field: HTMLElement | null): FocusReturnFieldEditor & {
	requestRootFocus: ReturnType<typeof vi.fn>;
} {
	return {
		focus: () => {
			if (!field) return false;
			field.focus();
			return true;
		},
		requestRootFocus: vi.fn((target: HTMLElement, _reason, options) => {
			target.focus(options);
			return true;
		}),
	};
}

describe("focusReturn (AX3)", () => {
	it("AX3: restoreFocusReturn prefers a connected target, falls back to the field, then the sink, and never steals from a native input", () => {
		const { root, field } = makeRoot();
		const handle = mount(document.createElement("button"), root);

		// Connected target: focus returns to it, through the focus controller.
		handle.focus();
		const token = captureFocusReturn(root);
		expect(token.target).toBe(handle);
		const menuItem = mount(document.createElement("button"), root);
		menuItem.focus();
		const fieldEditor = makeFieldEditor(field);
		expect(restoreFocusReturn(token, fieldEditor, "target")).toBe("target");
		expect(document.activeElement).toBe(handle);
		expect(fieldEditor.requestRootFocus).toHaveBeenCalledWith(
			handle,
			"restore",
			{ preventScroll: true },
		);

		// Disconnected target: the active field.
		const removed = captureFocusReturn(root, handle);
		handle.remove();
		menuItem.focus();
		expect(restoreFocusReturn(removed, fieldEditor, "target")).toBe(
			"surface",
		);
		expect(document.activeElement).toBe(field);

		// No field: the revealed sink.
		const sink = createFocusSink();
		root.prepend(sink.element);
		cleanups.push(() => sink.dispose());
		sink.reveal({ kind: "block", label: "1 block selected" });
		menuItem.focus();
		const noField = makeFieldEditor(null);
		expect(restoreFocusReturn(removed, noField, "target")).toBe("surface");
		expect(document.activeElement).toBe(sink.element);

		// Hidden sink: the root.
		sink.hide();
		menuItem.focus();
		expect(restoreFocusReturn(removed, noField, "surface")).toBe("surface");
		expect(document.activeElement).toBe(root);

		// A native input that took focus meanwhile keeps it (HOST9).
		const hostInput = mount(document.createElement("input"));
		hostInput.focus();
		expect(restoreFocusReturn(token, fieldEditor, "surface")).toBe("none");
		expect(document.activeElement).toBe(hostInput);
	});

	it("AX3: focus inside the closing surface does not block the return", () => {
		const { root, field } = makeRoot();
		const popover = mount(document.createElement("div"));
		const prompt = mount(document.createElement("textarea"), popover);
		field.focus();
		const token = captureFocusReturn(root);
		prompt.focus();

		const fieldEditor = makeFieldEditor(field);
		expect(restoreFocusReturn(token, fieldEditor, "target")).toBe("none");
		expect(document.activeElement).toBe(prompt);
		expect(
			restoreFocusReturn(token, fieldEditor, "target", {
				owner: popover,
			}),
		).toBe("surface");
		expect(document.activeElement).toBe(field);
	});

	it("AX3: a native text-entry target outside the root is not a return target", () => {
		const { root, field } = makeRoot();
		const hostInput = mount(document.createElement("input"));
		const token = captureFocusReturn(root, hostInput);
		const button = mount(document.createElement("button"), root);
		button.focus();

		expect(
			restoreFocusReturn(token, makeFieldEditor(field), "target"),
		).toBe("surface");
		expect(document.activeElement).toBe(field);
	});

	it('AX3: "surface" ignores the recorded target', () => {
		const { root, field } = makeRoot();
		const button = mount(document.createElement("button"), root);
		button.focus();
		const token = captureFocusReturn(root);

		expect(
			restoreFocusReturn(token, makeFieldEditor(field), "surface"),
		).toBe("surface");
		expect(document.activeElement).toBe(field);
	});
});
