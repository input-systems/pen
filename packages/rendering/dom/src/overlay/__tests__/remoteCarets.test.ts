// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	attachRemoteCarets,
	type RemoteCaretCursor,
	type RemoteCaretSource,
} from "../remoteCarets";
import {
	createOverlayFixture,
	flushFrame,
	installMockRaf,
	pendingFrames,
	type OverlayFixture,
} from "./overlayFixture";

type StubSource = RemoteCaretSource & {
	set(next: readonly RemoteCaretCursor[]): void;
	notify(): void;
};

function stubSource(initial: readonly RemoteCaretCursor[]): StubSource {
	let cursors = initial;
	const listeners = new Set<() => void>();
	return {
		getRemoteCursors: () => cursors,
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		set(next) {
			cursors = next;
			this.notify();
		},
		notify() {
			for (const listener of listeners) {
				listener();
			}
		},
	};
}

function cursor(
	blockId: string,
	offset: number,
	clientId = 7,
): RemoteCaretCursor {
	return {
		clientId,
		user: { id: `u${clientId}`, name: "Grace <b>", color: "#123456" },
		blockId,
		offset,
	};
}

describe("remote carets on the paint plan (OV1)", () => {
	let fixture: OverlayFixture;

	beforeEach(() => {
		installMockRaf();
		fixture = createOverlayFixture();
	});

	afterEach(() => {
		fixture.destroy();
		vi.unstubAllGlobals();
	});

	it("OV1 OV3: each remote cursor resolves to one remote caret item painted with its label", () => {
		const { controller, blockId } = fixture;
		const phases: string[] = [];
		const source = stubSource([cursor(blockId, 3)]);
		const getRemoteCursors = source.getRemoteCursors;
		source.getRemoteCursors = () => {
			phases.push(fixture.scheduler.phase);
			return getRemoteCursors();
		};
		attachRemoteCarets(controller, source);
		flushFrame();

		expect(phases).toContain("read");
		const item = controller.plan?.items[0];
		expect(item).toMatchObject({
			kind: "caret",
			role: "remote",
			contributor: "multiplayer",
			key: "remote:7",
			x: 30,
			label: "Grace <b>",
			color: "#123456",
			paint: "layer",
		});
		// A remote caret never hides the native caret (O preamble).
		expect(controller.plan?.nativeCaretHidden).toBe(false);

		const node = controller.layer.querySelector<HTMLElement>(
			"[data-pen-multiplayer-caret]",
		);
		expect(node?.getAttribute("data-client-id")).toBe("7");
		expect(node?.getAttribute("data-user-id")).toBe("u7");
		expect(node?.getAttribute("aria-hidden")).toBe("true");
		expect(node?.style.transform).toBe("translate3d(30px, 0px, 0)");
		expect(node?.style.pointerEvents).toBe("none");
		expect(node?.style.animation).toBe("none");
		expect(node?.style.getPropertyValue("--pen-peer-color")).toBe(
			"#123456",
		);
		// O2: a remote caret is never shorter than 16px.
		expect(node?.style.height).toBe("20px");
		const label = node?.querySelector<HTMLElement>(
			"[data-pen-multiplayer-caret-label]",
		);
		// COL2: the name is text, never markup.
		expect(label?.textContent).toBe("Grace <b>");
		expect(label?.children).toHaveLength(0);
		expect(label?.getAttribute("aria-hidden")).toBe("true");
	});

	it("OV1: a cursor move repaints the same element; an unchanged notification costs no flush", () => {
		const { controller, blockId } = fixture;
		const source = stubSource([cursor(blockId, 3)]);
		attachRemoteCarets(controller, source);
		flushFrame();
		const node = controller.layer.querySelector(
			"[data-pen-multiplayer-caret]",
		);

		source.notify();
		expect(pendingFrames()).toBe(0);

		source.set([cursor(blockId, 5)]);
		expect(pendingFrames()).toBe(1);
		flushFrame();
		const moved = controller.layer.querySelectorAll<HTMLElement>(
			"[data-pen-multiplayer-caret]",
		);
		expect(moved).toHaveLength(1);
		expect(moved[0]).toBe(node);
		expect(moved[0]?.style.transform).toBe("translate3d(50px, 0px, 0)");
	});

	it("OV1: a cursor in an unmounted block is unresolved, and release removes every caret", () => {
		const { controller, blockId } = fixture;
		const source = stubSource([
			cursor(blockId, 1, 1),
			cursor("offscreen", 0, 2),
		]);
		const release = attachRemoteCarets(controller, source);
		flushFrame();
		expect(controller.plan?.items.map((item) => item.key)).toEqual([
			"remote:1",
		]);
		expect(controller.plan?.unresolved).toEqual([
			{
				key: "remote:2",
				contributor: "multiplayer",
				blockId: "offscreen",
			},
		]);

		release();
		flushFrame();
		expect(
			controller.layer.querySelector("[data-pen-multiplayer-caret]"),
		).toBeNull();
		source.set([cursor(blockId, 2, 1)]);
		expect(pendingFrames()).toBe(0);
	});

	it("OV3: binding paint leaves the carets to the binding", () => {
		const { controller, blockId } = fixture;
		attachRemoteCarets(controller, stubSource([cursor(blockId, 3)]), {
			paint: "binding",
		});
		flushFrame();
		expect(controller.plan?.items[0]?.paint).toBe("binding");
		expect(
			controller.layer.querySelector("[data-pen-multiplayer-caret]"),
		).toBeNull();
	});
});
