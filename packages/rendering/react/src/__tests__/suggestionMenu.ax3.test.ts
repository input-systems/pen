// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { createEditor } from "@input/pen-core";
import { defaultPreset } from "@input/pen";
import { Pen } from "../primitives/index";
import { defaultSchema } from "@input/pen-schema";
import { dispatchKey } from "./utils/suggestionMenuTestHelpers";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function createSuggestionMenuEditor(
	options: Parameters<typeof createEditor>[0] = {},
) {
	return createEditor({
		schema: defaultSchema,
		...options,
		preset: defaultPreset({
			tools: false,
			deltaStream: false,
			undo: false,
		}),
	});
}

function createOpenController() {
	return {
		confirm: vi.fn(() => true),
		dismiss: vi.fn(),
		error: null,
		items: ["Alex", "Alice", "Avery"],
		open: true,
		query: "",
		refresh: vi.fn(),
		select: vi.fn(),
		selectedIndex: 1,
		status: "ready" as const,
		target: null,
	};
}

function renderSuggestionMenu(
	editor: ReturnType<typeof createSuggestionMenuEditor>,
	controller: ReturnType<typeof createOpenController>,
) {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	const tree = createElement(
		Pen.Editor.Root,
		{ editor },
		createElement(
			"div",
			{ "data-pen-field-editor-active-surface": "", tabIndex: 0 },
			"field",
		),
		createElement(
			Pen.SuggestionMenu.Root,
			{ controller, editor },
			createElement(
				Pen.SuggestionMenu.List,
				null,
				createElement(Pen.SuggestionMenu.Item, { index: 0 }, "Alex"),
				createElement(Pen.SuggestionMenu.Item, { index: 1 }, "Alice"),
				createElement(Pen.SuggestionMenu.Item, { index: 2 }, "Avery"),
			),
		),
	);
	return { container, root, tree };
}

describe("@input/pen-react suggestion menu AX3", () => {
	it("AX3 exposes listbox option ids and field popup aria without moving focus", async () => {
		const editor = createSuggestionMenuEditor();
		const blockId = editor.firstBlock()!.id;
		editor.selectText(blockId, 0, 0);
		const controller = createOpenController();
		const { container, root, tree } = renderSuggestionMenu(
			editor,
			controller,
		);

		await act(async () => {
			root.render(tree);
		});

		const listbox = container.querySelector<HTMLElement>(
			"[data-pen-suggestion-menu-list]",
		);
		const options = container.querySelectorAll<HTMLElement>(
			"[data-pen-suggestion-menu-item]",
		);
		const field = container.querySelector<HTMLElement>(
			"[data-pen-field-editor-active-surface]",
		);

		expect(listbox?.getAttribute("role")).toBe("listbox");
		expect(listbox?.getAttribute("aria-label")).toBe("Suggestions");
		expect(listbox?.hasAttribute("hidden")).toBe(false);
		expect(listbox?.id).toBeTruthy();
		expect(options).toHaveLength(3);
		expect(options[0]?.getAttribute("role")).toBe("option");
		expect(options[1]?.getAttribute("role")).toBe("option");
		expect(options[1]?.id).toBe(`${listbox?.id}-option-1`);
		expect(options[1]?.getAttribute("aria-selected")).toBe("true");

		expect(field).not.toBeNull();
		expect(field?.getAttribute("aria-controls")).toBe(listbox?.id);
		expect(field?.getAttribute("aria-expanded")).toBe("true");
		expect(field?.getAttribute("aria-activedescendant")).toBe(
			options[1]?.id,
		);

		await act(async () => {
			field?.focus();
		});
		expect(document.activeElement).toBe(field);

		await act(async () => {
			dispatchKey("ArrowDown", field ?? document);
		});

		expect(document.activeElement).toBe(field);
		expect(
			document.activeElement?.closest("[data-pen-suggestion-menu-item]"),
		).toBeNull();
		expect(
			document.activeElement?.closest("[data-pen-suggestion-menu-list]"),
		).toBeNull();
		expect(controller.select).toHaveBeenCalledWith(2);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("AX3 Home End Arrow Enter Escape navigate the existing selectedIndex model", async () => {
		const editor = createSuggestionMenuEditor();
		const blockId = editor.firstBlock()!.id;
		editor.selectText(blockId, 0, 0);
		const controller = createOpenController();
		const { container, root, tree } = renderSuggestionMenu(
			editor,
			controller,
		);

		await act(async () => {
			root.render(tree);
		});

		const listbox = container.querySelector<HTMLElement>(
			"[data-pen-suggestion-menu-list]",
		);
		const selectedOption = container.querySelector<HTMLElement>(
			"[data-pen-suggestion-menu-item][data-selected]",
		);
		const field = container.querySelector<HTMLElement>(
			"[data-pen-field-editor-active-surface]",
		);

		expect(listbox?.getAttribute("role")).toBe("listbox");
		expect(field?.getAttribute("aria-controls")).toBe(listbox?.id);
		expect(field?.getAttribute("aria-expanded")).toBe("true");
		expect(field?.getAttribute("aria-activedescendant")).toBe(
			selectedOption?.id,
		);

		await act(async () => {
			dispatchKey("Home");
			dispatchKey("End");
			dispatchKey("ArrowUp");
			dispatchKey("Enter");
			dispatchKey("Escape");
		});

		expect(controller.select).toHaveBeenCalledWith(0);
		expect(controller.select).toHaveBeenCalledWith(2);
		expect(controller.select).toHaveBeenCalledWith(1);
		expect(controller.confirm).toHaveBeenCalledWith(1);
		expect(controller.dismiss).toHaveBeenCalled();

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});
});
