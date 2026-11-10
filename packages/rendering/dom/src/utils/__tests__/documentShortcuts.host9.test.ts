// @vitest-environment jsdom

import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import type { Editor } from "@input/pen-types";
import { undoExtension } from "@input/pen-undo";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountEditor } from "../../host/mountEditor";

/**
 * HOST9: keys follow focus. An editor without focus takes no key, whatever
 * selection it was left with, so the host's own bindings run. Driven through
 * `bindEditorDocumentKeyDown` as `mountEditor` installs it; the real-browser
 * twin is `suites/selection/host9-document-shortcuts.spec.ts` in the
 * conformance package.
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

/**
 * A keydown on the focused element, as a browser dispatches it; reports
 * whether the host's own listener saw it.
 */
function press(
	key: string,
	modifiers: { meta?: boolean; shift?: boolean } = {},
): { reachedHost: boolean; defaultPrevented: boolean } {
	const hostListener = vi.fn();
	window.addEventListener("keydown", hostListener);
	const event = new KeyboardEvent("keydown", {
		key,
		metaKey: modifiers.meta ?? false,
		shiftKey: modifiers.shift ?? false,
		bubbles: true,
		cancelable: true,
	});
	(document.activeElement ?? document.body).dispatchEvent(event);
	window.removeEventListener("keydown", hostListener);
	return {
		reachedHost: hostListener.mock.calls.length > 0,
		defaultPrevented: event.defaultPrevented,
	};
}

describe("HOST9: keys follow focus", () => {
	it("HOST9: Mod-z in the focused editor undoes in the editor", async () => {
		const { root, text } = await mountTyped("Hello");
		focusEditor(root);

		expect(press("z", { meta: true }).defaultPrevented).toBe(true);
		expect(text()).toBe("");
	});

	it("HOST9: Mod-z after a focused host control unmounts reaches the host, not the editor's caret", async () => {
		const { root, text } = await mountTyped("Hello");
		focusEditor(root);
		focusHostThenRemoveIt();

		expect(press("z", { meta: true })).toEqual({
			reachedHost: true,
			defaultPrevented: false,
		});
		expect(text()).toBe("Hello");
	});

	it("HOST9: Mod-Shift-z and Mod-a without editor focus reach the host", async () => {
		const { editor, root } = await mountTyped("Hello");
		focusEditor(root);
		focusHostThenRemoveIt();
		const selectionBefore = editor.selection;

		expect(press("z", { meta: true, shift: true }).reachedHost).toBe(true);
		expect(press("a", { meta: true }).reachedHost).toBe(true);
		expect(editor.selection).toEqual(selectionBefore);
	});

	it("HOST9: Mod-z after focus left the editor for the body reaches the host", async () => {
		const { root, text } = await mountTyped("Hello");
		focusEditor(root);
		blurToBody();

		expect(press("z", { meta: true }).reachedHost).toBe(true);
		expect(text()).toBe("Hello");
	});

	it("HOST9: an editor that never held focus leaves Mod-z to the host", async () => {
		const { text } = await mountTyped("Hello");

		expect(press("z", { meta: true }).reachedHost).toBe(true);
		expect(text()).toBe("Hello");
	});

	it("HOST9: of two editors, Mod-z undoes only in the focused one", async () => {
		const first = await mountTyped("First");
		const second = await mountTyped("Second");
		focusEditor(second.root);

		expect(press("z", { meta: true }).defaultPrevented).toBe(true);
		expect(first.text()).toBe("First");
		expect(second.text()).toBe("");
	});
});

describe("HOST9: a leftover block selection takes no key without focus", () => {
	async function mountWithBlockSelection() {
		const mounted = await mountTyped("Hello");
		const blockId = mounted.editor.firstBlock()!.id;
		focusEditor(mounted.root);
		mounted.editor.selectBlocks([blockId], { origin: "keyboard" });
		expect(mounted.editor.selection).toMatchObject({ type: "block" });
		return { ...mounted, blockId };
	}

	function focusHostMenuItem(): void {
		const menuItem = document.createElement("button");
		menuItem.setAttribute("role", "menuitem");
		menuItem.textContent = "Move to";
		document.body.append(menuItem);
		menuItem.focus();
	}

	it.each(["Backspace", "Delete", "Enter", "ArrowDown", "Escape"])(
		"HOST9: %s on a focused host element leaves the editor's block selection alone",
		async (key) => {
			const { editor, text } = await mountWithBlockSelection();
			focusHostMenuItem();
			const blockCount = editor.documentState.blockOrder.length;
			const selectionBefore = editor.selection;

			expect(press(key)).toEqual({
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

		expect(press("Backspace").reachedHost).toBe(true);
		expect(editor.getBlock(blockId)?.textContent()).toBe("Hello");
		expect(editor.selection).toMatchObject({ type: "block" });
	});
});
