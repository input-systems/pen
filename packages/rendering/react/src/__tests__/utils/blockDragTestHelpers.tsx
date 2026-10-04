import { createRoot } from "react-dom/client";
import { vi } from "vitest";
import {
	type Editor,
	generateId,
	type BlockHandle,
	type BlockRenderContext,
} from "@input/pen-types";
import React, { act, type Ref } from "react";
import { createEditor } from "@input/pen-core";
import { defaultPreset } from "@input/pen";
import { defaultSchema } from "@input/pen-schema";
import { useBlockDragHandle } from "../../hooks/useBlockDragHandle";
import type { BlockControlsProps } from "../../context/editorContext";

export type TestRenderResult = {
	container: HTMLDivElement;
	root: ReturnType<typeof createRoot>;
	unmount: () => Promise<void>;
};

export type MockDataTransfer = DataTransfer & {
	effectAllowed: string;
	dropEffect: string;
	setDragImageMock: ReturnType<typeof vi.fn>;
};

export function createDataTransfer(): MockDataTransfer {
	const data = new Map<string, string>();
	const types: string[] = [];
	const setDragImage = vi.fn();

	return {
		effectAllowed: "",
		dropEffect: "",
		types,
		setDragImage,
		setDragImageMock: setDragImage,
		files: [] as unknown as FileList,
		getData(type: string) {
			return data.get(type) ?? "";
		},
		setData(type: string, value: string) {
			data.set(type, value);
			if (!types.includes(type)) {
				types.push(type);
			}
		},
		clearData(type?: string) {
			if (type) {
				data.delete(type);
				const index = types.indexOf(type);
				if (index >= 0) {
					types.splice(index, 1);
				}
				return;
			}
			data.clear();
			types.splice(0, types.length);
		},
	} as unknown as MockDataTransfer;
}

export function createDragEvent(
	type: "dragstart" | "dragover" | "drop" | "dragend",
	dataTransfer: MockDataTransfer,
	coords: { clientX?: number; clientY?: number } = {},
): MouseEvent & { dataTransfer: DataTransfer } {
	const event = new MouseEvent(type, {
		bubbles: true,
		cancelable: true,
		clientX: coords.clientX ?? 20,
		clientY: coords.clientY ?? 20,
	}) as MouseEvent & { dataTransfer: DataTransfer };

	Object.defineProperty(event, "dataTransfer", {
		value: dataTransfer,
	});

	return event;
}

export function getBlockOrder(editor: Editor): string[] {
	return [...editor.documentState.blockOrder];
}

export function seedBlocks(editor: Editor, count: number): string[] {
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

export async function renderEditor(
	element: React.ReactElement,
): Promise<TestRenderResult> {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);

	await act(async () => {
		root.render(element);
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

export function createBlockDragEditor(
	options: Parameters<typeof createEditor>[0] = {},
) {
	return createEditor({
		schema: defaultSchema,
		...options,
		preset: defaultPreset({
			tools: false,
			deltaStream: false,
			undo: false,
		}),
	});
}

export function setBlockRect(
	container: HTMLElement,
	blockId: string,
	rect: { top: number; height?: number },
): HTMLElement {
	const element = container.querySelector(
		`[data-block-id="${blockId}"]`,
	) as HTMLElement | null;
	if (!element) {
		throw new Error(`Missing block element for ${blockId}`);
	}

	const height = rect.height ?? 40;
	element.getBoundingClientRect = () =>
		({
			top: rect.top,
			bottom: rect.top + height,
			height,
			left: 0,
			right: 300,
			width: 300,
			x: 0,
			y: rect.top,
			toJSON() {
				return {};
			},
		}) as DOMRect;

	return element;
}

export function CustomHandleParagraphRenderer(
	block: BlockHandle,
	ctx: BlockRenderContext,
): React.ReactElement {
	return <CustomHandleParagraph blockId={block.id} ctx={ctx} />;
}

export function CustomHandleParagraph(props: {
	blockId: string;
	ctx: BlockRenderContext;
}): React.ReactElement {
	const { blockId, ctx } = props;
	const { props: dragProps } = useBlockDragHandle(blockId);

	return (
		<div
			ref={ctx.ref as Ref<HTMLDivElement>}
			data-block-type="paragraph"
			data-selected={ctx.selected ? "" : undefined}
		>
			<button {...dragProps} data-testid={`custom-handle-${blockId}`}>
				Drag
			</button>
			<div data-pen-inline-content="">Paragraph</div>
		</div>
	);
}

export function GlobalHandle(props: BlockControlsProps): React.ReactElement {
	const { blockId } = props;
	const { props: dragProps } = useBlockDragHandle(blockId);

	return (
		<button {...dragProps} data-testid={`global-handle-${blockId}`}>
			Drag
		</button>
	);
}
