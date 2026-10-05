// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { Pen } from "../primitives/index";
import {
	CustomHandleParagraphRenderer,
	GlobalHandle,
	createBlockDragEditor,
	createDataTransfer,
	createDragEvent,
	getBlockOrder,
	renderEditor,
	seedBlocks,
	setBlockRect,
} from "./utils/blockDragTestHelpers";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("@input/pen-react block drag and drop: handles and drop resolution", () => {
	it("enables custom block handles in structured mode and disables them in flow mode by default", async () => {
		const structuredEditor = createBlockDragEditor();
		seedBlocks(structuredEditor, 3);

		const structuredView = await renderEditor(
			<Pen.Editor.Root
				editor={structuredEditor}
				renderers={{ paragraph: CustomHandleParagraphRenderer }}
			>
				<Pen.Editor.Content />
			</Pen.Editor.Root>,
		);

		const structuredHandles = structuredView.container.querySelectorAll(
			"[data-pen-block-handle]",
		);
		expect(structuredHandles.length).toBe(3);
		expect(structuredHandles[0]?.getAttribute("draggable")).toBe("true");

		await structuredView.unmount();

		const flowEditor = createBlockDragEditor({
			editorViewMode: "flow",
		});
		seedBlocks(flowEditor, 3);

		const flowView = await renderEditor(
			<Pen.Editor.Root
				editor={flowEditor}
				renderers={{ paragraph: CustomHandleParagraphRenderer }}
			>
				<Pen.Editor.Content />
			</Pen.Editor.Root>,
		);

		const flowHandles = flowView.container.querySelectorAll(
			"[data-pen-block-handle]",
		);
		expect(flowHandles.length).toBe(3);
		expect(flowHandles[0]?.getAttribute("draggable")).toBe("false");

		await flowView.unmount();
	});

	it("renders block controls for every block from a single root prop", async () => {
		const editor = createBlockDragEditor();
		const [blockA, blockB, blockC] = seedBlocks(editor, 3);

		const view = await renderEditor(
			<Pen.Editor.Root editor={editor} blockControls={GlobalHandle}>
				<Pen.Editor.Content />
			</Pen.Editor.Root>,
		);

		const allHandles = view.container.querySelectorAll(
			"[data-pen-block-handle]",
		);
		expect(allHandles.length).toBe(3);

		const globalHandle = view.container.querySelector(
			`[data-testid="global-handle-${blockC}"]`,
		) as HTMLElement | null;
		expect(globalHandle).not.toBeNull();

		const targetBlock = setBlockRect(view.container, blockA, { top: 0 });
		const dataTransfer = createDataTransfer();

		await act(async () => {
			globalHandle!.dispatchEvent(
				createDragEvent("dragstart", dataTransfer),
			);
			targetBlock.dispatchEvent(
				createDragEvent("dragover", dataTransfer, { clientY: 1 }),
			);
			targetBlock.dispatchEvent(
				createDragEvent("drop", dataTransfer, { clientY: 1 }),
			);
			globalHandle!.dispatchEvent(
				createDragEvent("dragend", dataTransfer),
			);
		});

		expect(getBlockOrder(editor)).toEqual([blockC, blockA, blockB]);

		await view.unmount();
	});

	it("resolves drops from the content surface instead of requiring block hover", async () => {
		const editor = createBlockDragEditor();
		const [blockA, blockB, blockC] = seedBlocks(editor, 3);

		const view = await renderEditor(
			<Pen.Editor.Root editor={editor} blockControls={GlobalHandle}>
				<Pen.Editor.Content />
			</Pen.Editor.Root>,
		);

		setBlockRect(view.container, blockA, { top: 0 });
		setBlockRect(view.container, blockB, { top: 44 });
		setBlockRect(view.container, blockC, { top: 88 });

		const handle = view.container.querySelector(
			`[data-testid="global-handle-${blockC}"]`,
		) as HTMLElement | null;
		const content = view.container.querySelector(
			"[data-pen-editor-content]",
		) as HTMLElement | null;
		expect(handle).not.toBeNull();
		expect(content).not.toBeNull();

		const dataTransfer = createDataTransfer();

		await act(async () => {
			handle!.dispatchEvent(createDragEvent("dragstart", dataTransfer));
			content!.dispatchEvent(
				createDragEvent("dragover", dataTransfer, { clientY: 22 }),
			);
			content!.dispatchEvent(
				createDragEvent("drop", dataTransfer, { clientY: 22 }),
			);
			handle!.dispatchEvent(createDragEvent("dragend", dataTransfer));
		});

		expect(getBlockOrder(editor)).toEqual([blockA, blockC, blockB]);

		await view.unmount();
	});

	it("falls back to the drag session when dragover cannot read custom MIME payload data", async () => {
		const editor = createBlockDragEditor();
		const [blockA, blockB, blockC] = seedBlocks(editor, 3);

		const view = await renderEditor(
			<Pen.Editor.Root editor={editor} blockControls={GlobalHandle}>
				<Pen.Editor.Content />
			</Pen.Editor.Root>,
		);

		setBlockRect(view.container, blockA, { top: 0 });
		setBlockRect(view.container, blockB, { top: 44 });
		setBlockRect(view.container, blockC, { top: 88 });

		const handle = view.container.querySelector(
			`[data-testid="global-handle-${blockC}"]`,
		) as HTMLElement | null;
		const content = view.container.querySelector(
			"[data-pen-editor-content]",
		) as HTMLElement | null;
		const targetBlock = view.container.querySelector(
			`[data-block-id="${blockA}"]`,
		) as HTMLElement | null;
		expect(handle).not.toBeNull();
		expect(content).not.toBeNull();
		expect(targetBlock).not.toBeNull();

		const dataTransfer = createDataTransfer();
		const originalGetData = dataTransfer.getData.bind(dataTransfer);

		await act(async () => {
			handle!.dispatchEvent(createDragEvent("dragstart", dataTransfer));
		});

		dataTransfer.getData = ((type: string) =>
			type === "application/x-pen-block-drag"
				? ""
				: originalGetData(type)) as typeof dataTransfer.getData;

		await act(async () => {
			content!.dispatchEvent(
				createDragEvent("dragover", dataTransfer, { clientY: 1 }),
			);
		});

		expect(targetBlock?.getAttribute("data-drop-target")).toBe("");
		expect(targetBlock?.getAttribute("data-drop-position")).toBe("before");

		await act(async () => {
			content!.dispatchEvent(
				createDragEvent("drop", dataTransfer, { clientY: 1 }),
			);
			handle!.dispatchEvent(createDragEvent("dragend", dataTransfer));
		});

		expect(getBlockOrder(editor)).toEqual([blockC, blockA, blockB]);

		await view.unmount();
	});

	it("does not render a drag overlay when no DragOverlay is mounted", async () => {
		const editor = createBlockDragEditor();
		const [blockA] = seedBlocks(editor, 1);

		const view = await renderEditor(
			<Pen.Editor.Root
				editor={editor}
				renderers={{ paragraph: CustomHandleParagraphRenderer }}
			>
				<Pen.Editor.Content />
			</Pen.Editor.Root>,
		);

		const handle = view.container.querySelector(
			`[data-testid="custom-handle-${blockA}"]`,
		) as HTMLElement | null;
		expect(handle).not.toBeNull();
		const dataTransfer = createDataTransfer();

		await act(async () => {
			handle!.dispatchEvent(createDragEvent("dragstart", dataTransfer));
		});

		const overlay = view.container.querySelector(
			"[data-pen-drag-overlay]",
		) as HTMLElement | null;
		expect(overlay).toBeNull();

		await act(async () => {
			handle!.dispatchEvent(createDragEvent("dragend", dataTransfer));
		});

		await view.unmount();
	});
});
