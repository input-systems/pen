// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import React, { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { createEditor } from "@input/pen-core";
import { getRootOverlay } from "@input/pen-dom";
import {
	getMultiplayerController,
	multiplayerExtension,
} from "@input/pen-multiplayer";
import { defaultSchema } from "@input/pen-schema";
import type { Editor } from "@input/pen-types";
import { Pen } from "../primitives/index";
import type { MultiplayerCaretRenderProps } from "../primitives/multiplayer/caretOverlay";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type AwarenessController = {
	handleAwarenessChange(states: Map<number, Record<string, unknown>>): void;
};

type RangeMeasure = {
	getBoundingClientRect?: () => DOMRect;
	getClientRects?: () => DOMRect[];
};
const rangePrototype = Range.prototype as unknown as RangeMeasure;
const originalRangeMeasure: RangeMeasure = {
	getBoundingClientRect: rangePrototype.getBoundingClientRect,
	getClientRects: rangePrototype.getClientRects,
};

afterEach(() => {
	rangePrototype.getBoundingClientRect =
		originalRangeMeasure.getBoundingClientRect;
	rangePrototype.getClientRects = originalRangeMeasure.getClientRects;
	document.body.replaceChildren();
});

/** jsdom has no layout: every caret Range measures as a 24px line at (24, 32). */
function stubGeometry(): void {
	const box = () => new DOMRect(24, 32, 0, 24);
	rangePrototype.getBoundingClientRect = box;
	rangePrototype.getClientRects = () => [box()];
}

/** Run the scheduler's pending flush (overlay read and paint). */
async function flushFrames(): Promise<void> {
	await act(async () => {
		await new Promise<void>((resolve) =>
			requestAnimationFrame(() => resolve()),
		);
		await new Promise<void>((resolve) =>
			requestAnimationFrame(() => resolve()),
		);
	});
}

function createPeerEditor(): {
	editor: Editor;
	blockId: string;
	controller: AwarenessController;
} {
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
	const controller = getMultiplayerController(
		editor,
	) as AwarenessController | null;
	if (!controller) {
		throw new Error("Missing multiplayer controller");
	}
	const blockId = editor.firstBlock()!.id;
	editor.apply([
		{ type: "splice-text", blockId, from: 0, to: 0, insert: "Hi" },
	]);
	return { editor, blockId, controller };
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
		},
	};
}

function editorRoot(container: HTMLElement): HTMLElement {
	const root = container.querySelector<HTMLElement>("[data-pen-editor-root]");
	if (!root) {
		throw new Error("Missing editor root");
	}
	return root;
}

/** A peer caret published at offset 1, mounted with `overlay` and painted. */
async function mountWithRemoteCaret(overlay: React.ReactElement) {
	stubGeometry();
	const peer = createPeerEditor();
	publishRemoteCursor(
		peer.controller,
		peer.editor.clientId,
		encodeCursorAnchor(peer.editor, peer.blockId, 1),
		1,
	);
	const view = await mount(
		<Pen.Editor.Root editor={peer.editor}>
			<Pen.Editor.Content />
			{overlay}
		</Pen.Editor.Root>,
	);
	await flushFrames();
	return { ...peer, view };
}

function attributes(element: Element | null | undefined, names: string[]) {
	return Object.fromEntries(names.map((name) => [name, element?.getAttribute(name)]));
}

// pen-dom's remoteCarets.test.ts covers the painted caret's styles and that a
// cursor move repaints the same element (OV1); these cover the binding.
describe("@input/pen-react multiplayer caret overlay (OV3)", () => {
	it("OV1 OV3: the remote caret is a contributor item painted into the overlay layer with a transform", async () => {
		const { editor, blockId, view } = await mountWithRemoteCaret(
			<Pen.Multiplayer.CaretOverlay />,
		);
		const layer = view.container.querySelector<HTMLElement>(
			"[data-pen-overlay-layer]",
		);
		const caret = layer?.querySelector<HTMLElement>(
			"[data-pen-multiplayer-caret]",
		);
		const label = caret?.querySelector<HTMLElement>(
			"[data-pen-multiplayer-caret-label]",
		);
		expect(caret?.parentElement).toBe(layer);
		expect(
			attributes(caret, [
				"data-pen-overlay-item",
				"data-user-name",
				"data-user-color",
				"data-block-id",
				"data-affinity",
			]),
		).toEqual({
			"data-pen-overlay-item": "caret",
			"data-user-name": "Babbage",
			"data-user-color": "#abc123",
			"data-block-id": blockId,
			"data-affinity": "downstream",
		});
		// jsdom lays the layer out at (0, 0), so the layer-relative
		// position is the measured rect.
		expect(caret?.style.transform).toBe("translate3d(24px, 32px, 0)");
		expect(caret?.style.height).toBe("24px");
		expect(label?.textContent).toBe("Babbage");
		expect(label?.style.transform).toBe(
			"translate3d(0px, -8px, 0) translateY(-100%)",
		);
		expect(
			getRootOverlay(editorRoot(view.container))?.plan?.items.find(
				(item) => item.role === "remote",
			)?.contributor,
		).toBe("multiplayer");

		await view.unmount();
		expect(
			document.querySelector("[data-pen-multiplayer-caret]"),
		).toBeNull();
		editor.destroy();
	});

	it("OV3: renderCaret and renderLabel render the plan's items into the layer", async () => {
		const seen: MultiplayerCaretRenderProps[] = [];
		const renderCaret = (props: MultiplayerCaretRenderProps) => {
			seen.push(props);
			return (
				<span
					{...props.attributes}
					data-host-caret=""
					style={props.caretStyle}
				/>
			);
		};
		const renderLabel = (props: MultiplayerCaretRenderProps) => (
			<span data-host-label="" style={props.labelStyle}>
				{props.cursor.user.name}
			</span>
		);
		const { editor, view } = await mountWithRemoteCaret(
			<Pen.Multiplayer.CaretOverlay
				renderCaret={renderCaret}
				renderLabel={renderLabel}
			/>,
		);

		const layer = view.container.querySelector("[data-pen-overlay-layer]");
		const host = layer?.querySelector(
			"[data-pen-multiplayer-caret-overlay]",
		);
		expect(host?.querySelector("[data-host-caret]")).toBeTruthy();
		expect(host?.querySelector("[data-host-label]")?.textContent).toBe(
			"Babbage",
		);
		// pen-dom paints nothing of its own for a binding-painted caret.
		expect(
			layer?.querySelectorAll(":scope > [data-pen-multiplayer-caret]"),
		).toHaveLength(0);
		const props = seen.at(-1);
		expect(props?.cursor.user.name).toBe("Babbage");
		expect(props?.caretStyle.transform).toBe("translate3d(24px, 32px, 0)");
		// OV2: left and top stay 0, so an RTL host keeps the transform's position.
		expect(props?.caretStyle.left).toBe("0px");
		expect(props?.labelStyle.left).toBe("0px");
		expect(props?.labelStyle.top).toBe("0px");
		expect(props?.labelStyle.transform).toBe(
			"translate3d(24px, 24px, 0) translateY(-100%)",
		);
		await view.unmount();
		editor.destroy();
	});

	it("OV3: a local keystroke that leaves the remote caret in place re-renders no host caret", async () => {
		let renders = 0;
		const renderCaret = (props: MultiplayerCaretRenderProps) => {
			renders += 1;
			return <span data-host-caret="" style={props.caretStyle} />;
		};
		const { editor, blockId, view } = await mountWithRemoteCaret(
			<Pen.Multiplayer.CaretOverlay renderCaret={renderCaret} />,
		);
		const settled = renders;
		expect(settled).toBeGreaterThan(0);

		// Three keystrokes after the peer's caret (offset 1): it never moves.
		for (const at of [2, 3, 4]) {
			await act(async () => {
				editor.apply(
					[{ type: "splice-text", blockId, from: at, to: at, insert: "x" }],
					{ origin: "user" },
				);
			});
			await flushFrames();
		}

		expect(renders).toBe(settled);
		await view.unmount();
		editor.destroy();
	});

	it("OV3: the binding imports no measurement API and no frame driver", () => {
		const source = readFileSync(
			join(
				import.meta.dirname,
				"../primitives/multiplayer/caretOverlay.tsx",
			),
			"utf8",
		);
		for (const name of [
			"measureWithRoot",
			"getBoundingClientRect",
			"useOverlayLayout",
			"requestAnimationFrame",
			"MutationObserver",
			'"fixed"',
		]) {
			expect(source, name).not.toContain(name);
		}
	});
});

function publishRemoteCursor(
	controller: AwarenessController,
	localClientId: number,
	anchor: string,
	clock: number,
): void {
	controller.handleAwarenessChange(
		new Map<number, Record<string, unknown>>([
			[
				localClientId,
				{
					user: {
						id: "u1",
						name: "Ada",
					},
				},
			],
			[
				77,
				{
					user: {
						id: "u2",
						name: "Babbage",
						color: "#abc123",
					},
					cursor: {
						anchor,
						clock,
					},
				},
			],
		]),
	);
}

function encodeCursorAnchor(
	editor: Editor,
	blockId: string,
	offset: number,
): string {
	const minted = editor.anchors.create({ blockId, offset }, 1);
	if (minted === null) {
		throw new Error("Could not mint a cursor anchor");
	}
	return editor.anchors.serialize(minted);
}
