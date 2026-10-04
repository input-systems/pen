// @vitest-environment jsdom

import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRootGeometry } from "../../geometry/rootGeometry";
import { FieldEditorImpl } from "../fieldEditorImpl";
import { focusEditorRoot } from "./focus.testHelpers";

let frameQueue: FrameRequestCallback[] = [];

function installMockRaf(): void {
	frameQueue = [];
	vi.stubGlobal(
		"requestAnimationFrame",
		(callback: FrameRequestCallback): number => {
			frameQueue.push(callback);
			return frameQueue.length;
		},
	);
}

class ProbeFieldEditor extends FieldEditorImpl {
	skipBackendWrite: boolean[] = [];

	protected override _recomputeSurfaceFromSelection(options?: {
		syncSelectionToBackend?: boolean;
		skipBackendWrite?: boolean;
	}): void {
		this.skipBackendWrite.push(options?.skipBackendWrite === true);
		super._recomputeSurfaceFromSelection(options);
	}

	get lastProjectedVersion(): number {
		return this.projector.lastProjectedVersion;
	}

	setLastProjectedVersion(version: number): void {
		this.projector.recordProjectedVersion(version);
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

describe("P1 double-write gate", () => {
	beforeEach(() => {
		installMockRaf();
	});

	it("does not skip the v1 backend write when P1 did not deliver", () => {
		const editor = createEditor({ schema: defaultSchema });
		const fieldEditor = new ProbeFieldEditor(editor);
		const root = document.createElement("div");
		document.body.appendChild(root);
		fixtures.push({ editor, fieldEditor, root });
		fieldEditor.setRootElement(root);
		focusEditorRoot(root);

		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "Hi",
			},
		]);
		editor.selectText(blockId, 0, 0);
		fieldEditor.skipBackendWrite = [];
		editor.selectText(blockId, 2, 2);

		const { scheduler } = getRootGeometry(root);
		expect(scheduler.phase).toBe("idle");
		expect(fieldEditor.skipBackendWrite).toEqual([true, false]);
	});

	it("keeps lastProjectedVersion across a session switch", () => {
		const editor = createEditor({ schema: defaultSchema });
		const fieldEditor = new ProbeFieldEditor(editor);
		const root = document.createElement("div");
		document.body.appendChild(root);
		fixtures.push({ editor, fieldEditor, root });
		fieldEditor.setRootElement(root);
		focusEditorRoot(root);

		const firstBlockId = editor.firstBlock()!.id;
		editor.apply([
			{
				type: "insert-block",
				blockId: "second",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
		]);
		fieldEditor.activate(firstBlockId);
		fieldEditor.setLastProjectedVersion(4);

		fieldEditor.activate("second");
		expect(fieldEditor.lastProjectedVersion).toBe(4);
	});
});
