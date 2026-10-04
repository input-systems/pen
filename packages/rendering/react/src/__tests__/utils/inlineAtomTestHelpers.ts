import { createDefaultSchema } from "@input/pen-schema";
import { createEditor } from "@input/pen-core";
import { defaultPreset } from "@input/pen";

export async function flushAnimationFrames(count = 1): Promise<void> {
	for (let i = 0; i < count; i++) {
		await new Promise<void>((resolve) => {
			requestAnimationFrame(() => resolve());
		});
	}
}

export function createPresetEditor() {
	return createEditor({
		schema: createDefaultSchema(),
		preset: defaultPreset({
			tools: false,
			deltaStream: false,
			undo: false,
		}),
	});
}

export function seedInlineAtomDocument(
	editor: ReturnType<typeof createPresetEditor>,
) {
	const blockId = editor.firstBlock()!.id;
	editor.apply([
		{ type: "splice-text", blockId, from: 0, to: 0, insert: "A" },
		{
			type: "splice-text",
			blockId,
			from: 1,
			to: 1,
			insert: {
				nodeType: "mention",
				props: { id: "user-1", label: "Ada" },
			},
		},
		{ type: "splice-text", blockId, from: 2, to: 2, insert: "B" },
	]);
	return blockId;
}

export function dispatchPointerEvent(
	target: EventTarget,
	type: string,
	options: MouseEventInit & { pointerId?: number } = {},
) {
	const PointerEventCtor = window.PointerEvent ?? MouseEvent;
	target.dispatchEvent(
		new PointerEventCtor(type, {
			bubbles: true,
			cancelable: true,
			...options,
		}) as PointerEvent,
	);
}

export function createRect({
	left,
	right,
	top,
	bottom,
}: {
	left: number;
	right: number;
	top: number;
	bottom: number;
}): DOMRect {
	return {
		x: left,
		y: top,
		left,
		right,
		top,
		bottom,
		width: right - left,
		height: bottom - top,
		toJSON() {
			return {};
		},
	} as DOMRect;
}
