// @vitest-environment jsdom

import type { Editor } from "@input/pen-types";
import { afterEach, describe, expect, it } from "vitest";
import { DATA_ATTRS } from "../../utils/dataAttributes";
import { FieldEditorImpl } from "../fieldEditorImpl";
import {
	removeEditContext,
	seedParagraphs,
} from "./fieldEditorFixtures.testHelpers";

const fixtures: Array<{
	editor: Editor;
	fieldEditor: FieldEditorImpl;
	root: HTMLElement;
}> = [];

afterEach(() => {
	for (const fixture of fixtures.splice(0)) {
		fixture.fieldEditor.destroy();
		fixture.root.remove();
		fixture.editor.destroy();
	}
});

function appendBlock(
	host: HTMLElement,
	blockId: string,
	text: string,
): HTMLElement {
	const block = document.createElement("div");
	block.setAttribute(DATA_ATTRS.editorBlock, "");
	block.setAttribute(DATA_ATTRS.blockId, blockId);
	const inline = document.createElement("div");
	inline.setAttribute(DATA_ATTRS.inlineContent, "");
	inline.textContent = text;
	block.appendChild(inline);
	host.appendChild(block);
	return inline;
}

/** Two paragraphs under a blocks host, on the contenteditable backend. */
/** Two paragraphs under a blocks host, on the contenteditable backend. */
function mount() {
	removeEditContext();
	const {
		editor,
		blockIds: [first, second],
	} = seedParagraphs(["alpha", "bravo"]);
	const fieldEditor = new FieldEditorImpl(editor);
	const root = document.createElement("div");
	root.setAttribute(DATA_ATTRS.editorRoot, "");
	const host = document.createElement("div");
	host.setAttribute(DATA_ATTRS.editorBlocksHost, "");
	root.appendChild(host);
	const inline = appendBlock(host, first!, "alpha");
	appendBlock(host, second!, "bravo");
	document.body.appendChild(root);
	fieldEditor.setRootElement(root);
	fieldEditor.activate(first!);
	const projected: string[] = [];
	fieldEditor.onFocusLifecycle((event) => {
		if (event.type === "selection-projected") {
			projected.push(event.type);
		}
	});
	fixtures.push({ editor, fieldEditor, root });
	return {
		editor,
		fieldEditor,
		first: first!,
		second: second!,
		inline,
		projected,
	};
}

async function flushFrames(count = 2): Promise<void> {
	for (let index = 0; index < count; index += 1) {
		await new Promise<void>((resolve) => {
			requestAnimationFrame(() => resolve());
		});
	}
}

describe("session reconciler projection while composing (P3, C1)", () => {
	it("P3: an expanded rebuild after a remote commit on an active block is withheld while the ime window is open and projects once on compositionend-completed", async () => {
		const { editor, fieldEditor, first, second, projected } = mount();
		editor.setSelection(
			{
				type: "text",
				anchor: { blockId: first, offset: 2 },
				focus: { blockId: second, offset: 3 },
			},
			{ origin: "keyboard" },
		);
		expect(fieldEditor.getSnapshot().mode).toBe("expanded");
		fieldEditor.reader.notifyGesture("compositionstart");
		projected.length = 0;

		editor.apply(
			[
				{
					type: "splice-text",
					blockId: second,
					from: 4,
					to: 4,
					insert: "X",
				},
			],
			{ origin: "collaborator" },
		);
		await flushFrames();
		expect(projected).toHaveLength(0);

		fieldEditor.reader.notifyGesture("compositionend-completed");
		expect(projected).toHaveLength(1);
	});

	it("P3: a history rebuild of the composing single field is withheld until compositionend-completed", async () => {
		const { editor, fieldEditor, first, inline, projected } = mount();
		editor.selectText(first, 3, 3, { origin: "keyboard" });
		expect(fieldEditor.getSnapshot().mode).toBe("single");
		inline.dispatchEvent(
			new CompositionEvent("compositionstart", { bubbles: true }),
		);
		projected.length = 0;

		editor.apply(
			[
				{
					type: "splice-text",
					blockId: first,
					from: 0,
					to: 0,
					insert: "Z",
				},
			],
			{ origin: { type: "history", source: "undo" } },
		);
		await flushFrames();
		expect(projected).toHaveLength(0);

		fieldEditor.reader.notifyGesture("compositionend-completed");
		expect(projected).toHaveLength(1);
	});
});
