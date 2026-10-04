// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { fieldEditorHostFacet } from "@input/pen-core";
import type { FieldEditorImpl } from "@input/pen-dom/field-editor/fieldEditorImpl";
import { useSuggestionMenu } from "../hooks/useSuggestionMenu";
import { Pen } from "../primitives/index";
import {
	createSuggestionMenuEditor,
	dispatchKey,
	waitForCondition,
} from "./utils/suggestionMenuTestHelpers";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const h = React.createElement;

async function flushAnimationFrames(count = 1): Promise<void> {
	for (let i = 0; i < count; i += 1) {
		await new Promise<void>((resolve) => {
			requestAnimationFrame(() => resolve());
		});
	}
}

function getFieldEditor(
	editor: ReturnType<typeof createSuggestionMenuEditor>,
): FieldEditorImpl {
	const fieldEditor = editor.facet(
		fieldEditorHostFacet,
	) as FieldEditorImpl | null;
	if (!fieldEditor) {
		throw new Error("Missing attached field editor");
	}
	return fieldEditor;
}

function requireElement<T extends Element>(
	element: T | null,
	label: string,
): T {
	if (!element) {
		throw new Error(`Missing ${label}`);
	}
	return element;
}

function focusField(field: HTMLElement): void {
	if (!field.hasAttribute("tabindex")) {
		field.tabIndex = 0;
	}
	field.focus();
}

describe("AX3 caret-anchored suggestion menu", () => {
	it("AX3 wires listbox option ids and field aria without stealing focus", async () => {
		const editor = createSuggestionMenuEditor();
		const blockId = editor.firstBlock()!.id;

		function Harness() {
			const menu = useSuggestionMenu<string>({
				editor,
				trigger: {
					char: "@",
					boundary: "whitespace",
					minQueryLength: 1,
				},
				getItems: () => ["Alex", "Alice", "Amy"],
				onSelect: vi.fn(),
			});
			const menuItems = menu.items.map((item, index) =>
				h(Pen.SuggestionMenu.Item, { key: item, index }, item),
			);

			return h(
				Pen.Editor.Root,
				{ editor },
				h(Pen.Editor.Content),
				h(
					Pen.SuggestionMenu.Root,
					{ controller: menu },
					h(
						Pen.SuggestionMenu.Content,
						null,
						h(Pen.SuggestionMenu.List, null, menuItems),
					),
				),
			);
		}

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(h(Harness));
		});

		const fieldEditor = getFieldEditor(editor);
		await act(async () => {
			fieldEditor.activate(blockId);
			await flushAnimationFrames(2);
		});

		const field = requireElement(
			container.querySelector<HTMLElement>(
				"[data-pen-field-editor-active-surface]",
			),
			"active field",
		);
		await act(async () => {
			focusField(field);
		});
		expect(document.activeElement).toBe(field);

		await act(async () => {
			editor.apply([
				{
					type: "splice-text",
					blockId,
					from: 0,
					to: 0,
					insert: "Hi @al",
				},
			]);
			editor.selectText(blockId, 6, 6);
			await waitForCondition(
				() =>
					container.querySelector(
						"[data-pen-suggestion-menu-content]",
					) !== null,
			);
		});

		const popup = container.querySelector("[data-pen-suggestion-menu]");
		const list = requireElement(
			container.querySelector<HTMLElement>(
				"[data-pen-suggestion-menu-list]",
			),
			"suggestion listbox",
		);
		const options = container.querySelectorAll(
			"[data-pen-suggestion-menu-item]",
		);
		const selected = requireElement(
			container.querySelector<HTMLElement>(
				"[data-pen-suggestion-menu-item][data-selected]",
			),
			"selected option",
		);

		expect(popup?.getAttribute("role")).not.toBe("dialog");
		expect(list.getAttribute("role")).toBe("listbox");
		expect(list.id.length).toBeGreaterThan(0);
		expect(options).toHaveLength(3);
		for (const option of options) {
			expect(option.getAttribute("role")).toBe("option");
			expect(option.id.length).toBeGreaterThan(0);
		}
		expect(field.getAttribute("aria-controls")).toBe(list.id);
		expect(field.getAttribute("aria-expanded")).toBe("true");
		expect(field.getAttribute("aria-activedescendant")).toBe(selected.id);
		expect(list.getAttribute("aria-activedescendant")).toBe(selected.id);
		expect(document.activeElement).toBe(field);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("AX3 moves the active option with arrows Home and End while the field keeps focus", async () => {
		const editor = createSuggestionMenuEditor();
		const blockId = editor.firstBlock()!.id;

		function Harness() {
			const menu = useSuggestionMenu<string>({
				editor,
				trigger: {
					char: "@",
					boundary: "whitespace",
					minQueryLength: 1,
				},
				getItems: () => ["Alex", "Alice", "Amy"],
				onSelect: vi.fn(),
			});
			const menuItems = menu.items.map((item, index) =>
				h(Pen.SuggestionMenu.Item, { key: item, index }, item),
			);

			return h(
				Pen.Editor.Root,
				{ editor },
				h(Pen.Editor.Content),
				h(
					Pen.SuggestionMenu.Root,
					{ controller: menu },
					h(
						Pen.SuggestionMenu.Content,
						null,
						h(Pen.SuggestionMenu.List, null, menuItems),
					),
				),
			);
		}

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(h(Harness));
		});

		const fieldEditor = getFieldEditor(editor);
		await act(async () => {
			fieldEditor.activate(blockId);
			await flushAnimationFrames(2);
		});

		const field = requireElement(
			container.querySelector<HTMLElement>(
				"[data-pen-field-editor-active-surface]",
			),
			"active field",
		);
		await act(async () => {
			focusField(field);
		});

		await act(async () => {
			editor.apply([
				{
					type: "splice-text",
					blockId,
					from: 0,
					to: 0,
					insert: "Hi @a",
				},
			]);
			editor.selectText(blockId, 5, 5);
			await waitForCondition(
				() =>
					container.querySelectorAll(
						"[data-pen-suggestion-menu-item]",
					).length === 3,
			);
		});

		const list = requireElement(
			container.querySelector<HTMLElement>(
				"[data-pen-suggestion-menu-list]",
			),
			"suggestion listbox",
		);

		await act(async () => {
			dispatchKey("End", field);
		});

		const lastOption = requireElement(
			container.querySelector<HTMLElement>(
				"[data-pen-suggestion-menu-item][data-selected]",
			),
			"last option",
		);
		expect(lastOption.textContent).toBe("Amy");
		expect(field.getAttribute("aria-activedescendant")).toBe(lastOption.id);
		expect(list.getAttribute("aria-activedescendant")).toBe(lastOption.id);
		expect(document.activeElement).toBe(field);

		await act(async () => {
			dispatchKey("Home", field);
		});

		const firstOption = requireElement(
			container.querySelector<HTMLElement>(
				"[data-pen-suggestion-menu-item][data-selected]",
			),
			"first option",
		);
		expect(firstOption.textContent).toBe("Alex");
		expect(field.getAttribute("aria-activedescendant")).toBe(
			firstOption.id,
		);
		expect(document.activeElement).toBe(field);

		await act(async () => {
			dispatchKey("ArrowDown", field);
		});

		const nextOption = requireElement(
			container.querySelector<HTMLElement>(
				"[data-pen-suggestion-menu-item][data-selected]",
			),
			"next option",
		);
		expect(nextOption.textContent).toBe("Alice");
		expect(field.getAttribute("aria-activedescendant")).toBe(nextOption.id);
		expect(document.activeElement).toBe(field);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("AX3 does not steal field focus on option pointer down and clears field aria on Escape", async () => {
		const editor = createSuggestionMenuEditor();
		const blockId = editor.firstBlock()!.id;

		function Harness() {
			const menu = useSuggestionMenu<string>({
				editor,
				trigger: {
					char: "@",
					boundary: "whitespace",
					minQueryLength: 1,
				},
				getItems: () => ["Alex", "Alice"],
				onSelect: vi.fn(),
			});
			const menuItems = menu.items.map((item, index) =>
				h(Pen.SuggestionMenu.Item, { key: item, index }, item),
			);

			return h(
				Pen.Editor.Root,
				{ editor },
				h(Pen.Editor.Content),
				h(
					Pen.SuggestionMenu.Root,
					{ controller: menu },
					h(
						Pen.SuggestionMenu.Content,
						null,
						h(Pen.SuggestionMenu.List, null, menuItems),
					),
				),
			);
		}

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(h(Harness));
		});

		const fieldEditor = getFieldEditor(editor);
		await act(async () => {
			fieldEditor.activate(blockId);
			await flushAnimationFrames(2);
		});

		const field = requireElement(
			container.querySelector<HTMLElement>(
				"[data-pen-field-editor-active-surface]",
			),
			"active field",
		);
		await act(async () => {
			focusField(field);
		});

		await act(async () => {
			editor.apply([
				{
					type: "splice-text",
					blockId,
					from: 0,
					to: 0,
					insert: "Hi @a",
				},
			]);
			editor.selectText(blockId, 5, 5);
			await waitForCondition(
				() =>
					container.querySelector(
						"[data-pen-suggestion-menu-item]",
					) !== null,
			);
		});

		const option = requireElement(
			container.querySelector<HTMLElement>(
				"[data-pen-suggestion-menu-item]",
			),
			"suggestion option",
		);

		await act(async () => {
			option.dispatchEvent(
				new MouseEvent("mousedown", {
					bubbles: true,
					cancelable: true,
				}),
			);
		});

		expect(document.activeElement).toBe(field);
		expect(field.getAttribute("aria-expanded")).toBe("true");

		await act(async () => {
			dispatchKey("Escape", field);
			await waitForCondition(
				() =>
					container.querySelector(
						"[data-pen-suggestion-menu-content]",
					) === null,
			);
		});

		expect(
			container.querySelector("[data-pen-suggestion-menu-content]"),
		).toBeNull();
		expect(field.hasAttribute("aria-controls")).toBe(false);
		expect(field.hasAttribute("aria-expanded")).toBe(false);
		expect(field.hasAttribute("aria-activedescendant")).toBe(false);
		expect(
			document.activeElement?.closest("[data-pen-suggestion-menu]"),
		).toBeNull();

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});
});
