import { createEditor } from "@input/pen-core";
import { defaultPreset } from "@input/pen";
import { defaultSchema } from "@input/pen-schema";
import { createRoot } from "react-dom/client";

export function createTestEditor() {
	return createEditor({
		schema: defaultSchema,
		preset: defaultPreset({
			tools: false,
			deltaStream: false,
			undo: false,
		}),
	});
}

export function dispatchKey(target: EventTarget, key: string): KeyboardEvent {
	const event = new KeyboardEvent("keydown", {
		key,
		bubbles: true,
		cancelable: true,
	});
	target.dispatchEvent(event);
	return event;
}

export const fixtures: Array<{
	container: HTMLElement;
	editor: ReturnType<typeof createTestEditor>;
	root: ReturnType<typeof createRoot>;
}> = [];
