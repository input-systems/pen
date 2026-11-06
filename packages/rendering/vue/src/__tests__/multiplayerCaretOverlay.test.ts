// @vitest-environment jsdom

import { getRootOverlay } from "@input/pen-dom";
import { createTestEditor } from "@input/pen-test";
import { MULTIPLAYER_CONTROLLER_SLOT } from "@input/pen-types";
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { h, nextTick, ref, type VNode } from "vue";
import { PenContent } from "../components/PenContent";
import { PenEditor } from "../components/PenEditor";
import { PenMultiplayerCaretOverlay } from "../components/PenMultiplayerCaretOverlay";

type RangeMeasure = {
	getBoundingClientRect?: () => DOMRect;
	getClientRects?: () => DOMRect[];
};
const rangePrototype = Range.prototype as unknown as RangeMeasure;
const originalRangeMeasure: RangeMeasure = {
	getBoundingClientRect: rangePrototype.getBoundingClientRect,
	getClientRects: rangePrototype.getClientRects,
};

afterEach(() => {
	rangePrototype.getBoundingClientRect =
		originalRangeMeasure.getBoundingClientRect;
	rangePrototype.getClientRects = originalRangeMeasure.getClientRects;
	document.body.replaceChildren();
});

/** Run the scheduler's pending flush (overlay read and paint). */
async function flushFrames(): Promise<void> {
	await new Promise<void>((resolve) =>
		requestAnimationFrame(() => resolve()),
	);
	await new Promise<void>((resolve) =>
		requestAnimationFrame(() => resolve()),
	);
}

/** An editor with one peer caret at offset 2, mounted with `overlay` and painted. */
async function mountWithRemoteCaret(overlay: () => VNode) {
	// jsdom has no layout: every caret Range measures as a 24px line.
	const box = () => new DOMRect(24, 32, 0, 24);
	rangePrototype.getBoundingClientRect = box;
	rangePrototype.getClientRects = () => [box()];
	const editor = createTestEditor({
		blocks: [{ id: "p1", type: "paragraph", props: {}, content: "Hello" }],
	});
	editor.internals.assignSlot(MULTIPLAYER_CONTROLLER_SLOT, {
		getRemoteCursors: () => [
			{
				clientId: 9,
				user: { id: "u9", name: "Grace", color: "#123456" },
				blockId: "p1",
				offset: 2,
				clock: 1,
			},
		],
		subscribe: () => () => {},
	});
	const host = document.createElement("div");
	document.body.append(host);
	const wrapper = mount(PenEditor, {
		props: { editor },
		slots: {
			default: () => [h(PenContent), overlay()],
		},
		attachTo: host,
	});
	await nextTick();
	await flushFrames();
	const root = wrapper.element as HTMLElement;
	return { editor, wrapper, root };
}

describe("PenMultiplayerCaretOverlay (OV3)", () => {
	it("OV3: remote carets from the multiplayer controller paint into the overlay layer", async () => {
		const { editor, wrapper, root } = await mountWithRemoteCaret(() =>
			h(PenMultiplayerCaretOverlay),
		);

		const layer = getRootOverlay(root)?.layer;
		const caret = layer?.querySelector<HTMLElement>(
			"[data-pen-multiplayer-caret]",
		);
		expect(caret?.getAttribute("data-user-id")).toBe("u9");
		expect(caret?.getAttribute("aria-hidden")).toBe("true");
		expect(caret?.style.transform).toBe("translate3d(24px, 32px, 0)");
		expect(caret?.style.pointerEvents).toBe("none");
		expect(
			caret?.querySelector("[data-pen-multiplayer-caret-label]")
				?.textContent,
		).toBe("Grace");

		wrapper.unmount();
		expect(
			document.querySelector("[data-pen-multiplayer-caret]"),
		).toBeNull();
		editor.destroy();
	});

	it("OV3: glideMs reaches the remote caret request, and a prop change re-attaches the contributor", async () => {
		const glideMs = ref<number | undefined>(33);
		const { editor, wrapper, root } = await mountWithRemoteCaret(() =>
			h(PenMultiplayerCaretOverlay, { glideMs: glideMs.value }),
		);
		const remoteItem = () =>
			getRootOverlay(root)?.plan?.items.find((item) => item.role === "remote");
		// A first paint has nothing to glide from.
		expect(remoteItem()?.glideMs).toBe(0);

		glideMs.value = undefined;
		await nextTick();
		await flushFrames();
		expect(remoteItem()?.glideMs).toBeUndefined();

		wrapper.unmount();
		editor.destroy();
	});
});
