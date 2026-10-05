// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { Pen } from "../primitives/index";
import {
	createBlockTypeEditor,
	numberedListMarkers,
	visibleText,
} from "./utils/blockTypeRenderingTestHelpers";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("@input/pen-react block type rendering: nested blocks and list markers", () => {
	it("renders parentId child blocks inside an open toggle and hides them from the root flow", async () => {
		const editor = createBlockTypeEditor();
		const toggleBlockId = editor.firstBlock()!.id;
		const childBlockId = crypto.randomUUID();

		editor.apply([
			{
				type: "set-props",
				blockId: toggleBlockId,
				props: { type: "toggle", ...{ open: true } },
			},
			{
				type: "splice-text",
				blockId: toggleBlockId,
				from: 0,
				to: 0,
				insert: "Parent toggle",
			},
			{
				type: "insert-block",
				blockId: childBlockId,
				blockType: "heading",
				props: { level: 2 },
				position: "last",
			},
			{
				type: "splice-text",
				blockId: childBlockId,
				from: 0,
				to: 0,
				insert: "Nested heading",
			},
			{
				type: "set-props",
				blockId: childBlockId,
				props: { parentId: toggleBlockId },
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

		const toggleBody = container.querySelector(
			"[data-pen-toggle-body]",
		) as HTMLElement | null;
		const nestedHeading = toggleBody?.querySelector(
			"h2[data-block-type='heading']",
		);
		const allNestedHeadings = container.querySelectorAll(
			"h2[data-block-type='heading']",
		);
		const rootBlocks = container.querySelectorAll(
			"[data-pen-editor-block]",
		);

		expect(toggleBody).not.toBeNull();
		expect(nestedHeading?.textContent).toBe("Nested heading");
		expect(allNestedHeadings).toHaveLength(1);
		expect(rootBlocks).toHaveLength(2);

		await act(async () => {
			editor.apply([
				{
					type: "set-props",
					blockId: toggleBlockId,
					props: { open: false },
				},
			]);
		});

		expect(container.querySelector("[data-pen-toggle-body]")).toBeNull();
		expect(
			container.querySelector("h2[data-block-type='heading']"),
		).toBeNull();

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("creates the first nested child block from an empty open toggle", async () => {
		const editor = createBlockTypeEditor();
		const toggleBlockId = editor.firstBlock()!.id;

		editor.apply([
			{
				type: "set-props",
				blockId: toggleBlockId,
				props: { type: "toggle", ...{ open: true } },
			},
			{
				type: "splice-text",
				blockId: toggleBlockId,
				from: 0,
				to: 0,
				insert: "Toggle",
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

		const emptyButton = container.querySelector(
			"[data-pen-toggle-empty-button]",
		) as HTMLButtonElement | null;

		expect(emptyButton?.textContent).toBe(
			"Empty toggle. Click to add a block.",
		);
		expect(container.querySelector("[data-pen-toggle-body]")).toBeNull();

		await act(async () => {
			emptyButton?.dispatchEvent(
				new MouseEvent("mousedown", { bubbles: true }),
			);
			emptyButton?.dispatchEvent(
				new MouseEvent("click", { bubbles: true }),
			);
			await new Promise<void>((resolve) => {
				window.requestAnimationFrame(() => resolve());
			});
		});

		const childBlockIds = editor.documentState.blockOrder.filter(
			(blockId) => blockId !== toggleBlockId,
		);
		const nestedParagraph = container.querySelector(
			"[data-pen-toggle-body] div[data-block-type='paragraph']",
		) as HTMLElement | null;

		expect(childBlockIds).toHaveLength(1);
		expect(editor.documentState.parentOf(childBlockIds[0]!)).toBe(
			toggleBlockId,
		);
		expect(editor.getBlock(childBlockIds[0]!)?.type).toBe("paragraph");
		expect(
			container.querySelector("[data-pen-toggle-empty-button]"),
		).toBeNull();
		expect(nestedParagraph).not.toBeNull();
		expect(
			nestedParagraph?.querySelector("[data-placeholder-visible]"),
		).not.toBeNull();

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("renders numbered list items with a shared marker and content row", async () => {
		const editor = createBlockTypeEditor();
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "set-props", blockId, props: { type: "numberedListItem" } },
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "First item",
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

		const layout = container.querySelector(
			"[data-pen-list-item-layout][data-block-type='numberedListItem']",
		) as HTMLElement | null;
		const marker = layout?.querySelector("[data-pen-list-marker]");
		const content = layout?.querySelector("[data-pen-list-item-content]");

		expect(layout).not.toBeNull();
		expect(layout?.style.display).toBe("grid");
		expect(marker?.textContent).toBe("1.");
		expect(
			content?.querySelector("[data-pen-inline-content]"),
		).not.toBeNull();

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("renumbers numbered list markers when the sequence changes", async () => {
		const editor = createBlockTypeEditor();
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();
		const insertedBlockId = crypto.randomUUID();

		editor.apply([
			{
				type: "set-props",
				blockId: firstBlockId,
				props: { type: "numberedListItem" },
			},
			{
				type: "splice-text",
				blockId: firstBlockId,
				from: 0,
				to: 0,
				insert: "First item",
			},
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "numberedListItem",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: secondBlockId,
				from: 0,
				to: 0,
				insert: "Third item",
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

		expect(numberedListMarkers(container)).toEqual(["1.", "2."]);

		await act(async () => {
			editor.apply([
				{
					type: "insert-block",
					blockId: insertedBlockId,
					blockType: "numberedListItem",
					props: {},
					position: { after: firstBlockId },
				},
				{
					type: "splice-text",
					blockId: insertedBlockId,
					from: 0,
					to: 0,
					insert: "Second item",
				},
			]);
		});

		expect(numberedListMarkers(container)).toEqual(["1.", "2.", "3."]);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("renders bullet list items with a shared marker and content row", async () => {
		const editor = createBlockTypeEditor();
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "set-props", blockId, props: { type: "bulletListItem" } },
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "Bullet item",
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

		const layout = container.querySelector(
			"[data-pen-list-item-layout][data-block-type='bulletListItem']",
		) as HTMLElement | null;
		const marker = layout?.querySelector("[data-pen-list-marker]");
		const content = layout?.querySelector("[data-pen-list-item-content]");

		expect(layout).not.toBeNull();
		expect(layout?.style.display).toBe("grid");
		expect(marker?.textContent).toBe("•");
		expect(
			content?.querySelector("[data-pen-inline-content]"),
		).not.toBeNull();

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("renders check list items with the checkbox and content in one layout", async () => {
		const editor = createBlockTypeEditor();
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "set-props", blockId, props: { type: "checkListItem" } },
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "Task item",
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

		const layout = container.querySelector(
			"[data-pen-list-item-layout][data-block-type='checkListItem']",
		) as HTMLElement | null;
		const checkbox = layout?.querySelector("input[type='checkbox']");
		const content = layout?.querySelector("[data-pen-list-item-content]");

		expect(layout).not.toBeNull();
		expect(layout?.style.display).toBe("grid");
		expect(checkbox).not.toBeNull();
		expect(
			content?.querySelector("[data-pen-inline-content]"),
		).not.toBeNull();

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("updates inactive inline content when CRDT text changes", async () => {
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

		const inlineContent = container.querySelector(
			"[data-pen-inline-content]",
		) as HTMLElement | null;

		expect(visibleText(inlineContent?.textContent)).toBe("");

		await act(async () => {
			editor.apply([
				{
					type: "splice-text",
					blockId,
					from: 0,
					to: 0,
					insert: "Synced text",
				},
			]);
		});

		expect(visibleText(inlineContent?.textContent)).toBe("Synced text");

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});
});
