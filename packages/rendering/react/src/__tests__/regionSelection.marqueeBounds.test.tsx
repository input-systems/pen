// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { Pen } from "../primitives/index";
import {
	createMouseEvent,
	createThreeBlockEditor,
	setRect,
} from "./utils/regionSelectionTestHelpers";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("@input/pen-react region selection: marquee bounds", () => {
	it("clips the marquee overlay to the configured region rect", async () => {
		const { editor, firstBlockId } = createThreeBlockEditor();
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);
		const regionRect = new DOMRect(0, 40, 400, 200);

		try {
			await act(async () => {
				root.render(
					<Pen.Editor.Root editor={editor}>
						<Pen.Editor.Content />
						<Pen.Editor.RegionSelector
							getRegionRect={() => regionRect}
						/>
						<Pen.Editor.SelectionRect />
					</Pen.Editor.Root>,
				);
			});

			const contentElement = container.querySelector(
				"[data-pen-editor-content]",
			) as HTMLElement | null;
			const blockElements = container.querySelectorAll("[data-block-id]");

			expect(contentElement).not.toBeNull();
			expect(blockElements).toHaveLength(3);

			setRect(blockElements[0]!, 0, 50, 200, 40);
			setRect(blockElements[1]!, 0, 100, 200, 40);
			setRect(blockElements[2]!, 0, 150, 200, 40);

			await act(async () => {
				contentElement?.dispatchEvent(
					createMouseEvent("mousedown", 10, 60),
				);
				document.dispatchEvent(createMouseEvent("mousemove", 180, 20));
			});

			expect(editor.selection).toMatchObject({
				type: "block",
				blockIds: [firstBlockId],
			});

			const activeOverlay = container.querySelector(
				"[data-pen-selection-rect]",
			) as HTMLElement | null;
			expect(activeOverlay).not.toBeNull();
			expect(activeOverlay?.style.top).toBe("40px");
			expect(activeOverlay?.style.height).toBe("20px");
		} finally {
			await act(async () => {
				root.unmount();
			});
			container.remove();
			editor.destroy();
		}
	});

	it("starts marquee selection from the editor root outside content", async () => {
		const { editor, firstBlockId, secondBlockId } =
			createThreeBlockEditor();
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);
		const regionRect = new DOMRect(0, 0, 600, 400);

		try {
			await act(async () => {
				root.render(
					<Pen.Editor.Root editor={editor}>
						<div
							data-testid="toolbar-shell"
							data-pen-ignore-pointer-gesture=""
						>
							Toolbar
						</div>
						<Pen.Editor.Content />
						<Pen.Editor.RegionSelector
							getRegionRect={() => regionRect}
						/>
						<Pen.Editor.SelectionRect />
					</Pen.Editor.Root>,
				);
			});

			const rootElement = container.querySelector(
				"[data-pen-editor-root]",
			) as HTMLElement | null;
			const blockElements = container.querySelectorAll("[data-block-id]");

			expect(rootElement).not.toBeNull();
			expect(blockElements).toHaveLength(3);

			setRect(blockElements[0]!, 0, 20, 200, 40);
			setRect(blockElements[1]!, 0, 70, 200, 40);
			setRect(blockElements[2]!, 0, 120, 200, 40);

			await act(async () => {
				rootElement?.dispatchEvent(
					createMouseEvent("mousedown", 260, 10),
				);
				document.dispatchEvent(createMouseEvent("mousemove", 120, 90));
			});

			expect(editor.selection).toMatchObject({
				type: "block",
				blockIds: [firstBlockId, secondBlockId],
			});
		} finally {
			await act(async () => {
				root.unmount();
			});
			container.remove();
			editor.destroy();
		}
	});
});
