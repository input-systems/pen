// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { createEditor, fieldEditorHostFacet } from "@input/pen-core";
import { defaultPreset } from "@input/pen";
import type { FieldEditorImpl } from "@input/pen-dom/field-editor/fieldEditorImpl";
import { defaultSchema } from "@input/pen-schema";
import { DATA_ATTRS } from "@input/pen-dom/utils/dataAttributes";
import { Pen } from "../primitives/index";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function getFieldEditor(
	editor: ReturnType<typeof createEditor>,
): FieldEditorImpl {
	const fieldEditor = editor.facet(
		fieldEditorHostFacet,
	) as FieldEditorImpl | null;
	if (!fieldEditor) {
		throw new Error("Missing attached field editor");
	}
	return fieldEditor;
}

describe("@input/pen-react mount ack", () => {
	it("P1: a block acks its own mount, and a text commit does not ack every block", async () => {
		const editor = createEditor({
			schema: defaultSchema,
			preset: defaultPreset({
				tools: false,
				deltaStream: false,
				undo: false,
			}),
		});
		const blockId = editor.firstBlock()!.id;
		const acks: string[] = [];
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		try {
			await act(async () => {
				root.render(
					<Pen.Editor.Root editor={editor}>
						<Pen.Editor.Content />
					</Pen.Editor.Root>,
				);
			});

			const fieldEditor = getFieldEditor(editor);
			const original = fieldEditor.ackBlockMounted.bind(fieldEditor);
			fieldEditor.ackBlockMounted = (id, element) => {
				acks.push(id);
				original(id, element);
			};

			await act(async () => {
				editor.apply([{ type: "splice-text", blockId, from: 0, to: 0, insert: "Hi" }]);
			});
			// Same host element: nothing to acknowledge (SCALE6, W2.R4).
			expect(acks).toEqual([]);

			await act(async () => {
				editor.apply([
					{ type: "insert-block", blockId: "mounted", blockType: "paragraph", props: {}, position: "last" },
				]);
			});
			expect(acks).toEqual(["mounted"]);
			expect(
				container.querySelector(`[${DATA_ATTRS.blockId}="mounted"]`),
			).not.toBeNull();
		} finally {
			await act(async () => {
				root.unmount();
			});
			container.remove();
			editor.destroy();
		}
	});
});
