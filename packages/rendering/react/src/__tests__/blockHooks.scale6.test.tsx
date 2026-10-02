// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { createEditor, ensureInlineCompletionController, fieldEditorHostFacet } from "@input/pen-core";
import type { FieldEditorImpl } from "@input/pen-dom/field-editor/fieldEditorImpl";
import { defaultSchema } from "@input/pen-schema";
import type { DocumentOp, Editor } from "@input/pen-types";
import { Pen } from "../primitives/index";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function createDocument(blockCount: number): Editor {
	const editor = createEditor({ schema: defaultSchema });
	const ops: DocumentOp[] = [];
	for (let index = 1; index < blockCount; index += 1) {
		ops.push(
			{ type: "insert-block", blockId: `b${index}`, blockType: "paragraph", props: {}, position: "last" },
			{ type: "splice-text", blockId: `b${index}`, from: 0, to: 0, insert: `block ${index}` },
		);
	}
	editor.apply(ops);
	return editor;
}

async function mount(editor: Editor) {
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
	return {
		unmount: async () => {
			await act(async () => root.unmount());
			container.remove();
		},
	};
}

describe("SCALE6 React block hooks", () => {
	it("SCALE6: block hooks keep their subscription across renders", async () => {
		const editor = createDocument(20);
		const editorOn = editor.on.bind(editor);
		let editorRegistrations = 0;
		(editor as { on: typeof editor.on }).on = ((event: string, handler: (...args: unknown[]) => void) => {
			editorRegistrations += 1;
			return editorOn(event as never, handler as never);
		}) as typeof editor.on;
		const view = await mount(editor);
		const notifier = (editor.facet(fieldEditorHostFacet) as FieldEditorImpl).blockNotifier;
		const subscribe = notifier.subscribeBlock.bind(notifier);
		const subscriptions: string[] = [];
		notifier.subscribeBlock = (blockId, onChange) => {
			subscriptions.push(blockId);
			return subscribe(blockId, onChange);
		};
		const registrationsAfterMount = editorRegistrations;

		for (let rep = 0; rep < 10; rep += 1) {
			await act(async () => {
				editor.apply([{ type: "splice-text", blockId: "b5", from: 0, to: 0, insert: "x" }], { origin: "user" });
			});
		}
		expect(editor.getBlock("b5")?.textContent().startsWith("xxxxxxxxxx")).toBe(true);
		expect(subscriptions).toEqual([]);
		expect(editorRegistrations).toBe(registrationsAfterMount);
		await view.unmount();
		editor.destroy();
	});

	it("SCALE6: inline completion subscriptions do not scale with block count", async () => {
		const liveSubscriptions = async (blockCount: number) => {
			const editor = createDocument(blockCount);
			const { controller, release } = ensureInlineCompletionController(editor);
			const subscribe = controller.subscribe.bind(controller);
			let live = 0;
			controller.subscribe = (listener) => {
				live += 1;
				const unsubscribe = subscribe(listener);
				return () => {
					live -= 1;
					unsubscribe();
				};
			};
			const view = await mount(editor);
			const count = live;
			await view.unmount();
			release();
			editor.destroy();
			return count;
		};
		expect(await liveSubscriptions(100)).toBe(await liveSubscriptions(1_000));
	});
});
