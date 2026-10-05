import { createEditor } from "@input/pen-core";
import { defaultPreset } from "@input/pen";
import { defaultSchema } from "@input/pen-schema";

export async function flushAnimationFrames(count = 1): Promise<void> {
	for (let i = 0; i < count; i++) {
		await new Promise<void>((resolve) => {
			requestAnimationFrame(() => resolve());
		});
	}
}

export function createMouseEvent(
	type: "mousedown" | "mousemove" | "mouseup",
	clientX: number,
	clientY: number,
): MouseEvent {
	return new MouseEvent(type, {
		bubbles: true,
		cancelable: true,
		button: 0,
		buttons: type === "mouseup" ? 0 : 1,
		clientX,
		clientY,
	});
}

export function setRect(
	element: Element,
	left: number,
	top: number,
	width: number,
	height: number,
): void {
	Object.defineProperty(element, "getBoundingClientRect", {
		configurable: true,
		value: () => new DOMRect(left, top, width, height),
	});
}

export function createThreeBlockEditor() {
	const editor = createEditor({
		schema: defaultSchema,
		preset: defaultPreset({
			tools: false,
			deltaStream: false,
			undo: false,
		}),
	});
	const firstBlockId = editor.firstBlock()!.id;
	const secondBlockId = crypto.randomUUID();
	const thirdBlockId = crypto.randomUUID();

	editor.apply([
		{
			type: "splice-text",
			blockId: firstBlockId,
			from: 0,
			to: 0,
			insert: "First",
		},
		{
			type: "insert-block",
			blockId: secondBlockId,
			blockType: "paragraph",
			props: {},
			position: { after: firstBlockId },
		},
		{
			type: "splice-text",
			blockId: secondBlockId,
			from: 0,
			to: 0,
			insert: "Second",
		},
		{
			type: "insert-block",
			blockId: thirdBlockId,
			blockType: "paragraph",
			props: {},
			position: { after: secondBlockId },
		},
		{
			type: "splice-text",
			blockId: thirdBlockId,
			from: 0,
			to: 0,
			insert: "Third",
		},
	]);

	return { editor, firstBlockId, secondBlockId, thirdBlockId };
}
