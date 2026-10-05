// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { Pen } from "../primitives/index";
import {
	CustomHandleParagraphRenderer,
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

describe("@input/pen-react block drag and drop: drag payload and preview", () => {
	it("uses a block preview element as the native drag image", async () => {
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
		setBlockRect(view.container, blockA, { top: 0 });
		const dataTransfer = createDataTransfer();

		await act(async () => {
			handle!.dispatchEvent(
				createDragEvent("dragstart", dataTransfer, {
					clientX: 20,
					clientY: 20,
				}),
			);
		});

		expect(dataTransfer.setDragImageMock).toHaveBeenCalledTimes(1);
		const [previewElement] =
			dataTransfer.setDragImageMock.mock.calls[0] ?? [];
		expect(previewElement).toBeInstanceOf(HTMLElement);
		expect((previewElement as HTMLElement)?.textContent).toContain(
			"Paragraph",
		);
		expect(
			document.querySelector("[data-pen-block-drag-preview-root]"),
		).not.toBeNull();

		await act(async () => {
			handle!.dispatchEvent(createDragEvent("dragend", dataTransfer));
		});

		expect(
			document.querySelector("[data-pen-block-drag-preview-root]"),
		).toBeNull();

		await view.unmount();
	});

	it("drags the full selected block set when dragging from a selected block", async () => {
		const editor = createBlockDragEditor();
		const [blockA, blockB, blockC, blockD] = seedBlocks(editor, 4);
		editor.selectBlocks([blockB, blockC]);

		const view = await renderEditor(
			<Pen.Editor.Root
				editor={editor}
				renderers={{ paragraph: CustomHandleParagraphRenderer }}
			>
				<Pen.Editor.Content />
			</Pen.Editor.Root>,
		);

		const handle = view.container.querySelector(
			`[data-testid="custom-handle-${blockB}"]`,
		) as HTMLElement | null;
		expect(handle).not.toBeNull();
		const targetBlock = setBlockRect(view.container, blockA, { top: 0 });
		const dataTransfer = createDataTransfer();

		await act(async () => {
			handle!.dispatchEvent(createDragEvent("dragstart", dataTransfer));
			targetBlock.dispatchEvent(
				createDragEvent("dragover", dataTransfer, { clientY: 1 }),
			);
			targetBlock.dispatchEvent(
				createDragEvent("drop", dataTransfer, { clientY: 1 }),
			);
			handle!.dispatchEvent(createDragEvent("dragend", dataTransfer));
		});

		expect(getBlockOrder(editor)).toEqual([blockB, blockC, blockA, blockD]);

		await view.unmount();
	});

	it("drags only the initiating block when dragging from an unselected block", async () => {
		const editor = createBlockDragEditor();
		const [blockA, blockB, blockC, blockD] = seedBlocks(editor, 4);
		editor.selectBlocks([blockA, blockB]);

		const view = await renderEditor(
			<Pen.Editor.Root
				editor={editor}
				renderers={{ paragraph: CustomHandleParagraphRenderer }}
			>
				<Pen.Editor.Content />
			</Pen.Editor.Root>,
		);

		const handle = view.container.querySelector(
			`[data-testid="custom-handle-${blockC}"]`,
		) as HTMLElement | null;
		expect(handle).not.toBeNull();
		const targetBlock = setBlockRect(view.container, blockA, { top: 0 });
		const dataTransfer = createDataTransfer();

		await act(async () => {
			handle!.dispatchEvent(createDragEvent("dragstart", dataTransfer));
			targetBlock.dispatchEvent(
				createDragEvent("dragover", dataTransfer, { clientY: 1 }),
			);
			targetBlock.dispatchEvent(
				createDragEvent("drop", dataTransfer, { clientY: 1 }),
			);
			handle!.dispatchEvent(createDragEvent("dragend", dataTransfer));
		});

		expect(getBlockOrder(editor)).toEqual([blockC, blockA, blockB, blockD]);

		await view.unmount();
	});

	it("supports custom handles when block drag and drop is enabled", async () => {
		const editor = createBlockDragEditor();
		const [blockA, blockB, blockC] = seedBlocks(editor, 3);

		const view = await renderEditor(
			<Pen.Editor.Root
				editor={editor}
				blockDragAndDrop={{ enabled: true }}
				renderers={{ paragraph: CustomHandleParagraphRenderer }}
			>
				<Pen.Editor.Content />
			</Pen.Editor.Root>,
		);

		const allHandles = view.container.querySelectorAll(
			"[data-pen-block-handle]",
		);
		expect(allHandles.length).toBe(3);
		expect(
			view.container.querySelector(
				`[data-testid="custom-handle-${blockA}"]`,
			),
		).not.toBeNull();

		const customHandle = view.container.querySelector(
			`[data-testid="custom-handle-${blockC}"]`,
		) as HTMLElement | null;
		expect(customHandle).not.toBeNull();

		const targetBlock = setBlockRect(view.container, blockA, { top: 0 });
		const dataTransfer = createDataTransfer();

		await act(async () => {
			customHandle!.dispatchEvent(
				createDragEvent("dragstart", dataTransfer),
			);
			targetBlock.dispatchEvent(
				createDragEvent("dragover", dataTransfer, { clientY: 1 }),
			);
			targetBlock.dispatchEvent(
				createDragEvent("drop", dataTransfer, { clientY: 1 }),
			);
			customHandle!.dispatchEvent(
				createDragEvent("dragend", dataTransfer),
			);
		});

		expect(getBlockOrder(editor)).toEqual([blockC, blockA, blockB]);

		await view.unmount();
	});

	it("ignores cross-root drag payloads", async () => {
		const leftEditor = createBlockDragEditor();
		const [leftA, leftB] = seedBlocks(leftEditor, 2);

		const rightEditor = createBlockDragEditor();
		const [rightA, rightB] = seedBlocks(rightEditor, 2);

		const view = await renderEditor(
			<div>
				<Pen.Editor.Root
					editor={leftEditor}
					renderers={{ paragraph: CustomHandleParagraphRenderer }}
				>
					<Pen.Editor.Content />
				</Pen.Editor.Root>
				<Pen.Editor.Root
					editor={rightEditor}
					renderers={{ paragraph: CustomHandleParagraphRenderer }}
				>
					<Pen.Editor.Content />
				</Pen.Editor.Root>
			</div>,
		);

		const leftHandle = view.container.querySelector(
			`[data-testid="custom-handle-${leftA}"]`,
		) as HTMLElement | null;
		expect(leftHandle).not.toBeNull();

		const rightTargetBlock = setBlockRect(view.container, rightA, {
			top: 0,
		});
		const dataTransfer = createDataTransfer();

		await act(async () => {
			leftHandle!.dispatchEvent(
				createDragEvent("dragstart", dataTransfer),
			);
			rightTargetBlock.dispatchEvent(
				createDragEvent("dragover", dataTransfer, { clientY: 1 }),
			);
			rightTargetBlock.dispatchEvent(
				createDragEvent("drop", dataTransfer, { clientY: 1 }),
			);
			leftHandle!.dispatchEvent(createDragEvent("dragend", dataTransfer));
		});

		expect(getBlockOrder(leftEditor)).toEqual([leftA, leftB]);
		expect(getBlockOrder(rightEditor)).toEqual([rightA, rightB]);

		await view.unmount();
	});

	it("does not make blocks draggable from the body in block-first mode", async () => {
		const editor = createBlockDragEditor();
		const [, blockB] = seedBlocks(editor, 3);
		editor.selectBlock(blockB);

		const view = await renderEditor(
			<Pen.Editor.Root editor={editor} interactionModel="block-first">
				<Pen.Editor.Content />
			</Pen.Editor.Root>,
		);

		const draggedBlock = setBlockRect(view.container, blockB, { top: 44 });

		expect(draggedBlock.getAttribute("draggable")).toBeNull();

		await view.unmount();
	});
});
