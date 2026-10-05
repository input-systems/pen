// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import React, { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { createEditor, fieldEditorHostFacet } from "@input/pen-core";
import { getRootOverlay } from "@input/pen-dom";
import { defaultPreset } from "@input/pen";
import { defaultSchema } from "@input/pen-schema";
import type { Editor } from "@input/pen-types";
import { Pen } from "../primitives/index";
import { PenEditor } from "../penEditor";
import type { EditorCaretRenderProps } from "../primitives/editor/caretOverlay";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
	restoreGeometry();
	document.body.replaceChildren();
});

function createHelloEditor(): { editor: Editor; blockId: string } {
	const editor = createEditor({
		schema: defaultSchema,
		preset: defaultPreset({ tools: false, deltaStream: false, undo: false }),
	});
	const blockId = editor.firstBlock()!.id;
	editor.apply([
		{ type: "splice-text", blockId, from: 0, to: 0, insert: "Hello world" },
	]);
	return { editor, blockId };
}

/** Run the scheduler's pending flush (overlay read and paint). */
async function flushFrames(): Promise<void> {
	await act(async () => {
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
	});
}

type RangeMeasure = {
	getBoundingClientRect?: () => DOMRect;
	getClientRects?: () => DOMRect[];
};
const rangePrototype = Range.prototype as unknown as RangeMeasure;
const originalRangeMeasure: RangeMeasure = {
	getBoundingClientRect: rangePrototype.getBoundingClientRect,
	getClientRects: rangePrototype.getClientRects,
};

/** jsdom has no layout: every caret Range measures as a 24px line so the overlay resolves it. */
function stubGeometry(): void {
	const box = () => new DOMRect(24, 32, 0, 24);
	rangePrototype.getBoundingClientRect = box;
	rangePrototype.getClientRects = () => [box()];
}

function restoreGeometry(): void {
	rangePrototype.getBoundingClientRect =
		originalRangeMeasure.getBoundingClientRect;
	rangePrototype.getClientRects = originalRangeMeasure.getClientRects;
}

async function mount(
	element: React.ReactElement,
): Promise<{ container: HTMLElement; unmount: () => Promise<void> }> {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	await act(async () => {
		root.render(element);
	});
	return {
		container,
		unmount: async () => {
			await act(async () => {
				root.unmount();
			});
			container.remove();
		},
	};
}

async function placeCaret(
	editor: Editor,
	container: HTMLElement,
	blockId: string,
	offset: number,
): Promise<void> {
	const fieldEditor = editor.facet(fieldEditorHostFacet) as {
		activateTextSelection(blockId: string, anchor: number, focus: number): void;
	};
	const inline = container.querySelector<HTMLElement>("[data-pen-inline-content]");
	await act(async () => {
		fieldEditor.activateTextSelection(blockId, offset, offset);
		inline?.dispatchEvent(new Event("focusin", { bubbles: true }));
	});
	await flushFrames();
}

function editorRoot(container: HTMLElement): HTMLElement {
	const root = container.querySelector<HTMLElement>("[data-pen-editor-root]");
	if (!root) {
		throw new Error("Missing editor root");
	}
	return root;
}

describe("@input/pen-react editor caret overlay (OV3)", () => {
	it("O: Pen.Editor.CaretOverlay holds customCaret mode while mounted and releases it on unmount", async () => {
		const { editor } = createHelloEditor();
		const modes: string[] = [];
		let showCaret = true;
		const Host = () => (
			<Pen.Editor.Root editor={editor}>
				<Pen.Editor.Content />
				{showCaret ? <Pen.Editor.CaretOverlay /> : null}
			</Pen.Editor.Root>
		);
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);
		await act(async () => {
			root.render(<Host />);
		});
		getRootOverlay(editorRoot(container))!.registerContributor({
			id: "mode-spy",
			requests: (context) => {
				modes.push(context.caretMode);
				return [];
			},
		});
		await flushFrames();
		expect(modes.at(-1)).toBe("all");

		showCaret = false;
		await act(async () => {
			root.render(<Host />);
		});
		await flushFrames();
		expect(modes.at(-1)).toBe("auto");
		await act(async () => {
			root.unmount();
		});
		editor.destroy();
	});

	it("OV3: renderCaret portals into the overlay layer and pen-dom does not paint that item", async () => {
		stubGeometry();
		const { editor, blockId } = createHelloEditor();
		let rendered: EditorCaretRenderProps | null = null;
		const view = await mount(
			<Pen.Editor.Root editor={editor}>
				<Pen.Editor.Content />
				<Pen.Editor.CaretOverlay
					variant={Pen.Editor.CARET.MACOS}
					renderCaret={(props) => {
						rendered = props;
						return (
							<div
								data-host-caret=""
								{...props.attributes}
								style={props.caretStyle}
							/>
						);
					}}
				/>
			</Pen.Editor.Root>,
		);
		await placeCaret(editor, view.container, blockId, 2);

		const layer = view.container.querySelector("[data-pen-overlay-layer]");
		const hostCaret = view.container.querySelector("[data-host-caret]");
		expect(hostCaret).not.toBeNull();
		expect(hostCaret?.closest("[data-pen-overlay-layer]")).toBe(layer);
		expect(
			hostCaret?.closest("[data-pen-editor-caret-overlay]")?.getAttribute(
				"aria-hidden",
			),
		).toBe("true");
		// pen-dom left the local caret to the binding.
		expect(
			layer?.querySelectorAll('[data-pen-overlay-item="caret"]'),
		).toHaveLength(0);
		expect(layer?.hasAttribute("data-caret-visible")).toBe(true);

		const props = rendered as EditorCaretRenderProps | null;
		expect(props?.point).toEqual({ blockId, offset: 2 });
		expect(props?.affinity).toBe("downstream");
		expect(props?.attributes["data-affinity"]).toBe("downstream");
		// OV2: left and top stay 0, so an RTL host keeps the transform's position.
		expect(props?.caretStyle).toMatchObject({
			transform: expect.stringMatching(/^translate3d\(/),
			left: "0px",
			top: "0px",
			position: "absolute",
			height: "24px",
			width: "var(--pen-editor-caret-width, var(--pen-caret-width, 2px))",
			borderRadius: "var(--pen-editor-caret-radius, var(--pen-caret-radius, 999px))",
			background:
				"var(--pen-editor-caret-color, var(--pen-caret-color, var(--palette-blue, #0a84ff)))",
		});
		await view.unmount();
		editor.destroy();
	});

	it("OV3: EditorCaretOverlay imports no measurement API", () => {
		const source = readFileSync(
			join(import.meta.dirname, "../primitives/editor/caretOverlay.tsx"),
			"utf8",
		);
		for (const name of [
			"measureWithRoot",
			"getBoundingClientRect",
			"useOverlayLayout",
			"setTimeout",
			"createReducedMotionSignal",
		]) {
			expect(source, name).not.toContain(name);
		}
	});

	it("O: the convenience PenEditor API keeps customCaret opt-in", async () => {
		stubGeometry();
		const { editor, blockId } = createHelloEditor();
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(<PenEditor editor={editor} />);
		});
		await placeCaret(editor, container, blockId, 2);
		expect(container.querySelector("[data-pen-editor-caret]")).toBeNull();

		await act(async () => {
			root.render(<PenEditor editor={editor} customCaret />);
		});
		await flushFrames();
		const caret = container.querySelector("[data-pen-editor-caret]");
		expect(caret).not.toBeNull();
		expect(caret?.parentElement?.hasAttribute("data-pen-overlay-layer")).toBe(
			true,
		);
		expect(caret?.getAttribute("data-offset")).toBe("2");

		await act(async () => {
			root.unmount();
		});
		editor.destroy();
	});
});
