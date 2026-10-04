// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Pen } from "../primitives/index";
import {
	createTestEditor,
	dispatchKey,
	fixtures,
} from "./utils/toolbarTestHelpers";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function toolbarItems(container: HTMLElement): HTMLElement[] {
	return Array.from(
		container.querySelectorAll<HTMLElement>(
			"[data-pen-toolbar-button], [data-pen-toolbar-toggle]",
		),
	);
}

async function renderToolbar() {
	const editor = createTestEditor();
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);

	await act(async () => {
		root.render(
			createElement(
				Pen.Editor.Root,
				{ editor },
				createElement(
					Pen.Toolbar.Root,
					null,
					createElement(Pen.Toolbar.Button, null, "Bold"),
					createElement(
						Pen.Toolbar.Toggle,
						{ format: "italic" },
						"Italic",
					),
					createElement(Pen.Toolbar.Button, null, "Link"),
				),
			),
		);
	});

	const fixture = { container, editor, root };
	fixtures.push(fixture);
	return fixture;
}

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

describe("toolbar AX3", () => {
	it("AX3: detached surface uses role toolbar", async () => {
		const fixture = await renderToolbar();

		const toolbar = fixture.container.querySelector("[data-pen-toolbar]");
		expect(toolbar).not.toBeNull();
		expect(toolbar?.getAttribute("role")).toBe("toolbar");
	});

	it("AX3: roving tabindex keeps a single tab stop", async () => {
		const fixture = await renderToolbar();
		const items = toolbarItems(fixture.container);

		expect(items).toHaveLength(3);
		expect(items.filter((item) => item.tabIndex === 0)).toHaveLength(1);
		expect(items.filter((item) => item.tabIndex === -1)).toHaveLength(2);
		expect(items[0]?.tabIndex).toBe(0);
	});

	it("AX3: ArrowRight and ArrowLeft move focus between items", async () => {
		const fixture = await renderToolbar();
		const items = toolbarItems(fixture.container);
		const first = items[0]!;
		const second = items[1]!;
		const third = items[2]!;

		await act(async () => {
			first.focus();
		});
		expect(document.activeElement).toBe(first);

		await act(async () => {
			dispatchKey(first, "ArrowRight");
		});
		expect(document.activeElement).toBe(second);
		expect(second.tabIndex).toBe(0);
		expect(first.tabIndex).toBe(-1);

		await act(async () => {
			dispatchKey(second, "ArrowRight");
		});
		expect(document.activeElement).toBe(third);

		await act(async () => {
			dispatchKey(third, "ArrowLeft");
		});
		expect(document.activeElement).toBe(second);
	});

	it("AX3: Home and End move focus to the ends", async () => {
		const fixture = await renderToolbar();
		const items = toolbarItems(fixture.container);
		const first = items[0]!;
		const last = items[2]!;

		await act(async () => {
			first.focus();
		});

		await act(async () => {
			dispatchKey(first, "End");
		});
		expect(document.activeElement).toBe(last);
		expect(last.tabIndex).toBe(0);

		await act(async () => {
			dispatchKey(last, "Home");
		});
		expect(document.activeElement).toBe(first);
		expect(first.tabIndex).toBe(0);
	});

	it("AX3: Escape restores focus to the editor", async () => {
		const fixture = await renderToolbar();

		const editorRoot = fixture.container.querySelector(
			"[data-pen-editor-root]",
		) as HTMLElement;
		const items = toolbarItems(fixture.container);
		const button = items[0]!;

		await act(async () => {
			editorRoot.focus();
		});
		expect(document.activeElement).toBe(editorRoot);

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
		expect(document.activeElement).toBe(editorRoot);
		expect(
			fixture.container.querySelector("[data-pen-toolbar]"),
		).not.toBeNull();
	});
});
