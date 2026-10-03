// @vitest-environment jsdom

import { createEditor, createHeadlessEditor } from "@input/pen-core";
import { afterEach, describe, expect, it } from "vitest";

import { bindEditorAnnouncer } from "../bindEditorAnnouncer";
import { FieldEditorImpl } from "../../field-editor/fieldEditorImpl";
import { getRootGeometry } from "../../geometry/rootGeometry";
import { defaultSchema } from "@input/pen-schema";
import { undoExtension } from "@input/pen-undo";

const fixtures: Array<{
	stop?: () => void;
	fieldEditor?: FieldEditorImpl;
	root: HTMLElement;
	editor: ReturnType<typeof createHeadlessEditor>;
}> = [];

afterEach(() => {
	while (fixtures.length > 0) {
		const fixture = fixtures.pop();
		if (!fixture) {
			break;
		}
		fixture.stop?.();
		fixture.fieldEditor?.destroy();
		fixture.root.remove();
		void fixture.editor.destroy();
	}
});

/** Each announcement is a scheduler write: an empty write settles after it. */
function flushed(root: HTMLElement): Promise<void> {
	return getRootGeometry(root).scheduler.write(() => {});
}

function liveRegion(root: ParentNode): HTMLElement | null {
	return root.querySelector('[role="status"]');
}

describe("bindEditorAnnouncer (AX2)", () => {
	it("AX2: convert-block writes live-region text from the catalog", async () => {
		const editor = createHeadlessEditor({ schema: defaultSchema });
		const root = document.createElement("div");
		document.body.appendChild(root);
		const stop = bindEditorAnnouncer(editor, root);
		fixtures.push({ editor, root, stop });

		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{
				type: "set-props",
				blockId,
				props: { type: "heading", level: 1 },
			},
		]);

		await flushed(root);
		expect(liveRegion(root)?.textContent).toBe("Converted to Heading");
	});

	it("AX2: announcement text comes from pen.messages, not a hardcoded string", async () => {
		const editor = createHeadlessEditor({
			schema: defaultSchema,
			messages: {
				"pen.a11y.blockConverted": "TEST-converted {blockType}",
			},
		});
		const root = document.createElement("div");
		document.body.appendChild(root);
		const stop = bindEditorAnnouncer(editor, root);
		fixtures.push({ editor, root, stop });

		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{
				type: "set-props",
				blockId,
				props: { type: "heading", level: 1 },
			},
		]);

		await flushed(root);
		expect(liveRegion(root)?.textContent).toBe("TEST-converted Heading");
	});

	it("AX2: block selection enter and change announce counts", async () => {
		const editor = createHeadlessEditor({ schema: defaultSchema });
		const root = document.createElement("div");
		document.body.appendChild(root);
		const stop = bindEditorAnnouncer(editor, root);
		fixtures.push({ editor, root, stop });

		const firstId = editor.firstBlock()!.id;
		editor.apply([
			{
				type: "insert-block",
				blockId: "b2",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
		]);
		editor.selectBlocks([firstId]);
		await flushed(root);
		expect(liveRegion(root)?.textContent).toBe("1 block selected");

		editor.selectBlocks([firstId, "b2"]);
		await flushed(root);
		expect(liveRegion(root)?.textContent).toBe("2 blocks selected");
	});

	it("AX2: undo and redo announce a content hint", async () => {
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [undoExtension()],
		});
		const root = document.createElement("div");
		document.body.appendChild(root);
		const stop = bindEditorAnnouncer(editor, root);
		fixtures.push({ editor, root, stop });

		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "hello" },
		]);
		editor.undoManager.undo();
		await flushed(root);
		expect(liveRegion(root)?.textContent).toBe("Undid Paragraph");

		editor.undoManager.redo();
		await flushed(root);
		expect(liveRegion(root)?.textContent).toBe("Redid Paragraph");
	});

	it("AX2: empty-document text caret does not write the live region", async () => {
		const editor = createHeadlessEditor({ schema: defaultSchema });
		const root = document.createElement("div");
		document.body.appendChild(root);
		const stop = bindEditorAnnouncer(editor, root);
		fixtures.push({ editor, root, stop });

		const first = editor.firstBlock();
		expect(first).not.toBeNull();
		editor.selectText(first!.id, 0, 0);

		// Pointer activation on an empty document ends here: text caret,
		// no atom. AX2 must stay silent. What AT speaks for the empty
		// textbox is a real-AT question (MANUAL.md scenario 2).
		await flushed(root);
		expect(liveRegion(root)?.textContent ?? "").toBe("");
	});

	it("AX2: bindEditorAnnouncer writes the live region inside the root scheduler's write phase", async () => {
		const editor = createHeadlessEditor({ schema: defaultSchema });
		const root = document.createElement("div");
		document.body.appendChild(root);
		const stop = bindEditorAnnouncer(editor, root);
		fixtures.push({ editor, root, stop });
		const region = liveRegion(root)!;
		const phases: string[] = [];
		const scheduler = getRootGeometry(root).scheduler;
		const originalWrite = scheduler.write.bind(scheduler);
		scheduler.write = (fn) =>
			originalWrite(() => {
				phases.push(scheduler.phase);
				fn();
			});

		editor.apply([
			{ type: "set-props", blockId: editor.firstBlock()!.id, props: { type: "heading", level: 1 } },
		]);
		expect(region.textContent, "nothing is written in the commit turn").toBe("");

		await flushed(root);
		scheduler.write = originalWrite;
		expect(region.textContent).toBe("Converted to Heading");
		expect(phases[0], "the announcement ran in the write phase").toBe("write");
	});

	it("AX2: FieldEditorImpl mounts the live region on the editor root", () => {
		const editor = createHeadlessEditor({ schema: defaultSchema });
		const fieldEditor = new FieldEditorImpl(editor);
		const root = document.createElement("div");
		document.body.appendChild(root);
		fixtures.push({ editor, root, fieldEditor });

		fieldEditor.setRootElement(root);
		expect(liveRegion(root)).not.toBeNull();

		fieldEditor.destroy();
		expect(liveRegion(root)).toBeNull();
	});
});
