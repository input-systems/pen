// @vitest-environment jsdom

import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import type { Editor } from "@input/pen-types";
import { afterEach, describe, expect, it } from "vitest";
import { extractTextFromDOM } from "../selectionBridge";
import {
	cleanupMountedFields,
	mountField,
} from "./fieldEditorFixtures.testHelpers";

const peers: Editor[] = [];

afterEach(() => {
	cleanupMountedFields();
	for (const peer of peers.splice(0)) peer.destroy();
});

function startComposition(inline: HTMLElement): void {
	inline.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
}

function endComposition(inline: HTMLElement, data: string): void {
	inline.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data }));
}

function insertX(editor: Editor, blockId: string, from = 0): void {
	editor.apply(
		[{ type: "splice-text", blockId, from, to: from, insert: "X" }],
		{ origin: "collaborator" },
	);
}

/**
 * Applies `X` at offset 0 of `blockId` on a second editor that shares the
 * document's state, then delivers it through `applyUpdate`, so the receiving
 * `Y.Text` observer sees `transaction.local === false` the way a provider's
 * update arrives.
 */
function applyRemoteInsert(local: Editor, blockId: string): void {
	const peer = createEditor({ schema: defaultSchema });
	peers.push(peer);
	const encode = (editor: Editor) =>
		editor.internals.adapter.encodeUpdate(editor.internals.crdtDoc);
	peer.internals.adapter.applyUpdate(peer.internals.crdtDoc, encode(local));
	peer.apply(
		[{ type: "splice-text", blockId, from: 0, to: 0, insert: "X" }],
		{ origin: "user" },
	);
	local.internals.adapter.applyUpdate(local.internals.crdtDoc, encode(peer));
}

describe("C2 contenteditable mid-composition", () => {
	it("C2: a composition in a block holding an inline atom diffs in the logical domain", () => {
		const { editor, inline, blockId } = mountField("abcd");
		editor.apply([
			{
				type: "splice-text",
				blockId,
				from: 2,
				to: 2,
				insert: { nodeType: "mention", props: { id: "1", label: "Ada" } },
			},
		]);
		expect(extractTextFromDOM(inline)).toBe("ab￼cd");
		editor.selectText(blockId, 3, 3, { origin: "keyboard" });

		startComposition(inline);
		const after = [...inline.querySelectorAll("*"), inline]
			.flatMap((element) => [...element.childNodes])
			.find((node): node is Text => node instanceof Text && node.data.includes("cd"))!;
		after.insertData(after.data.indexOf("cd"), "x");
		endComposition(inline, "x");

		const shape = editor
			.getBlock(blockId)!
			.inlineDeltas()
			.map((delta) =>
				typeof delta.insert === "string"
					? delta.insert
					: `<${(delta.insert as { type: string }).type}>`,
			);
		expect(shape).toEqual(["ab", "<mention>", "xcd"]);
		expect(editor.getBlock(blockId)!.length()).toBe(6);
		expect(extractTextFromDOM(inline)).toBe("ab￼xcd");
	});

	it("C2 COL1: contenteditable defers a delta that arrives through applyUpdate", () => {
		const { editor, inline, blockId, text } = mountField("Hello world");

		startComposition(inline);
		inline.append("ni");
		applyRemoteInsert(editor, blockId);
		endComposition(inline, "ni");

		expect(text()).toBe("XHello worldni");
		expect(extractTextFromDOM(inline)).toBe(text());
	});
});

describe("C2 EditContext rebase", () => {
	it("C2: EditContext resyncs its buffer from the document with one updateText over the changed span", () => {
		const { editor, inline, blockId, editContext, text } = mountField("Hello world", {
			editContext: true,
		});
		startComposition(inline);
		insertX(editor, blockId, 5);
		expect(editContext.text).toBe("Hello world");
		editContext.updateTextCalls.length = 0;

		endComposition(inline, "");

		expect(editContext.updateTextCalls).toEqual([[5, 5, "X"]]);
		expect(text()).toBe("HelloX world");
		expect(editContext.text).toBe(text());
		expect(extractTextFromDOM(inline)).toBe(text());
	});

	it("C2: an EditContext composition committed after a remote insert lands at its mapped range", () => {
		const { editor, inline, blockId, editContext, text } = mountField("Hello world", {
			editContext: true,
		});
		editor.selectText(blockId, 11, 11, { origin: "keyboard" });
		// Chromium: the first textupdate applies speculatively, then the
		// textformatupdate opens the composition and rewinds it into pending.
		editContext.textUpdate(11, 11, "か");
		editContext.textFormatUpdate();
		insertX(editor, blockId);
		editContext.textUpdate(11, 12, "漢");
		expect(text()).toBe("XHello world");
		endComposition(inline, "漢");

		expect(text()).toBe("XHello world漢");
		const selection = editor.selection;
		expect(selection?.type === "text" ? selection.focus.offset : null).toBe(13);
	});
});
