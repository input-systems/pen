// @vitest-environment jsdom

import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import type { Editor } from "@input/pen-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRootGeometry } from "../../geometry/rootGeometry";
import { mountEditor } from "../../host/mountEditor";
import { getRootOverlay } from "../rootOverlay";

const noDefaultExtensionsPreset = {
	resolve() {
		return { extensions: [] };
	},
};

/** Live ResizeObservers, so a test can see the root's observer disconnect. */
const liveObservers = new Set<object>();

class FakeResizeObserver {
	constructor(_callback: ResizeObserverCallback) {}
	observe(): void {
		liveObservers.add(this);
	}
	unobserve(): void {}
	disconnect(): void {
		liveObservers.delete(this);
	}
}

/** Document scroll-capture listeners currently installed. */
const scrollListeners = new Set<unknown>();

function createTestEditor(): Editor {
	return createEditor({
		schema: defaultSchema,
		preset: noDefaultExtensionsPreset,
	});
}

function connectedRoot(): HTMLElement {
	const root = document.createElement("div");
	document.body.append(root);
	return root;
}

function forceCollection(): () => void {
	setFlagsFromString("--expose-gc");
	return runInNewContext("gc") as () => void;
}

beforeEach(() => {
	liveObservers.clear();
	scrollListeners.clear();
	vi.stubGlobal("ResizeObserver", FakeResizeObserver);
	const add = document.addEventListener.bind(document);
	const remove = document.removeEventListener.bind(document);
	vi.spyOn(document, "addEventListener").mockImplementation(
		(type, listener, options) => {
			if (type === "scroll" && options === true) {
				scrollListeners.add(listener);
			}
			add(type, listener, options);
		},
	);
	vi.spyOn(document, "removeEventListener").mockImplementation(
		(type, listener, options) => {
			if (type === "scroll" && options === true) {
				scrollListeners.delete(listener);
			}
			remove(type, listener, options);
		},
	);
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	document.body.replaceChildren();
});

describe("root overlay and geometry lifecycle", () => {
	it("destroy releases the root's ResizeObserver and document scroll listener", () => {
		const editor = createTestEditor();
		const root = connectedRoot();
		const mounted = mountEditor(editor, root);
		const geometry = getRootGeometry(root);
		expect(liveObservers.size).toBe(1);
		expect(scrollListeners.size).toBe(1);

		mounted.destroy();
		editor.destroy();

		expect(liveObservers.size).toBe(0);
		expect(scrollListeners.size).toBe(0);
		expect(getRootOverlay(root)).toBeNull();
		// The root's geometry was released: a later read starts a fresh host.
		expect(getRootGeometry(root)).not.toBe(geometry);
	});

	it("a re-attach after detach (Strict Mode) recreates geometry and keeps the overlay", () => {
		const editor = createTestEditor();
		const root = connectedRoot();
		const mounted = mountEditor(editor, root);
		const overlay = getRootOverlay(root);
		const geometry = getRootGeometry(root);

		mounted.fieldEditor.setRootElement(null);
		expect(liveObservers.size).toBe(0);
		expect(scrollListeners.size).toBe(0);

		mounted.fieldEditor.setRootElement(root);
		expect(getRootOverlay(root)).toBe(overlay);
		expect(getRootGeometry(root)).not.toBe(geometry);
		expect(liveObservers.size).toBe(1);
		expect(scrollListeners.size).toBe(1);

		mounted.destroy();
		editor.destroy();
	});

	it("a destroyed editor is not kept alive by a root that outlives it", async () => {
		const collect = forceCollection();
		const root = connectedRoot();
		const editorRef = (() => {
			const editor = createTestEditor();
			const mounted = mountEditor(editor, root);
			mounted.destroy();
			void editor.destroy();
			return new WeakRef(editor);
		})();
		// The spies record their listener arguments; drop them so only the
		// production paths are left to retain anything.
		vi.clearAllMocks();
		vi.restoreAllMocks();
		await new Promise((resolve) => setTimeout(resolve, 0));
		collect();
		await new Promise((resolve) => setTimeout(resolve, 0));
		collect();
		expect(root.isConnected).toBe(true);
		expect(editorRef.deref()).toBeUndefined();
	});
});
