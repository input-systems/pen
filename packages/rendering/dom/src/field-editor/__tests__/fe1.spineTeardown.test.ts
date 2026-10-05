// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@input/pen-types";
import { ContentEditableBackend } from "../contenteditableBackend";
import { EditContextBackend } from "../editContextBackend";
import { ExpandedContentEditableBackend } from "../expandedContentEditableBackend";
import type { InputBackend } from "../../internal/inputBackend";
import {
	contextOf,
	getYText,
	installFakeEditContext,
	mountBlockDom,
	recordingController,
	removeEditContext,
	seedParagraphs,
} from "./fieldEditorFixtures.testHelpers";

/**
 * jsdom builds a document's selector engine on its first `matches` /
 * `closest` / `querySelector` call, and that engine registers capture
 * listeners on the window for `:focus-visible` tracking that live as long as
 * the document. jsdom 28 built it with the document; jsdom 30 builds it
 * lazily, so whichever test first reaches `closest()` inside a ledger would be
 * billed for nine `Window` listeners that are jsdom's, not the backend's.
 */
function buildJsdomSelectorEngine(): void {
	document.documentElement.matches("*");
}

/**
 * Counts every listener and observer the process holds, by target and type,
 * so a backend that forgets one is caught by name rather than by a later
 * flaky failure.
 */
function installLedger() {
	buildJsdomSelectorEngine();
	const listeners = new Map<string, number>();
	const observers = new Set<MutationObserver>();
	const addEventListener = EventTarget.prototype.addEventListener;
	const removeEventListener = EventTarget.prototype.removeEventListener;
	const NativeMutationObserver = globalThis.MutationObserver;

	const key = (target: EventTarget, type: string): string => {
		const name =
			target instanceof HTMLElement
				? `<${target.tagName.toLowerCase()}>`
				: target.constructor.name;
		return `${name} ${type}`;
	};

	EventTarget.prototype.addEventListener = function (
		this: EventTarget,
		type: string,
		handler: EventListenerOrEventListenerObject | null,
		options?: boolean | AddEventListenerOptions,
	) {
		listeners.set(key(this, type), (listeners.get(key(this, type)) ?? 0) + 1);
		return addEventListener.call(this, type, handler, options);
	};
	EventTarget.prototype.removeEventListener = function (
		this: EventTarget,
		type: string,
		handler: EventListenerOrEventListenerObject | null,
		options?: boolean | EventListenerOptions,
	) {
		listeners.set(key(this, type), (listeners.get(key(this, type)) ?? 0) - 1);
		return removeEventListener.call(this, type, handler, options);
	};

	class LedgerMutationObserver extends NativeMutationObserver {
		observe(target: Node, init?: MutationObserverInit): void {
			observers.add(this);
			super.observe(target, init);
		}
		disconnect(): void {
			observers.delete(this);
			super.disconnect();
		}
	}
	globalThis.MutationObserver =
		LedgerMutationObserver as typeof MutationObserver;

	return {
		/** Listener kinds still outstanding, as `"<div> keydown"` strings. */
		outstanding(): string[] {
			return [...listeners]
				.filter(([, count]) => count !== 0)
				.map(([name, count]) => `${name} x${count}`)
				.sort();
		},
		liveObservers(): number {
			return observers.size;
		},
		restore(): void {
			EventTarget.prototype.addEventListener = addEventListener;
			EventTarget.prototype.removeEventListener = removeEventListener;
			globalThis.MutationObserver = NativeMutationObserver;
		},
	};
}

/** Runs `run` under a fresh ledger and asserts it leaves nothing bound. */
function expectNothingBound(run: () => void): void {
	const ledger = installLedger();
	try {
		run();
		expect(ledger.outstanding()).toEqual([]);
		expect(ledger.liveObservers()).toBe(0);
	} finally {
		ledger.restore();
	}
}

const fixtures: Array<{ editor: Editor; backend: InputBackend }> = [];

function mount<T extends InputBackend>(
	Backend: new (editor: Editor, controller: ReturnType<typeof recordingController>["controller"]) => T,
) {
	const {
		editor,
		blockIds: [blockId],
	} = seedParagraphs(["Hello world"]);
	const backend = new Backend(editor, recordingController(blockId!).controller);
	fixtures.push({ editor, backend });
	const { inline } = mountBlockDom(blockId!, "Hello world");
	return { backend, inline, ytext: getYText(editor, blockId!) };
}

/** Attach, exercise, tear down — the same three steps for every backend. */
function exercise(element: HTMLElement): void {
	element.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
	element.dispatchEvent(new Event("contextmenu", { bubbles: true }));
	element.ownerDocument.dispatchEvent(new Event("selectionchange"));
}

afterEach(() => {
	for (const fixture of fixtures.splice(0)) {
		fixture.backend.deactivate();
		fixture.editor.destroy();
	}
	document.body.replaceChildren();
	removeEditContext();
});

describe("FE1 spine teardown is total", () => {
	it("leaves nothing bound after the contenteditable backend detaches", () => {
		const { backend, inline, ytext } = mount(ContentEditableBackend);

		expectNothingBound(() => {
			backend.activate(inline, ytext);
			expect(inline.getAttribute("tabindex")).toBe("-1");
			exercise(inline);
			backend.deactivate();
		});
		expect(inline.hasAttribute("tabindex")).toBe(false);
	});

	it("leaves nothing bound after the EditContext backend detaches", () => {
		installFakeEditContext();
		const { backend, inline, ytext } = mount(EditContextBackend);

		expectNothingBound(() => {
			backend.activate(inline, ytext);
			expect(inline.getAttribute("tabindex")).toBe("-1");
			const editContext = contextOf(inline);
			expect(
				editContext.listenerCount,
				"the EditContext must carry its own listeners while attached",
			).toBeGreaterThan(0);

			exercise(inline);
			backend.deactivate();

			expect(
				editContext.listenerCount,
				"EditContext listeners are released with the DOM ones",
			).toBe(0);
		});
		expect(contextOf(inline)).toBeNull();
		expect(inline.hasAttribute("tabindex")).toBe(false);
	});

	it("leaves nothing bound, the editing host's tabindex included, after the expanded backend detaches", () => {
		const { backend, inline: host } = mount(ExpandedContentEditableBackend);

		expectNothingBound(() => {
			backend.activate(host);
			expect(host.getAttribute("tabindex")).toBe("-1");
			exercise(host);
			backend.deactivate();
		});
		expect(host.hasAttribute("tabindex")).toBe(false);
	});

	it("survives a second detach without unbinding a live re-attach", () => {
		const { backend, inline, ytext } = mount(ContentEditableBackend);

		expectNothingBound(() => {
			backend.activate(inline, ytext);
			backend.deactivate();
			backend.deactivate();
			backend.activate(inline, ytext);
			exercise(inline);
			backend.deactivate();
		});
	});
});
