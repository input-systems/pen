// @vitest-environment jsdom

import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import type { Editor } from "@input/pen-types";
import { undoExtension } from "@input/pen-undo";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountEditor } from "../../host/mountEditor";

/**
 * HOST9: Mod-a and history on a body that focus fell to belong to whatever
 * held focus last. Driven through `bindEditorDocumentKeyDown` as
 * `mountEditor` installs it; the real-browser twin is
 * `suites/selection/host9-document-shortcuts.spec.ts` in the conformance
 * package.
 */

const cleanups: Array<() => void> = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
	document.body.replaceChildren();
});

async function mountTyped(text: string): Promise<{
	editor: Editor;
	root: HTMLElement;
	text: () => string;
}> {
	const editor = createEditor({
		schema: defaultSchema,
		preset: { resolve: () => ({ extensions: [] }) },
		extensions: [undoExtension()],
	});
	await editor.whenReady();
	const root = document.createElement("div");
	document.body.append(root);
	const mounted = mountEditor(editor, root);
	cleanups.push(() => {
		mounted.destroy();
		void editor.destroy();
	});
	const blockId = editor.firstBlock()!.id;
	editor.apply(
		[{ type: "splice-text", blockId, from: 0, to: 0, insert: text }],
		{ origin: "user" },
	);
	editor.selectText(blockId, text.length, text.length);
	return {
		editor,
		root,
		text: () => editor.getBlock(blockId)!.textContent(),
	};
}

/** Focus moves into the root, as a click in its field would. */
function focusEditor(root: HTMLElement): void {
	root.focus();
	expect(root.contains(document.activeElement)).toBe(true);
}

/** A host control takes focus, then unmounts: focus falls to the body. */
function focusHostThenRemoveIt(): void {
	const menuItem = document.createElement("button");
	menuItem.textContent = "Move to";
	document.body.append(menuItem);
	menuItem.focus();
	menuItem.remove();
	if (document.activeElement !== document.body) {
		(document.activeElement as HTMLElement | null)?.blur();
	}
	expect(document.activeElement).toBe(document.body);
}

/** Focus leaves the editor for nothing focusable: a click on empty space. */
function blurToBody(): void {
	(document.activeElement as HTMLElement).blur();
	expect(document.activeElement).toBe(document.body);
}

/** Mod-key on the body; reports whether the host's own listener saw it. */
function pressOnBody(
	key: string,
	shiftKey = false,
): { reachedHost: boolean; defaultPrevented: boolean } {
	const hostListener = vi.fn();
	window.addEventListener("keydown", hostListener);
	const event = new KeyboardEvent("keydown", {
		key,
		metaKey: true,
		shiftKey,
		bubbles: true,
		cancelable: true,
	});
	document.body.dispatchEvent(event);
	window.removeEventListener("keydown", hostListener);
	return {
		reachedHost: hostListener.mock.calls.length > 0,
		defaultPrevented: event.defaultPrevented,
	};
}

describe("HOST9: document shortcuts on a body focus fell to", () => {
	it("HOST9: Mod-z after a focused host control unmounts reaches the host, not the editor's caret", async () => {
		const { root, text } = await mountTyped("Hello");
		focusEditor(root);
		focusHostThenRemoveIt();

		expect(pressOnBody("z")).toEqual({
			reachedHost: true,
			defaultPrevented: false,
		});
		expect(text()).toBe("Hello");
	});

	it("HOST9: Mod-Shift-z and Mod-a after a focused host control unmounts reach the host", async () => {
		const { editor, root } = await mountTyped("Hello");
		focusEditor(root);
		focusHostThenRemoveIt();
		const selectionBefore = editor.selection;

		expect(pressOnBody("z", true).reachedHost).toBe(true);
		expect(pressOnBody("a").reachedHost).toBe(true);
		expect(editor.selection).toEqual(selectionBefore);
	});

	it("HOST9: Mod-z after focus left the editor for the body still undoes in the editor", async () => {
		const { root, text } = await mountTyped("Hello");
		focusEditor(root);
		blurToBody();

		expect(pressOnBody("z")).toEqual({
			reachedHost: false,
			defaultPrevented: true,
		});
		expect(text()).toBe("");
	});

	it("HOST9: focus returning to the editor after a host control reclaims Mod-z", async () => {
		const { root, text } = await mountTyped("Hello");
		focusEditor(root);
		focusHostThenRemoveIt();
		focusEditor(root);
		blurToBody();

		expect(pressOnBody("z").reachedHost).toBe(false);
		expect(text()).toBe("");
	});

	it("HOST9: an editor that never held focus leaves Mod-z on the body to the host", async () => {
		const { text } = await mountTyped("Hello");

		expect(pressOnBody("z").reachedHost).toBe(true);
		expect(text()).toBe("Hello");
	});

	it("HOST9: of two editors left with a caret, Mod-z on the body undoes in the one that held focus last", async () => {
		const first = await mountTyped("First");
		const second = await mountTyped("Second");

		focusEditor(second.root);
		blurToBody();
		expect(pressOnBody("z").reachedHost).toBe(false);
		expect(first.text()).toBe("First");
		expect(second.text()).toBe("");

		focusEditor(first.root);
		blurToBody();
		expect(pressOnBody("z").reachedHost).toBe(false);
		expect(first.text()).toBe("");
	});
});

/** A plain key on `target`; reports whether the host's own listener saw it. */
function pressPlain(
	target: Element,
	key: string,
): { reachedHost: boolean; defaultPrevented: boolean } {
	const hostListener = vi.fn();
	window.addEventListener("keydown", hostListener);
	const event = new KeyboardEvent("keydown", {
		key,
		bubbles: true,
		cancelable: true,
	});
	target.dispatchEvent(event);
	window.removeEventListener("keydown", hostListener);
	return {
		reachedHost: hostListener.mock.calls.length > 0,
		defaultPrevented: event.defaultPrevented,
	};
}

describe("HOST9: every document key follows focus, not a leftover selection", () => {
	async function mountWithBlockSelection() {
		const mounted = await mountTyped("Hello");
		const blockId = mounted.editor.firstBlock()!.id;
		focusEditor(mounted.root);
		mounted.editor.selectBlocks([blockId], { origin: "keyboard" });
		expect(mounted.editor.selection).toMatchObject({ type: "block" });
		return { ...mounted, blockId };
	}

	function focusHostMenuItem(): HTMLElement {
		const menuItem = document.createElement("button");
		menuItem.setAttribute("role", "menuitem");
		menuItem.textContent = "Move to";
		document.body.append(menuItem);
		menuItem.focus();
		return menuItem;
	}

	it.each(["Backspace", "Delete", "Enter", "ArrowDown", "Escape"])(
		"HOST9: %s on a focused host element leaves the editor's block selection alone",
		async (key) => {
			const { editor, text } = await mountWithBlockSelection();
			const menuItem = focusHostMenuItem();
			const blockCount = editor.documentState.blockOrder.length;
			const selectionBefore = editor.selection;

			expect(pressPlain(menuItem, key)).toEqual({
				reachedHost: true,
				defaultPrevented: false,
			});
			expect(editor.documentState.blockOrder.length).toBe(blockCount);
			expect(text()).toBe("Hello");
			expect(editor.selection).toEqual(selectionBefore);
		},
	);

	it("HOST9: Backspace after a focused host control unmounts does not delete the block selection", async () => {
		const { editor, blockId } = await mountWithBlockSelection();
		focusHostThenRemoveIt();

		expect(pressPlain(document.body, "Backspace").reachedHost).toBe(true);
		expect(editor.getBlock(blockId)?.textContent()).toBe("Hello");
		expect(editor.selection).toMatchObject({ type: "block" });
	});
});
