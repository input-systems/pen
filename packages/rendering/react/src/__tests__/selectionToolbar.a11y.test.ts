// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createEditor, fieldEditorHostFacet } from "@input/pen-core";
import type { FieldEditorImpl } from "@input/pen-dom/field-editor/fieldEditorImpl";
import { toggleInlineMark } from "@input/pen-dom/field-editor/commands";
import { defaultPreset } from "@input/pen";
import { Pen } from "../primitives/index";
import { defaultSchema } from "@input/pen-schema";
import { mockSelectionToolbarRect } from "./utils/selectionToolbarRectMock";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function createTestEditor() {
	return createEditor({
		schema: defaultSchema,
		preset: defaultPreset({
			tools: false,
			deltaStream: false,
			undo: false,
		}),
	});
}

async function renderSelectionToolbar(
	controls: (
		editor: ReturnType<typeof createTestEditor>,
		blockId: string,
	) => ReturnType<typeof createElement> = () =>
		createElement("button", { type: "button" }, "Bold"),
) {
	const restoreSelectionRect = mockSelectionToolbarRect({
		top: 120,
		left: 160,
		width: 120,
		height: 18,
	});
	const editor = createTestEditor();
	const blockId = editor.firstBlock()!.id;
	editor.apply(
		[
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "Hello world",
			},
		],
		{ origin: "user" },
	);
	editor.selectTextRange({ blockId, offset: 0 }, { blockId, offset: 5 });

	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);

	await act(async () => {
		root.render(
			createElement(
				Pen.Editor.Root,
				{ editor },
				// The toolbar measures the selection in the rendered content.
				createElement(Pen.Editor.Content),
				createElement(
					Pen.SelectionToolbar.Root,
					null,
					createElement(
						Pen.SelectionToolbar.Content,
						null,
						controls(editor, blockId),
					),
				),
			),
		);
		for (let tick = 0; tick < 4; tick += 1) {
			await Promise.resolve();
		}
	});

	const fixture = { container, editor, restoreSelectionRect, root, blockId };
	fixtures.push(fixture);
	return fixture;
}

/** Focuses the block's field over the selected range; returns the field element. */
async function focusField(
	fixture: Awaited<ReturnType<typeof renderSelectionToolbar>>,
): Promise<HTMLElement> {
	const fieldEditor = fixture.editor.facet(
		fieldEditorHostFacet,
	) as FieldEditorImpl;
	await act(async () => {
		await fieldEditor.focusTextSelection(fixture.blockId, 0, 5, {
			reason: "keyboard",
		});
	});
	const field = fixture.container.querySelector<HTMLElement>(
		`[data-pen-editor-block][data-block-id="${fixture.blockId}"] [data-pen-inline-content]`,
	);
	expect(field).not.toBeNull();
	expect(document.activeElement).toBe(field);
	return field!;
}

function toolbarContent(container: HTMLElement): HTMLElement | null {
	return container.querySelector<HTMLElement>(
		"[data-pen-selection-toolbar-content]",
	);
}

const fixtures: Array<{
	container: HTMLElement;
	editor: ReturnType<typeof createTestEditor>;
	restoreSelectionRect: () => void;
	root: ReturnType<typeof createRoot>;
	blockId: string;
}> = [];

afterEach(async () => {
	while (fixtures.length > 0) {
		const fixture = fixtures.pop();
		if (!fixture) {
			break;
		}
		await act(async () => {
			fixture.root.unmount();
		});
		fixture.container.remove();
		fixture.restoreSelectionRect();
		fixture.editor.destroy();
	}
});

describe("selection toolbar AX3", () => {
	it("AX3: detached surface uses role toolbar or menu", async () => {
		const fixture = await renderSelectionToolbar();

		const toolbar = fixture.container.querySelector(
			"[data-pen-selection-toolbar-content]",
		);
		expect(toolbar).not.toBeNull();
		expect(["toolbar", "menu"]).toContain(toolbar?.getAttribute("role"));
	});

	it("AX3: opening the toolbar does not steal editor focus", async () => {
		const fixture = await renderSelectionToolbar();
		const field = await focusField(fixture);

		const toolbar = toolbarContent(fixture.container);
		expect(toolbar).not.toBeNull();
		expect(document.activeElement).toBe(field);
	});

	it("AX3: pointerdown does not steal editor focus", async () => {
		const fixture = await renderSelectionToolbar();
		const field = await focusField(fixture);

		const toolbar = toolbarContent(fixture.container)!;
		const event = new Event("pointerdown", {
			bubbles: true,
			cancelable: true,
		});
		await act(async () => {
			toolbar.dispatchEvent(event);
		});

		expect(event.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(field);
	});

	it("AX3: Escape closes and returns focus to the field", async () => {
		const fixture = await renderSelectionToolbar();
		const field = await focusField(fixture);
		const button = toolbarContent(fixture.container)!.querySelector(
			"button",
		) as HTMLButtonElement;
		await act(async () => {
			button.focus();
		});
		expect(document.activeElement).toBe(button);

		const event = new KeyboardEvent("keydown", {
			key: "Escape",
			bubbles: true,
			cancelable: true,
		});
		await act(async () => {
			button.dispatchEvent(event);
		});

		expect(event.defaultPrevented).toBe(true);
		expect(toolbarContent(fixture.container)).toBeNull();
		expect(document.activeElement).toBe(field);
	});

	it("AX3: keyboard activation in the selection toolbar keeps focus on the activated control", async () => {
		const fixture = await renderSelectionToolbar((editor) =>
			createElement(
				"button",
				{
					type: "button",
					"data-testid": "bold",
					onClick: () => toggleInlineMark(editor, "bold"),
				},
				"Bold",
			),
		);
		await focusField(fixture);
		const button = toolbarContent(fixture.container)!.querySelector(
			"button",
		) as HTMLButtonElement;
		await act(async () => {
			button.focus();
		});

		// Keyboard activation: a click with no press before it.
		await act(async () => {
			button.click();
		});

		expect(toolbarContent(fixture.container)).not.toBeNull();
		expect(document.activeElement).toBe(button);
	});

	it("AX3: a selection toolbar action that unmounts the toolbar returns focus to the field", async () => {
		const fixture = await renderSelectionToolbar((editor, blockId) =>
			createElement(
				"button",
				{
					type: "button",
					onClick: () => editor.selectText(blockId, 5, 5),
				},
				"Collapse",
			),
		);
		const field = await focusField(fixture);
		const button = toolbarContent(fixture.container)!.querySelector(
			"button",
		) as HTMLButtonElement;
		await act(async () => {
			button.focus();
		});
		expect(document.activeElement).toBe(button);

		await act(async () => {
			button.click();
		});

		expect(toolbarContent(fixture.container)).toBeNull();
		expect(document.activeElement).toBe(field);
	});
});
