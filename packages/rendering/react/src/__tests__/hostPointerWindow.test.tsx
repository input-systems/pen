// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import {
	createEditor as createCoreEditor,
	fieldEditorHostFacet,
} from "@input/pen-core";
import type { FieldEditorImpl } from "@input/pen-dom/field-editor/fieldEditorImpl";
import { defaultPreset } from "@input/pen";
import { defaultSchema } from "@input/pen-schema";
import { describe, expect, it } from "vitest";
import { Pen } from "../primitives/index";
import { fieldEditorInternals } from "./utils/fieldEditorInternals";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function createEditor() {
	return createCoreEditor({
		schema: defaultSchema,
		preset: defaultPreset({
			tools: false,
			deltaStream: false,
			undo: false,
		}),
	});
}

describe("@input/pen-react host pointer window", () => {
	it("opens the pointer window from root pointerdown without a host gesture notification", async () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "Hello" },
		]);
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);
		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});
		const fieldEditor = editor.facet(
			fieldEditorHostFacet,
		) as FieldEditorImpl | null;
		if (!fieldEditor) {
			throw new Error("Missing attached field editor");
		}
		expect(
			fieldEditorInternals(fieldEditor).reader.isAdmissibleRead(),
		).toBe(false);
		const inline = container.querySelector(
			"[data-pen-inline-content]",
		) as HTMLElement | null;
		expect(inline).not.toBeNull();
		await act(async () => {
			inline!.dispatchEvent(
				new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
			);
		});
		expect(
			fieldEditorInternals(fieldEditor).reader.isAdmissibleRead(),
		).toBe(true);
		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});
});
