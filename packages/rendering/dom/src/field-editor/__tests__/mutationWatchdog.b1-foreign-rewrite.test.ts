// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import type { DiagnosticEvent } from "@input/pen-types";
import type { FieldEditorInputController } from "../controller";
import type { FieldEditorTextLike } from "../crdt";
import { ContentEditableBackend } from "../contenteditableBackend";
import { extractTextFromDOM } from "../selectionBridge";

function getYText(
	editor: ReturnType<typeof createEditor>,
	blockId: string,
): FieldEditorTextLike {
	const adapter = editor.internals.adapter;
	const doc = editor.internals.crdtDoc;
	const ydoc = adapter.raw<{
		getMap(name: string): {
			get(key: string): { get(field: string): unknown } | undefined;
		};
	}>(doc);
	const ytext = ydoc
		.getMap("blocks")
		.get(blockId)
		?.get("content") as FieldEditorTextLike | null;
	if (!ytext) {
		throw new Error(`Missing test Y.Text for block ${blockId}`);
	}
	return ytext;
}

function createFieldEditor(blockId: string) {
	return {
		focusBlockId: blockId,
		inputMode: "richtext" as const,
		activeCellCoord: null,
		activateCell: () => {},
		activateTextSelection: () => {},
		commitProgrammaticTextSelection: () => {},
		deactivate: () => {},
		selectAllBehavior: "block-first" as const,
		resolveInsertMarks: () => undefined,
		resetBackendSelectionAuthority: () => {},
		withBackendSelectionWrite: <T>(write: () => T) => write(),
		setComposing: () => {},
		notifyDomReconciled: () => {},
		requestDomFocus: () => false,
		getBackendSelectionApplicationDepth: () => 0,
		applyDomTextSelection: () => {},
		applyDocumentTextSelection: () => {},
		syncTextSelection: () => {},
		setBackendSelectionAuthority: () => {},
		getBackendSelectionAuthority: () => null,
		hasBackendSelectionAuthority: () => false,
		clearBackendSelectionAuthority: () => {},
		setEditContextSelectionSnapshot: () => {},
		getEditContextSelectionSnapshot: () => null,
		notifyGestureEvent: () => {},
	};
}

class ProbeContentEditableBackend extends ContentEditableBackend {
	invokeHandleMutations(mutations: MutationRecord[] = []): void {
		this.handleMutations(mutations);
	}
}

function rewriteFirstTextNode(host: HTMLElement, suffix: string): void {
	const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
	const textNode = walker.nextNode();
	if (!(textNode instanceof Text)) {
		throw new Error("Missing text node.");
	}
	textNode.data = `${textNode.data}${suffix}`;
}

describe("B1 mutation watchdog", () => {
	it("B1 restores Hello after a foreign text-node rewrite instead of applying it", () => {
		const editor = createEditor({ schema: defaultSchema });
		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "Hello" },
		]);

		const diagnostics: DiagnosticEvent[] = [];
		editor.on("diagnostic", (event) => {
			diagnostics.push(event);
		});

		const backend = new ProbeContentEditableBackend(
			editor,
			createFieldEditor(blockId) as unknown as FieldEditorInputController,
		);
		const host = document.createElement("div");
		document.body.appendChild(host);

		try {
			backend.activate(host, getYText(editor, blockId));
			expect(editor.getBlock(blockId)?.textContent()).toBe("Hello");
			expect(extractTextFromDOM(host)).toBe("Hello");

			rewriteFirstTextNode(host, "X");
			expect(extractTextFromDOM(host)).toBe("HelloX");

			backend.invokeHandleMutations([]);

			expect(editor.getBlock(blockId)?.textContent()).toBe("Hello");
			expect(extractTextFromDOM(host)).toBe("Hello");
			expect(diagnostics).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						code: "dom-divergence",
						source: "mutation-observer",
					}),
				]),
			);
		} finally {
			backend.deactivate();
			host.remove();
			editor.destroy();
		}
	});

	it("does not emit again when the restore already matches the model", () => {
		const editor = createEditor({ schema: defaultSchema });
		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "Hello" },
		]);

		const diagnostics: DiagnosticEvent[] = [];
		editor.on("diagnostic", (event) => {
			diagnostics.push(event);
		});

		const backend = new ProbeContentEditableBackend(
			editor,
			createFieldEditor(blockId) as unknown as FieldEditorInputController,
		);
		const host = document.createElement("div");
		document.body.appendChild(host);

		try {
			backend.activate(host, getYText(editor, blockId));
			rewriteFirstTextNode(host, "X");
			backend.invokeHandleMutations([]);
			const afterRestore = diagnostics.filter(
				(event) => event.code === "dom-divergence",
			).length;
			expect(afterRestore).toBeGreaterThan(0);
			expect(extractTextFromDOM(host)).toBe("Hello");

			backend.invokeHandleMutations([]);
			expect(
				diagnostics.filter((event) => event.code === "dom-divergence"),
			).toHaveLength(afterRestore);
		} finally {
			backend.deactivate();
			host.remove();
			editor.destroy();
		}
	});

	it("does not treat the activate reconcile as a foreign rewrite", () => {
		const editor = createEditor({ schema: defaultSchema });
		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "Hello" },
		]);

		const diagnostics: DiagnosticEvent[] = [];
		editor.on("diagnostic", (event) => {
			diagnostics.push(event);
		});

		const backend = new ProbeContentEditableBackend(
			editor,
			createFieldEditor(blockId) as unknown as FieldEditorInputController,
		);
		const host = document.createElement("div");
		document.body.appendChild(host);

		try {
			backend.activate(host, getYText(editor, blockId));
			backend.invokeHandleMutations([]);
			expect(
				diagnostics.filter((event) => event.code === "dom-divergence"),
			).toHaveLength(0);
			expect(extractTextFromDOM(host)).toBe("Hello");
		} finally {
			backend.deactivate();
			host.remove();
			editor.destroy();
		}
	});
});
