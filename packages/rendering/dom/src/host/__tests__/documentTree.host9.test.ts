// @vitest-environment jsdom
import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { afterEach, describe, expect, it } from "vitest";
import { isForeignNativeTextEntryTarget } from "../../utils/textEntryTarget";
import { DATA_ATTRS } from "../../utils/dataAttributes";
import { createDocumentTree } from "../documentTree";

type SurfaceMode = "inactive" | "single" | "expanded" | "block";

const cleanups: Array<() => void> = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
});

/** A document tree over a notifier whose surface mode the test sets. */
function mountTree() {
	const editor = createEditor({ schema: defaultSchema });
	let mode: SurfaceMode = "inactive";
	const surfaceListeners = new Set<() => void>();
	const fieldEditor = {
		blockNotifier: {
			subscribeListSegments: () => () => {},
			getListSegments: () => [],
			subscribeBlock: () => () => {},
			subscribeSurface: (listener: () => void) => {
				surfaceListeners.add(listener);
				return () => surfaceListeners.delete(listener);
			},
			getSurfaceSnapshot: () => ({ mode, activeBlockIds: [] }),
		},
		ackBlockMounted: () => {},
	};
	const root = document.createElement("div");
	root.setAttribute(DATA_ATTRS.editorRoot, "");
	document.body.append(root);
	const tree = createDocumentTree(editor, fieldEditor as never, root);
	cleanups.push(() => {
		tree.destroy();
		root.remove();
		editor.destroy();
	});
	const setMode = (next: SurfaceMode) => {
		mode = next;
		for (const listener of surfaceListeners) listener();
	};
	return { root, blocksHost: tree.blocksHost, setMode, surfaceListeners, tree };
}

describe("HOST9: the vanilla document tree's expanded blocks host", () => {
	it("is marked as this editor's field surface while expanded, as the React and Vue hosts mark it", () => {
		const { root, blocksHost, setMode } = mountTree();
		expect(blocksHost.hasAttribute(DATA_ATTRS.fieldEditorSurface)).toBe(false);

		setMode("expanded");
		blocksHost.setAttribute("contenteditable", "true");
		expect(blocksHost.hasAttribute(DATA_ATTRS.fieldEditorSurface)).toBe(true);
		expect(blocksHost.hasAttribute(DATA_ATTRS.fieldEditorActiveSurface)).toBe(true);
		expect(blocksHost.getAttribute("role")).toBe("textbox");
		expect(blocksHost.getAttribute("aria-multiline")).toBe("true");
		// Unmarked, its contenteditable read as a foreign text control, and a
		// return to a single block attached passively and lost keyboard input.
		expect(isForeignNativeTextEntryTarget(blocksHost, root)).toBe(false);
	});

	it("drops the marks when the selection leaves the expanded surface", () => {
		const { blocksHost, setMode } = mountTree();
		setMode("expanded");
		setMode("single");
		expect(blocksHost.hasAttribute(DATA_ATTRS.fieldEditorSurface)).toBe(false);
		expect(blocksHost.hasAttribute(DATA_ATTRS.fieldEditorActiveSurface)).toBe(false);
		expect(blocksHost.hasAttribute("role")).toBe(false);
	});

	it("unsubscribes from the surface on destroy", () => {
		const { surfaceListeners, tree } = mountTree();
		expect(surfaceListeners.size).toBe(1);
		tree.destroy();
		expect(surfaceListeners.size).toBe(0);
	});
});
