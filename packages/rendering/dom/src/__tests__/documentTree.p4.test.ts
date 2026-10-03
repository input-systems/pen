// @vitest-environment jsdom

import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountEditor } from "../host/mountEditor";
import { DATA_ATTRS } from "../utils/dataAttributes";

const cleanups: Array<() => void> = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
	document.body.replaceChildren();
});

function mount() {
	const editor = createEditor({ schema: defaultSchema });
	const root = document.createElement("div");
	document.body.append(root);
	const mounted = mountEditor(editor, root);
	cleanups.push(() => {
		mounted.destroy();
		editor.destroy();
	});
	return { editor, mounted };
}

describe("vanilla document tree mount acks (W3.R8)", () => {
	it("P4: the vanilla tree acks each block element it creates, connected, in the commit's turn", () => {
		const { editor, mounted } = mount();
		const ack = vi.spyOn(mounted.fieldEditor, "ackBlockMounted");

		editor.apply([
			{
				type: "insert-block",
				blockId: "added",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
		]);

		const acked = ack.mock.calls.filter(([blockId]) => blockId === "added");
		expect(acked).toHaveLength(1);
		const element = acked[0]![1];
		expect(element.isConnected).toBe(true);
		expect(element.getAttribute(DATA_ATTRS.blockId)).toBe("added");
	});

	it("P4: a selection written to a block before it mounts is projected by that block's ack", () => {
		const { editor, mounted } = mount();
		const fieldEditor = mounted.fieldEditor as unknown as {
			_projector: { lastProjectedVersion: number };
		};

		editor.apply([
			{
				type: "insert-block",
				blockId: "added",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: "added",
				from: 0,
				to: 0,
				insert: "Hi",
			},
		]);
		mounted.fieldEditor.activateTextSelection("added", 2, 2);

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: "added", offset: 2 },
		});
		expect(fieldEditor._projector.lastProjectedVersion).toBeGreaterThan(0);
	});
});
