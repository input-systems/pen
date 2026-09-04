// @vitest-environment jsdom

import { act, createElement, type MouseEvent } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor } from "@input/pen-core";
import { defaultPreset } from "@input/pen";
import { Pen } from "../primitives/index";
import { defaultSchema } from "@input/pen-schema";

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

async function renderToolbar(items: React.ReactElement[]) {
	const editor = createTestEditor();
	const blockId = editor.firstBlock()!.id;
	editor.apply(
		[{ type: "splice-text", blockId, from: 0, to: 0, insert: "Hello" }],
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
				createElement(Pen.Toolbar.Root, null, ...items),
			),
		);
	});

	const fixture = { container, editor, root };
	fixtures.push(fixture);
	return fixture;
}

async function click(element: HTMLElement) {
	await act(async () => {
		element.dispatchEvent(
			new MouseEvent("click", { bubbles: true, cancelable: true }),
		);
	});
}

const fixtures: Array<{
	container: HTMLElement;
	editor: ReturnType<typeof createTestEditor>;
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
		fixture.editor.destroy();
	}
});

describe("@input/pen-react toolbar composed click", () => {
	it("Toolbar.Button runs a host onClick and then onAction", async () => {
		const calls: string[] = [];
		const fixture = await renderToolbar([
			createElement(
				Pen.Toolbar.Button,
				{
					key: "bold",
					onAction: () => calls.push("action"),
					onClick: () => calls.push("click"),
				},
				"Bold",
			),
		]);

		await click(
			fixture.container.querySelector<HTMLElement>(
				"[data-pen-toolbar-button]",
			)!,
		);

		expect(calls).toEqual(["click", "action"]);
	});

	it("Toolbar.Button skips onAction when disabled or when onClick prevents default", async () => {
		const disabledAction = vi.fn();
		const preventedAction = vi.fn();
		const fixture = await renderToolbar([
			createElement(
				Pen.Toolbar.Button,
				{ key: "disabled", disabled: true, onAction: disabledAction },
				"Strike",
			),
			createElement(
				Pen.Toolbar.Button,
				{
					key: "prevented",
					onAction: preventedAction,
					onClick: (event: MouseEvent<HTMLElement>) =>
						event.preventDefault(),
				},
				"Link",
			),
		]);

		const [disabled, prevented] = Array.from(
			fixture.container.querySelectorAll<HTMLElement>(
				"[data-pen-toolbar-button]",
			),
		);
		await click(disabled!);
		await click(prevented!);

		expect(disabledAction).not.toHaveBeenCalled();
		expect(preventedAction).not.toHaveBeenCalled();
	});

	it("Toolbar.Toggle runs a host onClick and still toggles the mark", async () => {
		const onClick = vi.fn();
		const fixture = await renderToolbar([
			createElement(
				Pen.Toolbar.Toggle,
				{ key: "italic", format: "italic", onClick },
				"Italic",
			),
		]);

		const toggle = fixture.container.querySelector<HTMLElement>(
			"[data-pen-toolbar-toggle]",
		)!;
		expect(toggle.getAttribute("aria-pressed")).toBe("false");

		await click(toggle);

		expect(onClick).toHaveBeenCalledTimes(1);
		expect(toggle.getAttribute("aria-pressed")).toBe("true");
	});
});
