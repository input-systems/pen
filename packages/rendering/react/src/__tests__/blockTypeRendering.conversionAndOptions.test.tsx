// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { Pen } from "../primitives/index";
import { getAttachedFieldEditor } from "../utils/fieldEditor";
import {
	BLOCK_TYPE_OPTIONS,
	TABLE_BLOCK_TYPE_OPTIONS,
	createBlockTypeEditor,
	visibleText,
} from "./utils/blockTypeRenderingTestHelpers";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("@input/pen-react block type rendering: conversion and toolbar options", () => {
	it("derives flow-aware default block type options from schema metadata", async () => {
		const editor = createBlockTypeEditor({
			documentProfile: "flow",
		});
		const blockId = editor.firstBlock()!.id;
		editor.selectText(blockId, 0, 0);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Toolbar.Root editor={editor}>
						<Pen.Toolbar.Select format="blockType" />
					</Pen.Toolbar.Root>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const optionValues = Array.from(
			container.querySelectorAll("option"),
		).map((option) => (option as HTMLOptionElement).value);
		expect(optionValues).toContain("paragraph");
		expect(optionValues).toContain("table");
		expect(optionValues).not.toContain("subdocument");
		expect(optionValues.indexOf("paragraph")).toBeLessThan(
			optionValues.indexOf("table"),
		);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("keeps structured-only block types in default toolbar options", async () => {
		const editor = createBlockTypeEditor();
		const blockId = editor.firstBlock()!.id;
		editor.selectText(blockId, 0, 0);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Toolbar.Root editor={editor}>
						<Pen.Toolbar.Select format="blockType" />
					</Pen.Toolbar.Root>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const optionValues = Array.from(
			container.querySelectorAll("option"),
		).map((option) => (option as HTMLOptionElement).value);
		expect(optionValues).toContain("table");
		expect(optionValues).not.toContain("subdocument");

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("updates the rendered block immediately when the toolbar converts block type", async () => {
		const editor = createBlockTypeEditor();
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "Hello world",
			},
		]);
		editor.selectText(blockId, 0, 0);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Toolbar.Root editor={editor}>
						<Pen.Toolbar.Select
							format="blockType"
							options={BLOCK_TYPE_OPTIONS}
						/>
					</Pen.Toolbar.Root>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const select = container.querySelector(
			"[data-pen-toolbar-select]",
		) as HTMLSelectElement | null;

		expect(select?.value).toBe("paragraph");
		expect(
			container.querySelector("h1[data-block-type='heading']"),
		).toBeNull();
		expect(
			container.querySelector("div[data-block-type='paragraph']"),
		).not.toBeNull();

		await act(async () => {
			if (!select) {
				throw new Error("Missing toolbar select");
			}
			select.value = "heading";
			select.dispatchEvent(new Event("change", { bubbles: true }));
		});

		expect(editor.getBlock(blockId)?.type).toBe("heading");
		expect(select?.value).toBe("heading");
		expect(
			container.querySelector("h1[data-block-type='heading']"),
		).not.toBeNull();

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("rerenders rendered block text after a text-only document commit", async () => {
		const editor = createBlockTypeEditor();
		const blockId = editor.firstBlock()!.id;

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		expect(visibleText(container.textContent)).not.toContain(
			"Hello streamed world",
		);

		await act(async () => {
			editor.apply([
				{
					type: "splice-text",
					blockId,
					from: 0,
					to: 0,
					insert: "Hello streamed world",
				},
			]);
		});

		expect(visibleText(container.textContent)).toContain(
			"Hello streamed world",
		);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("converts a rendered paragraph to a toggle without violating hook order", async () => {
		const editor = createBlockTypeEditor();
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "Toggle me",
			},
		]);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		expect(
			container.querySelector("div[data-block-type='paragraph']"),
		).not.toBeNull();

		await act(async () => {
			editor.apply([
				{ type: "set-props", blockId, props: { type: "toggle" } },
			]);
		});

		const toggleTrigger = container.querySelector(
			"[data-pen-toggle-trigger]",
		);
		expect(toggleTrigger).not.toBeNull();
		expect(
			container.querySelector("div[data-block-type='toggle']"),
		).not.toBeNull();

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("preserves block text and focuses the next starter cell when converting to table", async () => {
		const editor = createBlockTypeEditor();
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "Name" },
		]);
		editor.selectText(blockId, 0, 0);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Toolbar.Root editor={editor}>
						<Pen.Toolbar.Select
							format="blockType"
							options={TABLE_BLOCK_TYPE_OPTIONS}
						/>
					</Pen.Toolbar.Root>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const select = container.querySelector(
			"[data-pen-toolbar-select]",
		) as HTMLSelectElement | null;

		await act(async () => {
			if (!select) {
				throw new Error("Missing toolbar select");
			}
			select.value = "table";
			select.dispatchEvent(new Event("change", { bubbles: true }));
			await new Promise<void>((resolve) => {
				window.requestAnimationFrame(() => resolve());
			});
		});

		expect(editor.getBlock(blockId)?.type).toBe("table");
		expect(editor.getBlock(blockId)?.props.hasHeaderRow).toBe(true);
		expect(
			editor
				.getBlock(blockId)!
				.as("table")
				?.tableCell(0, 0)
				?.textContent(),
		).toBe("Name");

		const activeCell = container.querySelector(
			"[data-pen-table-cell][data-cell-row='0'][data-cell-col='1'] [data-pen-field-editor-active-surface]",
		);
		expect(activeCell).not.toBeNull();

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("keeps toggle expansion on a dedicated trigger instead of the editable title", async () => {
		const editor = createBlockTypeEditor();
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "set-props", blockId, props: { type: "toggle" } },
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "Toggle title",
			},
		]);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const trigger = container.querySelector(
			"[data-pen-toggle-trigger]",
		) as HTMLButtonElement | null;
		const titleSurface = container.querySelector(
			"[data-pen-toggle-title] [data-pen-inline-content]",
		) as HTMLElement | null;

		expect(trigger).not.toBeNull();
		expect(titleSurface).not.toBeNull();
		expect(container.querySelector("summary")).toBeNull();
		expect(editor.getBlock(blockId)?.props.open).toBe(false);

		const fieldEditor = getAttachedFieldEditor(editor);
		await act(async () => {
			fieldEditor?.activateTextSelection?.(blockId, 2, 2);
			await new Promise<void>((resolve) => {
				window.requestAnimationFrame(() => resolve());
			});
		});

		expect(fieldEditor?.isEditing).toBe(true);
		expect(
			titleSurface?.hasAttribute("data-pen-field-editor-active-surface"),
		).toBe(true);

		await act(async () => {
			titleSurface?.dispatchEvent(
				new MouseEvent("click", { bubbles: true }),
			);
		});

		expect(editor.getBlock(blockId)?.props.open).toBe(false);

		await act(async () => {
			trigger?.dispatchEvent(
				new MouseEvent("mousedown", { bubbles: true }),
			);
			document.dispatchEvent(
				new MouseEvent("mouseup", { bubbles: true }),
			);
			trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			await new Promise<void>((resolve) => {
				window.requestAnimationFrame(() => resolve());
			});
		});

		expect(editor.getBlock(blockId)?.props.open).toBe(true);
		expect(trigger?.getAttribute("aria-expanded")).toBe("true");
		expect(fieldEditor?.isEditing).toBe(false);
		expect(
			titleSurface?.hasAttribute("data-pen-field-editor-active-surface"),
		).toBe(false);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});
});
