// @vitest-environment jsdom

import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { createReducedMotionSignal } from "@input/pen-dom";
import { createEditor, fieldEditorHostFacet } from "@input/pen-core";
import { multiplayerExtension } from "@input/pen-multiplayer";
import { defaultPreset } from "@input/pen";
import { Pen } from "../primitives/index";
import { defaultSchema } from "@input/pen-schema";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("@input/pen-react caret overlay a11y", () => {
	it("AX7: the editor overlay layer and its caret are aria-hidden and pointer-events none", async () => {
		stubMatchMedia(false);
		const { caret, layer, cleanup } = await mountVisibleCaret();
		try {
			expect(layer()?.getAttribute("aria-hidden")).toBe("true");
			expect(layer()?.style.pointerEvents).toBe("none");
			expect(caret()?.parentElement).toBe(layer());
			expect(caret()?.getAttribute("aria-hidden")).toBe("true");
			expect(caret()?.style.pointerEvents).toBe("none");
		} finally {
			await cleanup();
		}
	});

	it("AX7: multiplayer caret overlay is aria-hidden and pointer-events none", async () => {
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				multiplayerExtension({
					user: {
						id: "u1",
						name: "Ada",
					},
					autoConnect: false,
				}),
			],
		});
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		try {
			await act(async () => {
				root.render(
					<Pen.Editor.Root editor={editor}>
						<Pen.Multiplayer.CaretOverlay />
					</Pen.Editor.Root>,
				);
			});

			const overlay = container.querySelector(
				"[data-pen-multiplayer-caret-overlay]",
			);
			expect(overlay).not.toBeNull();
			expect(overlay?.getAttribute("aria-hidden")).toBe("true");
			expect((overlay as HTMLElement).style.pointerEvents).toBe("none");
		} finally {
			await act(async () => {
				root.unmount();
			});
			container.remove();
			editor.destroy();
		}
	});

	it("reaches createReducedMotionSignal through the @input/pen-dom exports map", () => {
		expect(typeof createReducedMotionSignal).toBe("function");
	});

	it("AX6: reduced motion keeps the caret solid", async () => {
		stubMatchMedia(true);
		const { caret, cleanup } = await mountVisibleCaret();
		try {
			expect(caret()?.style.animation).toBe("none");
		} finally {
			await cleanup();
		}
	});

	it("AX6: without reduced motion the caret uses the host animation token at once", async () => {
		stubMatchMedia(false);
		const { caret, cleanup } = await mountVisibleCaret();
		try {
			expect(caret()?.style.animation).toBe(
				"var(--pen-editor-caret-animation, none)",
			);
		} finally {
			await cleanup();
		}
	});
});

type MockMediaQueryList = {
	matches: boolean;
	addEventListener: (
		type: string,
		listener: (event: MediaQueryListEvent) => void,
	) => void;
	removeEventListener: (
		type: string,
		listener: (event: MediaQueryListEvent) => void,
	) => void;
};

function stubMatchMedia(matches: boolean): void {
	const mediaQueryList: MockMediaQueryList = {
		matches,
		addEventListener() {},
		removeEventListener() {},
	};
	vi.stubGlobal("matchMedia", () => mediaQueryList);
}

function getFieldEditor(editor: ReturnType<typeof createEditor>) {
	const fieldEditor = editor.facet(fieldEditorHostFacet) as {
		activateTextSelection(
			blockId: string,
			anchorOffset: number,
			focusOffset: number,
		): void;
	} | null;
	if (!fieldEditor) {
		throw new Error("Missing attached field editor");
	}
	return fieldEditor;
}

type RangeMeasure = {
	getBoundingClientRect?: () => DOMRect;
	getClientRects?: () => DOMRect[];
};

async function nextFrames(): Promise<void> {
	await act(async () => {
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
	});
}

async function mountVisibleCaret(): Promise<{
	caret: () => HTMLElement | null;
	layer: () => HTMLElement | null;
	cleanup: () => Promise<void>;
}> {
	// jsdom has no layout: every caret Range measures as a 24px line.
	const rangePrototype = Range.prototype as unknown as RangeMeasure;
	const original: RangeMeasure = {
		getBoundingClientRect: rangePrototype.getBoundingClientRect,
		getClientRects: rangePrototype.getClientRects,
	};
	const box = () => new DOMRect(24, 32, 0, 24);
	rangePrototype.getBoundingClientRect = box;
	rangePrototype.getClientRects = () => [box()];
	const editor = createEditor({
		schema: defaultSchema,
		preset: defaultPreset({
			tools: false,
			deltaStream: false,
			undo: false,
		}),
	});
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

	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);

	await act(async () => {
		root.render(
			<Pen.Editor.Root editor={editor}>
				<Pen.Editor.Content />
				<Pen.Editor.CaretOverlay />
			</Pen.Editor.Root>,
		);
	});

	const fieldEditor = getFieldEditor(editor);
	const inlineElement = container.querySelector(
		"[data-pen-inline-content]",
	) as HTMLElement | null;
	if (!inlineElement) {
		throw new Error("Missing inline content element");
	}

	await act(async () => {
		fieldEditor.activateTextSelection(blockId, 2, 2);
		inlineElement.dispatchEvent(new Event("focusin", { bubbles: true }));
	});
	await nextFrames();

	return {
		caret: () =>
			container.querySelector<HTMLElement>("[data-pen-editor-caret]"),
		layer: () =>
			container.querySelector<HTMLElement>("[data-pen-overlay-layer]"),
		cleanup: async () => {
			rangePrototype.getBoundingClientRect = original.getBoundingClientRect;
			rangePrototype.getClientRects = original.getClientRects;
			await act(async () => {
				root.unmount();
			});
			container.remove();
			editor.destroy();
		},
	};
}
