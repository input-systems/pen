// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { fieldEditorHostFacet } from "@input/pen-core";
import type { FieldEditorImpl } from "@input/pen-dom/field-editor/fieldEditorImpl";
import { Pen } from "../primitives/index";
import { createTestEditor, dispatchKey } from "./utils/toolbarTestHelpers";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function toolbarItems(container: HTMLElement): HTMLElement[] {
	return Array.from(
		container.querySelectorAll<HTMLElement>(
			"[data-pen-toolbar-button], [data-pen-toolbar-toggle], [data-pen-toolbar-select]",
		),
	);
}

async function renderToolbar(options: { content?: boolean } = {}) {
	const editor = createTestEditor();
	const blockId = editor.firstBlock()!.id;
	if (options.content) {
		editor.apply([
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "Hello" },
		]);
	}
	editor.selectText(blockId, 0, 0);

	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);

	await act(async () => {
		root.render(
			createElement(
				Pen.Editor.Root,
				{ editor },
				options.content ? createElement(Pen.Editor.Content) : null,
				createElement(
					Pen.Toolbar.Root,
					null,
					createElement(Pen.Toolbar.Button, null, "Bold"),
					createElement(
						Pen.Toolbar.Toggle,
						{ format: "italic" },
						"Italic",
					),
					createElement(
						Pen.Toolbar.Button,
						{ disabled: true },
						"Strike",
					),
					createElement(Pen.Toolbar.Button, null, "Link"),
				),
			),
		);
	});

	const fixture = { container, editor, root, blockId };
	fixtures.push(fixture);
	return fixture;
}

/** Puts the caret in the block's field; returns the focused field element. */
async function focusField(
	fixture: Awaited<ReturnType<typeof renderToolbar>>,
): Promise<HTMLElement> {
	const fieldEditor = fixture.editor.facet(
		fieldEditorHostFacet,
	) as FieldEditorImpl;
	await act(async () => {
		await fieldEditor.focusTextSelection(fixture.blockId, 2, 2, {
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

function dispatchPress(target: HTMLElement): {
	pointerdown: MouseEvent;
	mousedown: MouseEvent;
} {
	const pointerdown = new MouseEvent("pointerdown", {
		bubbles: true,
		cancelable: true,
		button: 0,
	});
	const mousedown = new MouseEvent("mousedown", {
		bubbles: true,
		cancelable: true,
		button: 0,
	});
	target.dispatchEvent(pointerdown);
	target.dispatchEvent(mousedown);
	return { pointerdown, mousedown };
}

const fixtures: Array<{
	container: HTMLElement;
	editor: ReturnType<typeof createTestEditor>;
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
		fixture.editor.destroy();
	}
});

describe("@input/pen-react toolbar AX3", () => {
	it("AX3: detached surface uses role=toolbar and roving tabindex without stealing focus", async () => {
		const editorSurface = document.createElement("textarea");
		document.body.appendChild(editorSurface);
		editorSurface.focus();
		expect(document.activeElement).toBe(editorSurface);

		const fixture = await renderToolbar();
		const toolbar = fixture.container.querySelector("[data-pen-toolbar]");
		const items = toolbarItems(fixture.container);
		const enabled = items.filter(
			(item) => item.getAttribute("aria-disabled") !== "true",
		);
		const disabled = items.filter(
			(item) => item.getAttribute("aria-disabled") === "true",
		);

		expect(toolbar?.getAttribute("role")).toBe("toolbar");
		expect(toolbar?.getAttribute("aria-orientation")).toBe("horizontal");
		expect(enabled.length).toBe(3);
		expect(disabled.length).toBe(1);
		expect(enabled[0]?.tabIndex).toBe(0);
		expect(
			enabled.every(
				(item, index) => item.tabIndex === (index === 0 ? 0 : -1),
			),
		).toBe(true);
		expect(disabled[0]?.tabIndex).toBe(-1);
		expect(document.activeElement).toBe(editorSurface);

		editorSurface.remove();
	});

	it("AX3: arrow keys move roving tabindex within the toolbar", async () => {
		const fixture = await renderToolbar();
		const items = toolbarItems(fixture.container);
		const enabled = items.filter(
			(item) => item.getAttribute("aria-disabled") !== "true",
		);
		expect(enabled).toHaveLength(3);

		await act(async () => {
			enabled[0]?.focus();
		});
		expect(document.activeElement).toBe(enabled[0]);

		await act(async () => {
			dispatchKey(enabled[0]!, "ArrowRight");
		});
		expect(document.activeElement).toBe(enabled[1]);
		expect(enabled[0]?.tabIndex).toBe(-1);
		expect(enabled[1]?.tabIndex).toBe(0);

		await act(async () => {
			dispatchKey(enabled[1]!, "ArrowRight");
		});
		expect(document.activeElement).toBe(enabled[2]);
		expect(enabled[2]?.tabIndex).toBe(0);

		await act(async () => {
			dispatchKey(enabled[2]!, "ArrowLeft");
		});
		expect(document.activeElement).toBe(enabled[1]);

		await act(async () => {
			dispatchKey(enabled[1]!, "End");
		});
		expect(document.activeElement).toBe(enabled[2]);
		expect(enabled[2]?.tabIndex).toBe(0);

		await act(async () => {
			dispatchKey(enabled[2]!, "Home");
		});
		expect(document.activeElement).toBe(enabled[0]);
		expect(enabled[0]?.tabIndex).toBe(0);
	});

	it("AX3: a pointer click on a toolbar button leaves focus in the field", async () => {
		const fixture = await renderToolbar({ content: true });
		const field = await focusField(fixture);
		const [button, toggle] = toolbarItems(fixture.container);

		for (const control of [button!, toggle!]) {
			let press!: ReturnType<typeof dispatchPress>;
			await act(async () => {
				press = dispatchPress(control);
				control.click();
			});
			expect(press.pointerdown.defaultPrevented).toBe(true);
			expect(press.mousedown.defaultPrevented).toBe(true);
			expect(document.activeElement).toBe(field);
		}
	});

	it("AX3: a host pointer handler composes with the toolbar press guard", async () => {
		const editor = createTestEditor();
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);
		const seen: string[] = [];
		fixtures.push({ container, editor, root, blockId: "" });

		await act(async () => {
			root.render(
				createElement(
					Pen.Editor.Root,
					{ editor },
					createElement(
						Pen.Toolbar.Root,
						null,
						createElement(
							Pen.Toolbar.Button,
							{
								onPointerDown: () => seen.push("pointerdown"),
								onMouseDown: () => seen.push("mousedown"),
							},
							"Bold",
						),
					),
				),
			);
		});

		const button = toolbarItems(container)[0]!;
		const secondary = new MouseEvent("mousedown", {
			bubbles: true,
			cancelable: true,
			button: 2,
		});
		let press!: ReturnType<typeof dispatchPress>;
		await act(async () => {
			press = dispatchPress(button);
			button.dispatchEvent(secondary);
		});

		expect(seen).toEqual(["pointerdown", "mousedown", "mousedown"]);
		expect(press.pointerdown.defaultPrevented).toBe(true);
		expect(press.mousedown.defaultPrevented).toBe(true);
		expect(secondary.defaultPrevented).toBe(false);
	});

	it("AX3: keyboard activation keeps focus on the toolbar control", async () => {
		const fixture = await renderToolbar({ content: true });
		await focusField(fixture);
		const toggle = toolbarItems(fixture.container)[1]!;

		await act(async () => {
			toggle.focus();
		});
		expect(document.activeElement).toBe(toggle);

		// Enter or Space on a focused button synthesizes a click with no press.
		await act(async () => {
			toggle.click();
		});

		expect(document.activeElement).toBe(toggle);
	});

	it("AX3: Escape returns focus to the field", async () => {
		const fixture = await renderToolbar({ content: true });
		const field = await focusField(fixture);
		const first = toolbarItems(fixture.container)[0]!;

		await act(async () => {
			first.focus();
		});
		expect(document.activeElement).toBe(first);

		let event!: KeyboardEvent;
		await act(async () => {
			event = dispatchKey(first, "Escape");
		});

		expect(event.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(field);
	});

	it("AX3: Escape without an active field returns focus to the editor root", async () => {
		const fixture = await renderToolbar();
		const editorRoot = fixture.container.querySelector(
			"[data-pen-editor-root]",
		) as HTMLElement;
		const first = toolbarItems(fixture.container)[0]!;

		await act(async () => {
			first.focus();
		});
		expect(document.activeElement).toBe(first);

		let event!: KeyboardEvent;
		await act(async () => {
			event = dispatchKey(first, "Escape");
		});

		expect(event.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(editorRoot);
	});
});
