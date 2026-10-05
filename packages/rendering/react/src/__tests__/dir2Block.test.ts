// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
import { defaultPreset } from "@input/pen";
import { Pen } from "../primitives/index";
import { defaultSchema } from "@input/pen-schema";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function createDirEditor() {
	return createEditor({
		schema: defaultSchema,
		preset: defaultPreset({
			tools: false,
			deltaStream: false,
			undo: false,
		}),
	});
}

async function renderEditor(editor: ReturnType<typeof createDirEditor>) {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);

	await act(async () => {
		root.render(
			createElement(
				Pen.Editor.Root,
				{ editor },
				createElement(Pen.Editor.Content),
			),
		);
	});

	return { container, root };
}

async function cleanup(
	editor: ReturnType<typeof createDirEditor>,
	root: ReturnType<typeof createRoot>,
	container: HTMLElement,
) {
	await act(async () => {
		root.unmount();
	});
	container.remove();
	editor.destroy();
}

describe("@input/pen-react DIR2", () => {
	it("renders validated block text alignment", async () => {
		const editor = createDirEditor();
		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{
				type: "set-props",
				blockId,
				props: { textAlignment: "center" },
			},
		]);

		const { container, root } = await renderEditor(editor);
		expect(
			container.querySelector<HTMLElement>(
				`[data-block-id="${blockId}"]`,
			)?.style.textAlign,
		).toBe("center");

		await cleanup(editor, root, container);
	});
});
