// @vitest-environment jsdom

import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { afterEach, describe, expect, it } from "vitest";
import { mountEditor } from "../host/mountEditor";
import { getRootOverlay } from "../overlay/rootOverlay";
import { DATA_ATTRS } from "../utils/dataAttributes";

const noDefaultExtensionsPreset = {
	resolve() {
		return { extensions: [] };
	},
};

describe("mountEditor overlay layer (W35.R2)", () => {
	afterEach(() => {
		document.body.replaceChildren();
	});

	it("OV2: mountEditor creates one overlay layer as the root's last child and destroy removes it", () => {
		const editor = createEditor({
			schema: defaultSchema,
			preset: noDefaultExtensionsPreset,
		});
		const root = document.createElement("div");
		document.body.append(root);
		const mounted = mountEditor(editor, root, { readonly: true });

		const layers = root.querySelectorAll(`[${DATA_ATTRS.overlayLayer}]`);
		expect(layers).toHaveLength(1);
		expect(root.lastElementChild).toBe(layers[0]);
		expect(layers[0]?.getAttribute("aria-hidden")).toBe("true");
		expect(getRootOverlay(root)?.layer).toBe(layers[0]);
		expect(mounted.fieldEditor.isReadOnly).toBe(true);

		mounted.destroy();
		expect(root.querySelector(`[${DATA_ATTRS.overlayLayer}]`)).toBeNull();
		expect(getRootOverlay(root)).toBeNull();
		editor.destroy();
	});

	it("OV2: re-attaching the same root keeps exactly one layer", () => {
		const editor = createEditor({
			schema: defaultSchema,
			preset: noDefaultExtensionsPreset,
		});
		const root = document.createElement("div");
		document.body.append(root);
		const mounted = mountEditor(editor, root);
		expect(mounted.fieldEditor.isReadOnly).toBe(false);

		const overlay = getRootOverlay(root);
		mounted.fieldEditor.setRootElement(null);
		expect(getRootOverlay(root)).toBeNull();
		mounted.fieldEditor.setRootElement(root);
		// A re-attach of the same root (React Strict Mode) keeps the overlay,
		// so a binding's contributors and holds survive it.
		expect(getRootOverlay(root)).toBe(overlay);

		const layers = root.querySelectorAll(`[${DATA_ATTRS.overlayLayer}]`);
		expect(layers).toHaveLength(1);
		expect(root.lastElementChild).toBe(layers[0]);
		mounted.destroy();
		editor.destroy();
	});

	it("OV2: without the chrome sheet a static root is positioned inline while mounted and restored on destroy", () => {
		const editor = createEditor({
			schema: defaultSchema,
			preset: noDefaultExtensionsPreset,
		});
		const root = document.createElement("div");
		document.body.append(root);
		const mounted = mountEditor(editor, root, { chrome: false });

		expect(root.style.position).toBe("relative");
		mounted.destroy();
		expect(root.style.position).toBe("");
		editor.destroy();
	});

	it("OV2: a root the host positions keeps the host's position", () => {
		const editor = createEditor({
			schema: defaultSchema,
			preset: noDefaultExtensionsPreset,
		});
		const root = document.createElement("div");
		root.style.position = "sticky";
		document.body.append(root);
		const mounted = mountEditor(editor, root);

		expect(root.style.position).toBe("sticky");
		mounted.destroy();
		expect(root.style.position).toBe("sticky");
		editor.destroy();
	});
});
