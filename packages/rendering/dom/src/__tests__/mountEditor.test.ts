// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
	createEditor,
	fieldEditorHostFacet,
	getVerticalCaretMeasure,
} from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import type { Editor } from "@input/pen-types";
import { mountEditor } from "../host/mountEditor";
import { FOCUS_SINK_ATTR } from "../a11y/focusSink";
import { DATA_ATTRS } from "../utils/dataAttributes";

const noDefaultExtensionsPreset = {
	resolve() {
		return { extensions: [] };
	},
};

function createBareEditor(): Editor {
	return createEditor({
		schema: defaultSchema,
		preset: noDefaultExtensionsPreset,
	});
}

describe("mountEditor", () => {
	const cleanups: Array<() => void> = [];

	afterEach(() => {
		for (const cleanup of cleanups.splice(0)) {
			cleanup();
		}
		document.body.replaceChildren();
	});

	it("composes the same editor-root and inline-content shell the bindings mount", () => {
		const editor = createBareEditor();
		const root = document.createElement("div");
		document.body.append(root);
		const mounted = mountEditor(editor, root);
		cleanups.push(() => {
			mounted.destroy();
			editor.destroy();
		});

		expect(root.getAttribute("role")).toBe("textbox");
		expect(root.getAttribute("aria-label")).toBe("Editor");
		expect(root.hasAttribute(DATA_ATTRS.editorRoot)).toBe(true);
		expect(root.querySelector("[data-pen-editor-content]")).toBeTruthy();
		expect(
			root.querySelector("[data-pen-editor-blocks-host]"),
		).toBeTruthy();

		const inline = root.querySelector(`[${DATA_ATTRS.inlineContent}]`);
		expect(inline).toBeInstanceOf(HTMLElement);
		const placeholder = inline?.querySelector(`[${DATA_ATTRS.emptyBlock}]`);
		expect(placeholder?.tagName).toBe("BR");
		expect(placeholder?.getAttribute(DATA_ATTRS.emptyBlock)).toBe("");
		expect(inline?.textContent).toBe("");
		expect(editor.facet(fieldEditorHostFacet)).toBe(mounted.fieldEditor);
	});

	it("activates FieldEditorImpl on inline pointer down", () => {
		const editor = createBareEditor();
		const firstBlock = editor.firstBlock();
		expect(firstBlock).toBeTruthy();
		const root = document.createElement("div");
		document.body.append(root);
		const mounted = mountEditor(editor, root);
		cleanups.push(() => {
			mounted.destroy();
			editor.destroy();
		});

		const inline = root.querySelector(`[${DATA_ATTRS.inlineContent}]`);
		expect(inline).toBeInstanceOf(HTMLElement);
		inline?.dispatchEvent(
			new MouseEvent("mousedown", { bubbles: true, button: 0 }),
		);

		expect(mounted.fieldEditor.focusBlockId).toBe(firstBlock?.id);
		expect(mounted.fieldEditor.isEditing).toBe(true);
		expect(
			root
				.querySelector(`[${DATA_ATTRS.editorBlock}]`)
				?.getAttribute(DATA_ATTRS.focused),
		).toBe("");
	});

	it("AX1: enters the text field when the root receives keyboard focus", async () => {
		const editor = createBareEditor();
		const root = document.createElement("div");
		document.body.append(root);
		const mounted = mountEditor(editor, root);
		cleanups.push(() => {
			mounted.destroy();
			editor.destroy();
		});

		expect(root.tabIndex).toBe(0);
		root.focus();
		await mounted.fieldEditor.waitForAttachment();

		expect(root.tabIndex).toBe(-1);
		expect(mounted.fieldEditor.focusBlockId).toBe(editor.firstBlock()?.id);
		expect(mounted.fieldEditor.isEditing).toBe(true);
		expect(document.activeElement).not.toBe(root);
		expect((document.activeElement as HTMLElement).tabIndex).toBe(-1);
		expect(
			document.activeElement?.closest(`[${DATA_ATTRS.inlineContent}]`),
		).not.toBeNull();
	});

	it("AX1: keeps keyboard focus on a readonly root", () => {
		const editor = createBareEditor();
		const root = document.createElement("div");
		document.body.append(root);
		const mounted = mountEditor(editor, root, { readonly: true });
		cleanups.push(() => {
			mounted.destroy();
			editor.destroy();
		});

		root.focus();

		expect(document.activeElement).toBe(root);
		expect(mounted.fieldEditor.isEditing).toBe(false);
	});

	it("activates FieldEditorImpl when the pointer hits the block, not the inline", () => {
		const editor = createBareEditor();
		const firstBlock = editor.firstBlock();
		expect(firstBlock).toBeTruthy();
		const root = document.createElement("div");
		document.body.append(root);
		const mounted = mountEditor(editor, root);
		cleanups.push(() => {
			mounted.destroy();
			editor.destroy();
		});

		const paragraph = root.querySelector("[data-block-type='paragraph']");
		const inline = root.querySelector(`[${DATA_ATTRS.inlineContent}]`);
		expect(paragraph).toBeInstanceOf(HTMLElement);
		expect(paragraph).not.toBe(inline);
		paragraph?.dispatchEvent(
			new MouseEvent("mousedown", { bubbles: true, button: 0 }),
		);

		expect(mounted.fieldEditor.focusBlockId).toBe(firstBlock?.id);
		expect(mounted.fieldEditor.isEditing).toBe(true);
	});

	it("reconciles existing block text into the inline surface", () => {
		const editor = createBareEditor();
		const firstBlock = editor.firstBlock();
		expect(firstBlock).toBeTruthy();
		if (firstBlock) {
			editor.apply(
				[
					{
						type: "splice-text",
						blockId: firstBlock.id,
						from: 0,
						to: 0,
						insert: "Hello",
					},
				],
				{ origin: "user" },
			);
		}

		const root = document.createElement("div");
		document.body.append(root);
		const mounted = mountEditor(editor, root);
		cleanups.push(() => {
			mounted.destroy();
			editor.destroy();
		});

		const inline = root.querySelector(`[${DATA_ATTRS.inlineContent}]`);
		expect(inline?.textContent).toContain("Hello");
	});

	it("HOST8: a host listener on the editor element sees block-selection Enter", () => {
		const editor = createBareEditor();
		const blockId = editor.firstBlock()!.id;
		const root = document.createElement("div");
		document.body.append(root);
		const mounted = mountEditor(editor, root);
		cleanups.push(() => {
			mounted.destroy();
			editor.destroy();
		});

		editor.selectBlocks([blockId]);
		const sink = root.querySelector(`[${FOCUS_SINK_ATTR}]`);
		expect(sink).toBeInstanceOf(HTMLElement);
		expect(document.activeElement).toBe(sink);

		let hostSawEnter = false;
		const onHostEnter = (event: KeyboardEvent): void => {
			if (event.key !== "Enter") {
				return;
			}
			hostSawEnter = true;
			event.preventDefault();
			event.stopPropagation();
		};
		root.addEventListener("keydown", onHostEnter, true);
		cleanups.push(() => {
			root.removeEventListener("keydown", onHostEnter, true);
		});

		sink!.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "Enter",
				bubbles: true,
				cancelable: true,
			}),
		);

		expect(hostSawEnter).toBe(true);
		expect(editor.blockCount()).toBe(1);
		expect(editor.selection).toMatchObject({
			type: "block",
			blockIds: [blockId],
		});
	});

	it("HOST9: two composers, only the focused editor handles body Enter", () => {
		const editorA = createBareEditor();
		const editorB = createBareEditor();
		const rootA = document.createElement("div");
		const rootB = document.createElement("div");
		document.body.append(rootA, rootB);
		const mountedA = mountEditor(editorA, rootA);
		const mountedB = mountEditor(editorB, rootB);
		cleanups.push(() => {
			mountedA.destroy();
			mountedB.destroy();
			editorA.destroy();
			editorB.destroy();
		});

		const blockA = editorA.firstBlock()!.id;
		const blockB = editorB.firstBlock()!.id;
		editorA.selectBlocks([blockA]);
		editorB.selectBlocks([blockB]);

		const sinkA = rootA.querySelector(`[${FOCUS_SINK_ATTR}]`);
		expect(sinkA).toBeInstanceOf(HTMLElement);
		expect(document.activeElement).toBe(sinkA);
		expect(rootB.contains(document.activeElement)).toBe(false);

		document.body.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "Enter",
				bubbles: true,
				cancelable: true,
			}),
		);

		expect(editorA.blockCount()).toBe(2);
		expect(editorB.blockCount()).toBe(1);
		expect(editorB.selection).toMatchObject({
			type: "block",
			blockIds: [blockB],
		});
	});

	it("HOST7: a later capture overlay keeps Escape from the selection ladder", () => {
		const editor = createBareEditor();
		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "hi /",
			},
		]);
		const root = document.createElement("div");
		document.body.append(root);
		const mounted = mountEditor(editor, root);
		cleanups.push(() => {
			mounted.destroy();
			editor.destroy();
		});

		mounted.fieldEditor.activateTextSelection(blockId, 4, 4);
		const inline = root.querySelector(
			`[${DATA_ATTRS.inlineContent}]`,
		) as HTMLElement | null;
		expect(inline).toBeInstanceOf(HTMLElement);
		inline!.tabIndex = 0;
		inline!.focus();

		let overlayHandled = false;
		const onOverlayEscape = (event: KeyboardEvent): void => {
			if (event.key !== "Escape") {
				return;
			}
			overlayHandled = true;
			event.preventDefault();
			event.stopPropagation();
		};
		document.addEventListener("keydown", onOverlayEscape, true);
		cleanups.push(() => {
			document.removeEventListener("keydown", onOverlayEscape, true);
		});

		document.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "Escape",
				bubbles: true,
				cancelable: true,
			}),
		);

		expect(overlayHandled).toBe(true);
		expect(editor.selection).toMatchObject({
			type: "text",
			focus: { blockId, offset: 4 },
		});
		expect(editor.getBlock(blockId)?.textContent()).toBe("hi /");
	});

	it("HOST6: boolean data attributes are valueless", () => {
		const editor = createBareEditor();
		const root = document.createElement("div");
		document.body.append(root);
		const mounted = mountEditor(editor, root, { readonly: true });
		cleanups.push(() => {
			mounted.destroy();
			editor.destroy();
		});

		expect(root.getAttribute(DATA_ATTRS.readonly)).toBe("");
		expect(root.hasAttribute(DATA_ATTRS.empty)).toBe(false);
	});

	it("registers setVerticalCaretMeasure after the field editor attaches", () => {
		const editor = createBareEditor();
		const root = document.createElement("div");
		document.body.append(root);
		const mounted = mountEditor(editor, root);
		cleanups.push(() => {
			mounted.destroy();
			editor.destroy();
		});

		expect(getVerticalCaretMeasure(editor)).toEqual(expect.any(Function));
	});

	it("clears the vertical caret measure on destroy", () => {
		const editor = createBareEditor();
		const root = document.createElement("div");
		document.body.append(root);
		const mounted = mountEditor(editor, root);
		mounted.destroy();
		cleanups.push(() => {
			editor.destroy();
		});

		expect(getVerticalCaretMeasure(editor)).toBeUndefined();
	});

	it("HOST6: adopts editor chrome by default", () => {
		const editor = createBareEditor();
		const root = document.createElement("div");
		document.body.append(root);
		const mounted = mountEditor(editor, root);
		cleanups.push(() => {
			mounted.destroy();
			editor.destroy();
		});

		const style = document.getElementById("pen-editor-chrome");
		expect(style).toBeInstanceOf(HTMLStyleElement);
		expect(style?.textContent).toContain(`[${DATA_ATTRS.inlineContent}]`);
	});

	it("HOST6: chrome false leaves the document unstyled", () => {
		document.getElementById("pen-editor-chrome")?.remove();
		const editor = createBareEditor();
		const root = document.createElement("div");
		document.body.append(root);
		const mounted = mountEditor(editor, root, { chrome: false });
		cleanups.push(() => {
			mounted.destroy();
			editor.destroy();
		});

		expect(document.getElementById("pen-editor-chrome")).toBeNull();
	});
});
