// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import type { DiagnosticEvent } from "@input/pen-types";
import { ContentEditableBackend } from "../contenteditableBackend";
import { extractTextFromDOM } from "../selectionBridge";
import {
	getYText,
	recordingController,
	seedParagraphs,
} from "./fieldEditorFixtures.testHelpers";

class ProbeContentEditableBackend extends ContentEditableBackend {
	invokeHandleMutations(mutations: MutationRecord[] = []): void {
		this.handleMutations(mutations);
	}
}

const cleanups: Array<() => void> = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
});

/** A contenteditable backend activated on a "Hello" paragraph. */
function mountWatchdog() {
	const {
		editor,
		blockIds: [blockId],
	} = seedParagraphs(["Hello"]);
	const diagnostics: DiagnosticEvent[] = [];
	editor.on("diagnostic", (event) => {
		diagnostics.push(event);
	});
	const divergences = () =>
		diagnostics.filter((event) => event.code === "dom-divergence");
	const backend = new ProbeContentEditableBackend(
		editor,
		recordingController(blockId!).controller,
	);
	const host = document.createElement("div");
	document.body.appendChild(host);
	cleanups.push(() => {
		backend.deactivate();
		host.remove();
		editor.destroy();
	});
	backend.activate(host, getYText(editor, blockId!));
	return { editor, blockId: blockId!, backend, host, divergences };
}

function rewriteFirstTextNode(host: HTMLElement, suffix: string): void {
	const textNode = document.createTreeWalker(host, NodeFilter.SHOW_TEXT).nextNode();
	if (!(textNode instanceof Text)) {
		throw new Error("Missing text node.");
	}
	textNode.data = `${textNode.data}${suffix}`;
}

describe("B1 mutation watchdog", () => {
	it("B1 restores Hello after a foreign text-node rewrite instead of applying it, and does not emit again once restored", () => {
		const { editor, blockId, backend, host, divergences } = mountWatchdog();
		expect(extractTextFromDOM(host)).toBe("Hello");

		rewriteFirstTextNode(host, "X");
		expect(extractTextFromDOM(host)).toBe("HelloX");
		backend.invokeHandleMutations([]);

		expect(editor.getBlock(blockId)?.textContent()).toBe("Hello");
		expect(extractTextFromDOM(host)).toBe("Hello");
		expect(divergences()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ source: "mutation-observer" }),
			]),
		);

		const afterRestore = divergences().length;
		backend.invokeHandleMutations([]);
		expect(divergences()).toHaveLength(afterRestore);
	});

	it("does not treat the activate reconcile as a foreign rewrite", () => {
		const { backend, host, divergences } = mountWatchdog();

		backend.invokeHandleMutations([]);

		expect(divergences()).toHaveLength(0);
		expect(extractTextFromDOM(host)).toBe("Hello");
	});
});
