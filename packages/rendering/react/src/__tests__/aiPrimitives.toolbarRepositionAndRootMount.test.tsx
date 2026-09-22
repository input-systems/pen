// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { createEditor, toolRuntimeFacet } from "@input/pen-core";
import type { ToolRuntime } from "@input/pen-types";
import { defineExtension } from "@input/pen-core";
import { aiExtension, getAIController } from "@input/pen-ai";
import { undoExtension } from "@input/pen-undo";
import { deltaStreamExtension } from "@input/pen-ai/stream";
import { toolsExtension } from "@input/pen-tools";
import { defaultPreset } from "@input/pen";
import { defaultSchema } from "@input/pen-schema";
import { collapsedRect, getRootGeometry } from "@input/pen-dom";
import { DATA_ATTRS } from "@input/pen-dom/utils/dataAttributes";
import {
	Pen,
	useAIActions,
	useAISessions,
	useActiveAISession,
	useAIDebugLog,
} from "../index";
import { resolveSelectionToolbarRect } from "../hooks/useSelectionToolbar";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function createKeyDownEvent(
	key: string,
	options: KeyboardEventInit = {},
): KeyboardEvent {
	return new KeyboardEvent("keydown", {
		key,
		bubbles: true,
		cancelable: true,
		...options,
	});
}

function createDeferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((nextResolve) => {
		resolve = nextResolve;
	});
	return { promise, resolve };
}

function withNavigatorPlatform<T>(platform: string, run: () => T): T {
	const descriptor = Object.getOwnPropertyDescriptor(navigator, "platform");
	Object.defineProperty(navigator, "platform", {
		configurable: true,
		value: platform,
	});
	try {
		return run();
	} finally {
		if (descriptor) {
			Object.defineProperty(navigator, "platform", descriptor);
		}
	}
}

function mockSelectionToolbarRect(rect: {
	top: number;
	left: number;
	width: number;
	height: number;
}) {
	const originalGetSelection = window.getSelection.bind(window);
	const originalRequestAnimationFrame =
		window.requestAnimationFrame.bind(window);
	const originalCancelAnimationFrame =
		window.cancelAnimationFrame.bind(window);
	const rangeRect = {
		top: rect.top,
		left: rect.left,
		width: rect.width,
		height: rect.height,
		right: rect.left + rect.width,
		bottom: rect.top + rect.height,
		x: rect.left,
		y: rect.top,
		toJSON() {
			return this;
		},
	} as DOMRect;

	Object.defineProperty(window, "getSelection", {
		configurable: true,
		value: () => ({
			rangeCount: 1,
			getRangeAt: () => ({
				getBoundingClientRect: () => rangeRect,
			}),
		}),
	});
	Object.defineProperty(window, "requestAnimationFrame", {
		configurable: true,
		value: (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		},
	});
	Object.defineProperty(window, "cancelAnimationFrame", {
		configurable: true,
		value: () => {},
	});

	return () => {
		Object.defineProperty(window, "getSelection", {
			configurable: true,
			value: originalGetSelection,
		});
		Object.defineProperty(window, "requestAnimationFrame", {
			configurable: true,
			value: originalRequestAnimationFrame,
		});
		Object.defineProperty(window, "cancelAnimationFrame", {
			configurable: true,
			value: originalCancelAnimationFrame,
		});
	};
}

function mockMutableSelectionToolbarRect(initialRect: {
	top: number;
	left: number;
	width: number;
	height: number;
}) {
	const rect = { ...initialRect };
	let nextRect: typeof rect | null = null;
	const originalGetSelection = window.getSelection.bind(window);
	const originalRequestAnimationFrame =
		window.requestAnimationFrame.bind(window);
	const originalCancelAnimationFrame =
		window.cancelAnimationFrame.bind(window);

	Object.defineProperty(window, "getSelection", {
		configurable: true,
		value: () => ({
			rangeCount: 1,
			getRangeAt: () => ({
				getBoundingClientRect: () => {
					const measuredRect = nextRect ?? rect;
					nextRect = null;
					return {
						top: measuredRect.top,
						left: measuredRect.left,
						width: measuredRect.width,
						height: measuredRect.height,
						right: measuredRect.left + measuredRect.width,
						bottom: measuredRect.top + measuredRect.height,
						x: measuredRect.left,
						y: measuredRect.top,
						toJSON() {
							return this;
						},
					} as DOMRect;
				},
			}),
		}),
	});
	Object.defineProperty(window, "requestAnimationFrame", {
		configurable: true,
		value: (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		},
	});
	Object.defineProperty(window, "cancelAnimationFrame", {
		configurable: true,
		value: () => {},
	});

	return {
		rect,
		returnRectOnce: (value: typeof rect) => {
			nextRect = { ...value };
		},
		restore: () => {
			Object.defineProperty(window, "getSelection", {
				configurable: true,
				value: originalGetSelection,
			});
			Object.defineProperty(window, "requestAnimationFrame", {
				configurable: true,
				value: originalRequestAnimationFrame,
			});
			Object.defineProperty(window, "cancelAnimationFrame", {
				configurable: true,
				value: originalCancelAnimationFrame,
			});
		},
	};
}

async function waitForAttributeValue(
	readValue: () => string | null | undefined,
	expectedValue: string,
	maxTicks = 12,
): Promise<void> {
	for (let tick = 0; tick < maxTicks; tick += 1) {
		if (readValue() === expectedValue) {
			return;
		}
		await Promise.resolve();
	}
}

async function waitForCondition(
	check: () => boolean,
	maxTicks = 20,
): Promise<void> {
	for (let tick = 0; tick < maxTicks; tick += 1) {
		if (check()) {
			return;
		}
		await Promise.resolve();
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
}

function testStreamingToolExtension() {
	let toolRuntime: ToolRuntime | null = null;

	return defineExtension({
		name: "test-streaming-tool",
		dependencies: ["tools"],
		activateClient: async ({ editor }) => {
			toolRuntime =
				(editor.facet(toolRuntimeFacet) as ToolRuntime | null) ?? null;
			toolRuntime?.registerTool({
				name: "test_search",
				description: "Test streaming search tool",
				inputSchema: {
					type: "object",
					required: ["query"],
					properties: {
						query: { type: "string" },
					},
				},
				async *handler(input: unknown) {
					const { query } = input as { query: string };
					yield `searching:${query}`;
					yield { matches: 2, query };
				},
			});
		},
		deactivateClient: async () => {
			toolRuntime?.unregisterTool("test_search");
			toolRuntime = null;
		},
	});
}

describe("@input/pen-react AI primitives: toolbar reposition and root mount", () => {
	it("uses editor selection geometry while the native selection is collapsed", () => {
		const editor = createEditor({ schema: defaultSchema });
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[
				{
					type: "splice-text",
					blockId,
					from: 0,
					to: 0,
					insert: "Hello there",
				},
			],
			{ origin: "system" },
		);
		editor.selectTextRange({ blockId, offset: 0 }, { blockId, offset: 11 });

		const root = document.createElement("div");
		root.setAttribute(DATA_ATTRS.editorRoot, "");
		const block = document.createElement("div");
		block.setAttribute(DATA_ATTRS.blockId, blockId);
		root.appendChild(block);
		document.body.appendChild(root);

		const rangeRect = {
			...collapsedRect(160, 180, 24),
			width: 120,
			right: 280,
		};
		getRootGeometry(root, {
			observeFonts: false,
			observeResize: false,
			observeScroll: false,
			measure: { rangeRects: () => [rangeRect] },
		});

		const originalGetSelection = window.getSelection.bind(window);
		Object.defineProperty(window, "getSelection", {
			configurable: true,
			value: () => ({
				rangeCount: 1,
				getRangeAt: () => ({
					collapsed: true,
					getBoundingClientRect: () => new DOMRect(280, 180, 0, 24),
				}),
			}),
		});

		try {
			expect(resolveSelectionToolbarRect(editor)?.left).toBe(160);
		} finally {
			Object.defineProperty(window, "getSelection", {
				configurable: true,
				value: originalGetSelection,
			});
			root.remove();
			editor.destroy();
		}
	});

	it("positions from live geometry when the commit measurement is stale", async () => {
		const initialRect = {
			top: 180,
			left: 160,
			width: 120,
			height: 24,
		};
		const selectionRect = mockMutableSelectionToolbarRect(initialRect);
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				undoExtension(),
				deltaStreamExtension(),
				toolsExtension(),
				aiExtension({ author: "tester" }),
			],
		});
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[
				{
					type: "splice-text",
					blockId,
					from: 0,
					to: 0,
					insert: "Hello world",
				},
			],
			{ origin: "system" },
		);
		editor.selectTextRange({ blockId, offset: 0 }, { blockId, offset: 5 });

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);
		const renderToolbar = (horizontalAlign: "left" | "right") => (
			<Pen.Editor.Root editor={editor}>
				<Pen.AI.Root editor={editor}>
					<Pen.Editor.Content />
					<Pen.SelectionToolbar.Root>
						<Pen.SelectionToolbar.Content
							horizontalAlign={horizontalAlign}
						>
							<button type="button">AI</button>
						</Pen.SelectionToolbar.Content>
					</Pen.SelectionToolbar.Root>
				</Pen.AI.Root>
			</Pen.Editor.Root>
		);

		await act(async () => {
			root.render(renderToolbar("left"));
			await Promise.resolve();
		});

		const toolbar = container.querySelector(
			"[data-pen-selection-toolbar-content]",
		) as HTMLElement | null;
		expect(toolbar).not.toBeNull();
		if (!toolbar) {
			throw new Error("Expected selection toolbar content");
		}
		expect(toolbar.style.transform).toContain("160px");

		selectionRect.rect.left = 420;
		selectionRect.returnRectOnce(initialRect);
		await act(async () => {
			editor.apply(
				[
					{
						type: "set-props",
						blockId,
						props: { direction: "rtl" },
					},
				],
				{ origin: "user" },
			);
			root.render(renderToolbar("right"));
			await Promise.resolve();
		});

		expect(toolbar.style.transform).toContain("540px");

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
		selectionRect.restore();
	});

	it("keeps the left anchor stable across width changes and follows layout changes", async () => {
		const selectionRect = mockMutableSelectionToolbarRect({
			top: 180,
			left: 160,
			width: 120,
			height: 24,
		});
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				undoExtension(),
				deltaStreamExtension(),
				toolsExtension(),
				aiExtension({ author: "tester" }),
			],
		});
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[
				{
					type: "splice-text",
					blockId,
					from: 0,
					to: 0,
					insert: "Hello world",
				},
			],
			{ origin: "system" },
		);
		editor.selectTextRange({ blockId, offset: 0 }, { blockId, offset: 5 });

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.AI.Root editor={editor}>
						<Pen.Editor.Content />
						<Pen.SelectionToolbar.Root>
							<Pen.SelectionToolbar.Content horizontalAlign="left">
								<button type="button">AI</button>
							</Pen.SelectionToolbar.Content>
						</Pen.SelectionToolbar.Root>
					</Pen.AI.Root>
				</Pen.Editor.Root>,
			);
			await Promise.resolve();
		});

		const toolbar = container.querySelector(
			"[data-pen-selection-toolbar-content]",
		) as HTMLElement | null;
		expect(toolbar).not.toBeNull();
		if (!toolbar) {
			throw new Error("Expected selection toolbar content");
		}

		const initialTransform = toolbar.style.transform;
		expect(initialTransform).toContain("160px");
		expect(initialTransform).toContain("172px");

		await act(async () => {
			selectionRect.rect.width = 160;
			editor.apply(
				[
					{
						type: "format-text",
						blockId,
						from: 0,
						to: 5,
						marks: { bold: true },
					},
				],
				{ origin: "user" },
			);
			await Promise.resolve();
		});

		expect(toolbar.style.transform).toBe(initialTransform);

		await act(async () => {
			selectionRect.rect.left = 220;
			editor.apply(
				[
					{
						type: "set-props",
						blockId,
						props: { direction: "rtl" },
					},
				],
				{ origin: "user" },
			);
			await Promise.resolve();
		});

		expect(toolbar.style.transform).not.toBe(initialTransform);
		expect(toolbar.style.transform).toContain("220px");

		const transformAfterLayoutChange = toolbar.style.transform;
		await act(async () => {
			selectionRect.rect.top = 120;
			window.dispatchEvent(new Event("scroll"));
			await Promise.resolve();
		});

		expect(toolbar.style.transform).not.toBe(transformAfterLayoutChange);
		expect(toolbar.style.transform).toContain("112px");

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
		selectionRect.restore();
	});

	it("mounts Pen.AI.Root AI views without entering an update loop", async () => {
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				undoExtension(),
				deltaStreamExtension(),
				toolsExtension(),
				aiExtension({ suggestMode: true, author: "tester" }),
			],
		});
		const controller = getAIController(editor);
		expect(controller).toBeTruthy();

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.AI.Root editor={editor}>
						<Pen.AI.DiffView />
						<Pen.AI.ChangeList />
					</Pen.AI.Root>
				</Pen.Editor.Root>,
			);
		});

		const initialDiffView = container.querySelector(
			"[data-pen-ai-diff-view]",
		);
		const initialChangeList = container.querySelector(
			"[data-pen-ai-change-list]",
		);
		expect(initialDiffView).not.toBeNull();
		expect(initialChangeList).not.toBeNull();

		const blockId = editor.firstBlock()!.id;
		await act(async () => {
			editor.apply(
				[
					{
						type: "splice-text",
						blockId,
						from: 0,
						to: 0,
						insert: "Hello world",
					},
				],
				{ origin: "user" },
			);
		});

		expect(container.querySelector("[data-pen-ai-diff-view]")).toBe(
			initialDiffView,
		);
		expect(container.querySelector("[data-pen-ai-change-list]")).toBe(
			initialChangeList,
		);

		await act(async () => {
			controller?.setSuggestMode(true);
			controller?.setSuggestMode(true);
			controller?.closeCommandMenu();
			controller?.dismissEphemeralSuggestion();
		});

		expect(container.querySelector("[data-pen-ai-diff-view]")).toBe(
			initialDiffView,
		);
		expect(container.querySelector("[data-pen-ai-change-list]")).toBe(
			initialChangeList,
		);

		await act(async () => {
			root.unmount();
		});
		container.remove();
	});
});
