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

describe("@input/pen-react block drag and drop: mode gating", () => {
	it("does not auto-enable handle drag in flow mode when block-first interaction is enabled", async () => {
		const editor = createBlockDragEditor({
			editorViewMode: "flow",
		});
		const [blockA] = seedBlocks(editor, 1);

		const view = await renderEditor(
			<Pen.Editor.Root
				editor={editor}
				interactionModel="block-first"
				renderers={{ paragraph: CustomHandleParagraphRenderer }}
			>
				<Pen.Editor.Content />
			</Pen.Editor.Root>,
		);

		const handle = view.container.querySelector(
			`[data-testid="custom-handle-${blockA}"]`,
		) as HTMLElement | null;
		expect(handle).not.toBeNull();
		expect(handle?.getAttribute("draggable")).toBe("false");

		await view.unmount();
	});

	it("disables drag behavior when block drag and drop is disabled", async () => {
		const editor = createBlockDragEditor();
		const [blockA, blockB] = seedBlocks(editor, 2);

		const view = await renderEditor(
			<Pen.Editor.Root
				editor={editor}
				blockDragAndDrop={{ enabled: false }}
				renderers={{ paragraph: CustomHandleParagraphRenderer }}
			>
				<Pen.Editor.Content />
			</Pen.Editor.Root>,
		);

		const customHandle = view.container.querySelector(
			`[data-testid="custom-handle-${blockB}"]`,
		) as HTMLElement | null;
		expect(customHandle).not.toBeNull();
		expect(customHandle?.getAttribute("draggable")).toBe("false");

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
		});

		expect(getBlockOrder(editor)).toEqual([blockA, blockB]);

		await view.unmount();
	});
});
