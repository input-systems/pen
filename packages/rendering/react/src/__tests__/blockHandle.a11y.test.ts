// @vitest-environment jsdom

import { act, createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { createEditor } from "@input/pen-core";
import { generateId } from "@input/pen-types";
import { defaultPreset } from "@input/pen";
import { Pen } from "../primitives/index";
import { defaultSchema } from "@input/pen-schema";
import {
	PEN_MOVE_BLOCK_DOWN,
	PEN_MOVE_BLOCK_UP,
	type BlockHandleMoveCommand,
} from "../primitives/editor/blockHandle";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function createHandleEditor() {
	return createEditor({
		schema: defaultSchema,
		preset: defaultPreset({
			tools: false,
			deltaStream: false,
			undo: false,
		}),
	});
}

function seedBlocks(
	editor: ReturnType<typeof createEditor>,
	count: number,
): string[] {
	const ids = [editor.firstBlock()!.id];
	for (let index = 1; index < count; index += 1) {
		const blockId = generateId();
		editor.apply([
			{
				type: "insert-block",
				blockId,
				blockType: "paragraph",
				props: {},
				position: "last",
			},
		]);
		ids.push(blockId);
	}
	return ids;
}

async function renderHandle(options: {
	editor: ReturnType<typeof createEditor>;
	blockId: string;
	onMoveBlock?: (command: BlockHandleMoveCommand, blockId: string) => void;
}): Promise<{
	container: HTMLDivElement;
	root: Root;
	unmount: () => Promise<void>;
}> {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);

	await act(async () => {
		root.render(
			createElement(
				Pen.Editor.Root,
				{ editor: options.editor },
				createElement(Pen.Editor.BlockHandle, {
					blockId: options.blockId,
					onMoveBlock: options.onMoveBlock,
				}),
			),
		);
	});

	return {
		container,
		root,
		unmount: async () => {
			await act(async () => {
				root.unmount();
			});
			container.remove();
		},
	};
}

function MoveHandle({ blockId }: { blockId: string }) {
	return createElement(Pen.Editor.BlockHandle, { blockId });
}

async function renderDocumentWithHandles(
	editor: ReturnType<typeof createEditor>,
): Promise<{ container: HTMLDivElement; unmount: () => Promise<void> }> {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);

	await act(async () => {
		root.render(
			createElement(
				Pen.Editor.Root,
				{ editor, blockControls: MoveHandle },
				createElement(Pen.Editor.Content),
			),
		);
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

function queryHandle(container: HTMLElement, blockId: string): HTMLElement {
	const handle = container.querySelector<HTMLElement>(
		`[data-pen-block-handle][data-block-id="${blockId}"]`,
	);
	if (!handle) {
		throw new Error(`Missing block handle for ${blockId}`);
	}
	return handle;
}

function getHandle(container: HTMLElement): HTMLElement {
	const handle = container.querySelector(
		"[data-pen-block-handle]",
	) as HTMLElement | null;
	if (!handle) {
		throw new Error("Missing block handle");
	}
	return handle;
}

function dispatchKey(target: EventTarget, key: string): void {
	target.dispatchEvent(
		new KeyboardEvent("keydown", {
			key,
			bubbles: true,
			cancelable: true,
		}),
	);
}

describe("@input/pen-react block handle AX3", () => {
	it("AX3: exposes aria-haspopup for the drag-handle menu", async () => {
		const editor = createHandleEditor();
		const blockId = editor.firstBlock()!.id;
		const view = await renderHandle({ editor, blockId });

		const handle = getHandle(view.container);
		expect(handle.getAttribute("aria-haspopup")).toBe("menu");
		expect(handle.getAttribute("role")).toBe("button");
		expect(handle.getAttribute("aria-expanded")).toBe("false");
		expect(
			view.container.querySelector("[data-pen-block-handle-menu]"),
		).toBeNull();

		await view.unmount();
		editor.destroy();
	});

	it.each([
		["Enter", "Enter"],
		["Space", " "],
	])("AX3: %s opens the drag-handle menu with role=menu", async (_name, key) => {
		const editor = createHandleEditor();
		const blockId = editor.firstBlock()!.id;
		const view = await renderHandle({ editor, blockId });

		const handle = getHandle(view.container);
		await act(async () => {
			handle.focus();
			dispatchKey(handle, key);
		});

		const menu = view.container.querySelector(
			"[data-pen-block-handle-menu]",
		);
		expect(menu?.getAttribute("role")).toBe("menu");
		expect(handle.getAttribute("aria-expanded")).toBe("true");
		expect(handle.getAttribute("aria-controls")).toBe(menu?.id);
		for (const command of [PEN_MOVE_BLOCK_UP, PEN_MOVE_BLOCK_DOWN]) {
			expect(
				menu?.querySelector(`[data-pen-command="${command}"]`)?.getAttribute("role"),
			).toBe("menuitem");
		}

		await view.unmount();
		editor.destroy();
	});

	it("AX3: move items dispatch pen.moveBlockUp/Down callbacks", async () => {
		const editor = createHandleEditor();
		const blockId = editor.firstBlock()!.id;
		const onMoveBlock = vi.fn();
		const view = await renderHandle({ editor, blockId, onMoveBlock });

		const handle = getHandle(view.container);
		await act(async () => {
			handle.focus();
			dispatchKey(handle, "Enter");
		});

		const moveUp = view.container.querySelector(
			`[data-pen-command="${PEN_MOVE_BLOCK_UP}"]`,
		) as HTMLElement | null;
		const moveDown = view.container.querySelector(
			`[data-pen-command="${PEN_MOVE_BLOCK_DOWN}"]`,
		) as HTMLElement | null;
		expect(moveUp).not.toBeNull();
		expect(moveDown).not.toBeNull();

		await act(async () => {
			moveUp?.click();
		});
		expect(onMoveBlock).toHaveBeenCalledWith(PEN_MOVE_BLOCK_UP, blockId);

		await act(async () => {
			handle.focus();
			dispatchKey(handle, "Enter");
		});
		await act(async () => {
			view.container
				.querySelector(`[data-pen-command="${PEN_MOVE_BLOCK_DOWN}"]`)
				?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(onMoveBlock).toHaveBeenCalledWith(PEN_MOVE_BLOCK_DOWN, blockId);

		await view.unmount();
		editor.destroy();
	});

	it("LOC1: move item labels come from the catalog and host overrides win", async () => {
		const editor = createEditor({
			schema: defaultSchema,
			preset: defaultPreset({
				tools: false,
				deltaStream: false,
				undo: false,
			}),
			messages: {
				"pen.blockHandle.moveUp": "Nach oben",
				"pen.blockHandle.moveDown": "Nach unten",
			},
		});
		const blockId = editor.firstBlock()!.id;
		const view = await renderHandle({ editor, blockId });

		const handle = getHandle(view.container);
		await act(async () => {
			handle.focus();
			dispatchKey(handle, "Enter");
		});

		expect(
			view.container.querySelector(
				`[data-pen-command="${PEN_MOVE_BLOCK_UP}"]`,
			)?.textContent,
		).toBe("Nach oben");
		expect(
			view.container.querySelector(
				`[data-pen-command="${PEN_MOVE_BLOCK_DOWN}"]`,
			)?.textContent,
		).toBe("Nach unten");

		await view.unmount();
		editor.destroy();
	});

	it("AX3: move items apply adjacent move-block ops when no callback is wired", async () => {
		const editor = createHandleEditor();
		const [firstId, secondId] = seedBlocks(editor, 2);
		const view = await renderHandle({ editor, blockId: firstId });

		const handle = getHandle(view.container);
		await act(async () => {
			handle.focus();
			dispatchKey(handle, "Enter");
		});
		await act(async () => {
			view.container
				.querySelector(`[data-pen-command="${PEN_MOVE_BLOCK_DOWN}"]`)
				?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});

		expect([...editor.documentState.blockOrder]).toEqual([
			secondId,
			firstId,
		]);

		await view.unmount();
		editor.destroy();
	});

	it("AX3: moving a block from the handle menu returns focus to that block's handle without a microtask", async () => {
		const editor = createHandleEditor();
		const [firstId, secondId] = seedBlocks(editor, 2);
		const view = await renderDocumentWithHandles(editor);

		const handle = queryHandle(view.container, secondId!);
		await act(async () => {
			handle.focus();
			dispatchKey(handle, "Enter");
		});
		const moveUp = view.container.querySelector<HTMLElement>(
			`[data-pen-command="${PEN_MOVE_BLOCK_UP}"]`,
		);
		expect(document.activeElement).toBe(moveUp);

		// Synchronous act: effects flush, microtasks do not.
		act(() => {
			moveUp!.click();
		});

		expect([...editor.documentState.blockOrder]).toEqual([
			secondId,
			firstId,
		]);
		expect(
			view.container.querySelector("[data-pen-block-handle-menu]"),
		).toBeNull();
		expect(document.activeElement).toBe(
			queryHandle(view.container, secondId!),
		);

		await view.unmount();
		editor.destroy();
	});

	it("AX3: Escape in the handle menu returns focus to the handle", async () => {
		const editor = createHandleEditor();
		const [, secondId] = seedBlocks(editor, 2);
		const view = await renderDocumentWithHandles(editor);

		const handle = queryHandle(view.container, secondId!);
		await act(async () => {
			handle.focus();
			dispatchKey(handle, "Enter");
		});
		const moveUp = view.container.querySelector<HTMLElement>(
			`[data-pen-command="${PEN_MOVE_BLOCK_UP}"]`,
		);
		expect(document.activeElement).toBe(moveUp);

		act(() => {
			dispatchKey(moveUp!, "Escape");
		});

		expect(
			view.container.querySelector("[data-pen-block-handle-menu]"),
		).toBeNull();
		expect(document.activeElement).toBe(handle);

		await view.unmount();
		editor.destroy();
	});
});
