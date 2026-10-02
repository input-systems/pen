// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
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

async function renderSelectionToolbar() {
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
						createElement("button", { type: "button" }, "Bold"),
					),
				),
			),
		);
		for (let tick = 0; tick < 4; tick += 1) {
			await Promise.resolve();
		}
	});

	const fixture = { container, editor, restoreSelectionRect, root };
	fixtures.push(fixture);
	return fixture;
}

const fixtures: Array<{
	container: HTMLElement;
	editor: ReturnType<typeof createTestEditor>;
	restoreSelectionRect: () => void;
	root: ReturnType<typeof createRoot>;
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

		const editorRoot = fixture.container.querySelector(
			"[data-pen-editor-root]",
		) as HTMLElement | null;
		expect(editorRoot).not.toBeNull();
		await act(async () => {
			editorRoot?.focus();
		});
		// The editor may hand root focus to its active field; either is the editor's.
		const editorFocus = document.activeElement;
		expect(editorRoot?.contains(editorFocus)).toBe(true);

		const toolbar = fixture.container.querySelector(
			"[data-pen-selection-toolbar-content]",
		);
		expect(toolbar).not.toBeNull();
		expect(document.activeElement).toBe(editorFocus);
		expect(document.activeElement).not.toBe(toolbar);
	});

	it("AX3: pointerdown does not steal editor focus", async () => {
		const fixture = await renderSelectionToolbar();

		const editorRoot = fixture.container.querySelector(
			"[data-pen-editor-root]",
		) as HTMLElement;
		await act(async () => {
			editorRoot.focus();
		});
		const editorFocus = document.activeElement;
		expect(editorRoot.contains(editorFocus)).toBe(true);

		const toolbar = fixture.container.querySelector(
			"[data-pen-selection-toolbar-content]",
		) as HTMLElement;
		const event = new Event("pointerdown", {
			bubbles: true,
			cancelable: true,
		});
		await act(async () => {
			toolbar.dispatchEvent(event);
		});

		expect(event.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(editorFocus);
	});

	it("AX3: Escape closes and restores editor focus", async () => {
		const fixture = await renderSelectionToolbar();

		const editorRoot = fixture.container.querySelector(
			"[data-pen-editor-root]",
		) as HTMLElement;
		const toolbar = fixture.container.querySelector(
			"[data-pen-selection-toolbar-content]",
		) as HTMLElement;
		const button = toolbar.querySelector("button") as HTMLButtonElement;
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
		expect(
			fixture.container.querySelector(
				"[data-pen-selection-toolbar-content]",
			),
		).toBeNull();
		expect(editorRoot.contains(document.activeElement)).toBe(true);
	});
});
