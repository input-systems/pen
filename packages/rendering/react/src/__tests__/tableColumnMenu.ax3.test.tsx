// @vitest-environment jsdom

import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { createEditor, createHeadlessEditor } from "@input/pen-core";
import type { Editor, TableColumnSchema } from "@input/pen-types";
import { defaultPreset } from "@input/pen";
import { defaultSchema } from "@input/pen-schema";
import { Pen } from "../primitives/index";
import { ColumnHeaderMenu } from "../renderers/tableColumnMenu";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const COLUMN: TableColumnSchema = {
	id: "col-1",
	title: "Name",
	type: "text",
};

const COLUMNS: TableColumnSchema[] = [
	COLUMN,
	{ id: "col-2", title: "Age", type: "number" },
];

const ANCHOR_RECT = {
	top: 0,
	left: 0,
	bottom: 24,
	right: 80,
	width: 80,
	height: 24,
};

function createAnchor(): HTMLButtonElement {
	const button = document.createElement("button");
	button.type = "button";
	button.textContent = "Name";
	document.body.appendChild(button);
	return button;
}

function dispatchKey(target: EventTarget, key: string): void {
	target.dispatchEvent(
		new KeyboardEvent("keydown", {
			key,
			bubbles: true,
			cancelable: true,
		}),
	);
}

async function renderMenu(options: {
	anchorEl: HTMLElement;
	onClose: () => void;
	colCount?: number;
}): Promise<{ container: HTMLDivElement; root: Root; editor: Editor }> {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	const editor = createHeadlessEditor({ schema: defaultSchema });

	await act(async () => {
		root.render(
			<ColumnHeaderMenu
				editor={editor}
				blockId="table-1"
				column={COLUMN}
				columnIndex={0}
				allColumns={COLUMNS}
				colCount={options.colCount ?? 2}
				anchorEl={options.anchorEl}
				anchorRect={ANCHOR_RECT}
				onClose={options.onClose}
			/>,
		);
	});

	return { container, root, editor };
}

async function cleanup(
	root: Root,
	container: HTMLElement,
	anchorEl: HTMLElement,
	editor: Editor,
): Promise<void> {
	await act(async () => {
		root.unmount();
	});
	container.remove();
	anchorEl.remove();
	editor.destroy();
}

/** The column header button and its menu inside an editor root, as the table renderer owns them. */
function HeaderWithMenu(props: {
	editor: Editor;
	onClose: () => void;
	colCount: number;
}) {
	const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
	const [open, setOpen] = useState(true);
	const close = () => {
		props.onClose();
		setOpen(false);
	};
	const menu =
		anchor && open ? (
			<ColumnHeaderMenu
				editor={props.editor}
				blockId="table-1"
				column={COLUMN}
				columnIndex={0}
				allColumns={COLUMNS}
				colCount={props.colCount}
				anchorEl={anchor}
				anchorRect={ANCHOR_RECT}
				onClose={close}
			/>
		) : null;

	return (
		<Pen.Editor.Root editor={props.editor}>
			<button type="button" ref={setAnchor} data-pen-column-header="">
				Name
			</button>
			{menu}
		</Pen.Editor.Root>
	);
}

async function renderInEditor(options: { colCount?: number } = {}) {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	const editor = createEditor({
		schema: defaultSchema,
		preset: defaultPreset({
			tools: false,
			deltaStream: false,
			undo: false,
		}),
	});
	const onClose = vi.fn();

	await act(async () => {
		root.render(
			<HeaderWithMenu
				editor={editor}
				onClose={onClose}
				colCount={options.colCount ?? 2}
			/>,
		);
	});

	const anchor = container.querySelector<HTMLElement>(
		"[data-pen-column-header]",
	)!;
	const editorRoot = container.querySelector<HTMLElement>(
		"[data-pen-editor-root]",
	)!;
	const menuItem = (label: string) =>
		Array.from(
			container.querySelectorAll<HTMLElement>('[role="menuitem"]'),
		).find((item) => item.textContent?.includes(label)) ?? null;

	return {
		container,
		anchor,
		editorRoot,
		menuItem,
		onClose,
		cleanup: async () => {
			await act(async () => {
				root.unmount();
			});
			container.remove();
			editor.destroy();
		},
	};
}

describe("@input/pen-react table column menu AX3", () => {
	it("AX3: uses role=menu and roving tabindex without stealing editor focus", async () => {
		const editorSurface = document.createElement("textarea");
		document.body.appendChild(editorSurface);
		editorSurface.focus();
		expect(document.activeElement).toBe(editorSurface);

		const anchorEl = createAnchor();
		const onClose = vi.fn();
		const { container, root, editor } = await renderMenu({
			anchorEl,
			onClose,
		});

		const menu = container.querySelector("[data-pen-column-menu]");
		const items = container.querySelectorAll<HTMLElement>(
			"[data-pen-column-menu-item]",
		);
		const menuitems = container.querySelectorAll('[role="menuitem"]');

		expect(menu?.getAttribute("role")).toBe("menu");
		expect(items.length).toBeGreaterThan(1);
		expect(menuitems.length).toBeGreaterThan(1);
		expect(items[0]?.tabIndex).toBe(0);
		expect(
			Array.from(items).every(
				(item, index) => item.tabIndex === (index === 0 ? 0 : -1),
			),
		).toBe(true);
		expect(document.activeElement).toBe(editorSurface);

		await cleanup(root, container, anchorEl, editor);
		editorSurface.remove();
	});

	it("AX3: arrow keys move roving tabindex within the column menu", async () => {
		const anchorEl = createAnchor();
		const onClose = vi.fn();
		const { container, root, editor } = await renderMenu({
			anchorEl,
			onClose,
		});

		const items = container.querySelectorAll<HTMLElement>(
			"[data-pen-column-menu-item]",
		);
		expect(items.length).toBeGreaterThan(2);

		await act(async () => {
			items[0]?.focus();
		});
		expect(document.activeElement).toBe(items[0]);

		await act(async () => {
			dispatchKey(items[0]!, "ArrowDown");
		});
		expect(document.activeElement).toBe(items[1]);
		expect(items[0]?.tabIndex).toBe(-1);
		expect(items[1]?.tabIndex).toBe(0);

		await act(async () => {
			dispatchKey(items[1]!, "ArrowUp");
		});
		expect(document.activeElement).toBe(items[0]);
		expect(items[0]?.tabIndex).toBe(0);
		expect(items[1]?.tabIndex).toBe(-1);

		await act(async () => {
			dispatchKey(items[0]!, "End");
		});
		expect(document.activeElement).toBe(items[items.length - 1]);
		expect(items[items.length - 1]?.tabIndex).toBe(0);

		await act(async () => {
			dispatchKey(items[items.length - 1]!, "Home");
		});
		expect(document.activeElement).toBe(items[0]);
		expect(items[0]?.tabIndex).toBe(0);

		await cleanup(root, container, anchorEl, editor);
	});

	it("AX3: Escape closes the column menu and returns focus to the column header button", async () => {
		const view = await renderInEditor();
		const items = view.container.querySelectorAll<HTMLElement>(
			"[data-pen-column-menu-item]",
		);
		await act(async () => {
			items[1]?.focus();
		});
		expect(document.activeElement).toBe(items[1]);

		await act(async () => {
			dispatchKey(items[1]!, "Escape");
		});

		expect(view.onClose).toHaveBeenCalledTimes(1);
		expect(
			view.container.querySelector("[data-pen-column-menu]"),
		).toBeNull();
		expect(document.activeElement).toBe(view.anchor);

		await view.cleanup();
	});

	it("AX3: every column menu action returns focus to the column header button, and delete returns it to the editor surface", async () => {
		const actions: Array<{
			label: string;
			activate: (
				view: Awaited<ReturnType<typeof renderInEditor>>,
			) => void;
			expected: "anchor" | "surface";
		}> = [
			{
				label: "type",
				activate: (view) => view.menuItem("Number")?.click(),
				expected: "anchor",
			},
			{
				label: "insert left",
				activate: (view) => view.menuItem("Insert left")?.click(),
				expected: "anchor",
			},
			{
				label: "insert right",
				activate: (view) => view.menuItem("Insert right")?.click(),
				expected: "anchor",
			},
			{
				label: "rename",
				activate: (view) => {
					const input =
						view.container.querySelector<HTMLInputElement>(
							"input[data-pen-column-menu-item]",
						)!;
					input.focus();
					dispatchKey(input, "Enter");
				},
				expected: "anchor",
			},
			{
				label: "delete",
				activate: (view) => view.menuItem("Delete")?.click(),
				expected: "surface",
			},
		];

		for (const action of actions) {
			const view = await renderInEditor();
			const first = view.container.querySelector<HTMLElement>(
				"[data-pen-column-menu-item]",
			)!;
			await act(async () => {
				first.focus();
			});

			await act(async () => {
				action.activate(view);
			});

			expect(view.onClose, action.label).toHaveBeenCalledTimes(1);
			expect(document.activeElement, action.label).toBe(
				action.expected === "anchor" ? view.anchor : view.editorRoot,
			);
			await view.cleanup();
		}
	});
});
