// @vitest-environment jsdom

import { createEditor, getEditorSelectionRecord } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DATA_ATTRS } from "../../utils/dataAttributes";
import { FieldEditorImpl } from "../fieldEditorImpl";
import { focusEditorRoot } from "./focus.testHelpers";

function installMockRaf(): void {
	vi.stubGlobal(
		"requestAnimationFrame",
		(_callback: FrameRequestCallback): number => 1,
	);
}

class ProbeFieldEditor extends FieldEditorImpl {
	get lastProjectedVersion(): number {
		return this._projector.lastProjectedVersion;
	}

	get parkedProjectionVersion(): number | null {
		return this._projector.parkedProjectionVersion;
	}
}

const fixtures: Array<{
	editor: ReturnType<typeof createEditor>;
	fieldEditor: ProbeFieldEditor;
	root: HTMLElement;
}> = [];

afterEach(() => {
	while (fixtures.length > 0) {
		const fixture = fixtures.pop();
		if (!fixture) {
			break;
		}
		fixture.fieldEditor.destroy();
		fixture.root.remove();
		fixture.editor.destroy();
	}
	vi.unstubAllGlobals();
});

function mountEditor(text: string) {
	const editor = createEditor({ schema: defaultSchema });
	const fieldEditor = new ProbeFieldEditor(editor);
	const root = document.createElement("div");
	root.setAttribute(DATA_ATTRS.editorRoot, "");
	document.body.appendChild(root);
	const blockId = editor.firstBlock()!.id;
	editor.apply([
		{ type: "splice-text", blockId, from: 0, to: 0, insert: text },
	]);
	const block = document.createElement("div");
	block.setAttribute(DATA_ATTRS.editorBlock, "");
	block.setAttribute(DATA_ATTRS.blockId, blockId);
	const inline = document.createElement("div");
	inline.setAttribute(DATA_ATTRS.inlineContent, "");
	inline.textContent = text;
	block.appendChild(inline);
	root.appendChild(block);
	fieldEditor.setRootElement(root);
	focusEditorRoot(root);
	fieldEditor.activate(blockId);
	fixtures.push({ editor, fieldEditor, root });
	return { editor, fieldEditor, root, blockId, inline };
}

describe("same-turn P1", () => {
	beforeEach(() => {
		installMockRaf();
	});

	it("projects a newer record before the next task, without pumping rAF", () => {
		const { editor, fieldEditor, blockId } = mountEditor("Hello world");
		editor.selectText(blockId, 3, 3);

		expect(fieldEditor.lastProjectedVersion).toBe(
			getEditorSelectionRecord(editor)!.version,
		);
		expect(fieldEditor.parkedProjectionVersion).toBeNull();
	});
});
