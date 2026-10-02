// @vitest-environment jsdom

import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@input/pen-types";
import { ContentEditableBackend } from "../contenteditableBackend";
import type { FieldEditorInputController } from "../controller";
import { EditContextBackend } from "../editContextBackend";
import type { EditContext } from "../editContextTypes";
import { ExpandedContentEditableBackend } from "../expandedContentEditableBackend";
import type { FieldEditorTextLike } from "../crdt";
import type { InputBackend } from "../../internal/inputBackend";
import { DATA_ATTRS } from "../../utils/dataAttributes";

function getYText(editor: Editor, blockId: string): FieldEditorTextLike {
	const ydoc = editor.internals.adapter.raw<{
		getMap(name: string): {
			get(key: string): { get(field: string): unknown } | undefined;
		};
	}>(editor.internals.crdtDoc);
	const ytext = ydoc.getMap("blocks").get(blockId)?.get("content") as
		| FieldEditorTextLike
		| null
		| undefined;
	if (!ytext) {
		throw new Error(`Missing test Y.Text for block ${blockId}`);
	}
	return ytext;
}

class FakeEditContext implements EditContext {
	text: string;
	selectionStart: number;
	selectionEnd: number;
	private readonly listeners = new Map<string, Set<(event: Event) => void>>();

	constructor(options?: { text?: string }) {
		this.text = options?.text ?? "";
		this.selectionStart = 0;
		this.selectionEnd = 0;
	}

	updateText(): void {}
	updateSelection(): void {}
	updateCharacterBounds(): void {}

	addEventListener(type: string, handler: (event: Event) => void): void {
		const handlers = this.listeners.get(type) ?? new Set();
		handlers.add(handler);
		this.listeners.set(type, handlers);
	}

	removeEventListener(type: string, handler: (event: Event) => void): void {
		this.listeners.get(type)?.delete(handler);
	}

	get listenerCount(): number {
		let total = 0;
		for (const handlers of this.listeners.values()) {
			total += handlers.size;
		}
		return total;
	}
}

/**
 * Counts every listener and observer the process holds, by target and type,
 * so a backend that forgets one is caught by name rather than by a later
 * flaky failure.
 */
function installLedger() {
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

function stubController(blockId: string) {
	return {
		focusBlockId: blockId,
		inputMode: "richtext" as const,
		activeCellCoord: null,
		activateCell: () => {},
		activateTextSelection: () => {},
		deactivate: () => {},
		resetBackendSelectionAuthority: () => {},
		withBackendSelectionWrite: <T>(write: () => T) => write(),
		requestDomFocus: () => false,
		shouldHandleDomSelectionChange: () => false,
		getBackendSelectionApplicationDepth: () => 0,
		applyDomTextSelection: () => {},
		selectAllBehavior: "block-first" as const,
		resolveInsertMarks: () => undefined,
		setComposing: () => {},
		notifyDomReconciled: () => {},
		notifyGestureEvent: () => {},
		setBackendSelectionAuthority: () => {},
		getBackendSelectionAuthority: () => null,
		hasBackendSelectionAuthority: () => false,
		clearBackendSelectionAuthority: () => {},
		setEditContextSelectionSnapshot: () => {},
		getEditContextSelectionSnapshot: () => null,
		selection: null,
	} as unknown as FieldEditorInputController;
}

type Fixture = {
	editor: Editor;
	backend: InputBackend;
	element: HTMLElement;
};

const fixtures: Fixture[] = [];

function seedEditor(): { editor: Editor; blockId: string } {
	const editor = createEditor({ schema: defaultSchema });
	const blockId = editor.firstBlock()!.id;
	editor.apply([
		{ type: "splice-text", blockId, from: 0, to: 0, insert: "Hello world" },
	]);
	return { editor, blockId };
}

function inlineElement(blockId: string): HTMLElement {
	const root = document.createElement("div");
	root.setAttribute(DATA_ATTRS.editorRoot, "");
	const block = document.createElement("div");
	block.setAttribute(DATA_ATTRS.editorBlock, "");
	block.setAttribute(DATA_ATTRS.blockId, blockId);
	const inline = document.createElement("div");
	inline.setAttribute(DATA_ATTRS.inlineContent, "");
	inline.textContent = "Hello world";
	block.append(inline);
	root.append(block);
	document.body.append(root);
	return inline;
}

/** Attach, exercise, tear down — the same three steps for every backend. */
function exercise(element: HTMLElement): void {
	element.dispatchEvent(
		new KeyboardEvent("keydown", { key: "a", bubbles: true }),
	);
	element.dispatchEvent(new Event("contextmenu", { bubbles: true }));
	element.ownerDocument.dispatchEvent(new Event("selectionchange"));
}

afterEach(() => {
	for (const fixture of fixtures.splice(0)) {
		fixture.backend.deactivate();
		fixture.editor.destroy();
	}
	document.body.replaceChildren();
	delete (globalThis as { EditContext?: unknown }).EditContext;
});

describe("FE1 spine teardown is total", () => {
	it("leaves nothing bound after the contenteditable backend detaches", () => {
		const { editor, blockId } = seedEditor();
		const element = inlineElement(blockId);
		const backend = new ContentEditableBackend(
			editor,
			stubController(blockId),
		);
		fixtures.push({ editor, backend, element });

		const ledger = installLedger();
		try {
			backend.activate(element, getYText(editor, blockId));
			expect(element.getAttribute("tabindex")).toBe("-1");
			exercise(element);
			backend.deactivate();

			expect(ledger.outstanding()).toEqual([]);
			expect(ledger.liveObservers()).toBe(0);
			expect(element.hasAttribute("tabindex")).toBe(false);
		} finally {
			ledger.restore();
		}
	});

	it("leaves nothing bound after the EditContext backend detaches", () => {
		(globalThis as { EditContext?: unknown }).EditContext = FakeEditContext;
		const { editor, blockId } = seedEditor();
		const element = inlineElement(blockId);
		const backend = new EditContextBackend(editor, stubController(blockId));
		fixtures.push({ editor, backend, element });

		const ledger = installLedger();
		try {
			backend.activate(element, getYText(editor, blockId));
			expect(element.getAttribute("tabindex")).toBe("-1");
			const editContext = (
				element as HTMLElement & { editContext: FakeEditContext | null }
			).editContext;
			expect(
				editContext?.listenerCount,
				"the EditContext must carry its own listeners while attached",
			).toBeGreaterThan(0);

			exercise(element);
			backend.deactivate();

			expect(ledger.outstanding()).toEqual([]);
			expect(ledger.liveObservers()).toBe(0);
			expect(
				editContext?.listenerCount,
				"EditContext listeners are released with the DOM ones",
			).toBe(0);
			expect(
				(element as HTMLElement & { editContext: unknown }).editContext,
			).toBeNull();
			expect(element.hasAttribute("tabindex")).toBe(false);
		} finally {
			ledger.restore();
		}
	});

	it("leaves nothing bound after the expanded backend detaches", () => {
		const { editor, blockId } = seedEditor();
		const host = document.createElement("div");
		document.body.append(host);
		const backend = new ExpandedContentEditableBackend(
			editor,
			stubController(blockId),
		);
		fixtures.push({ editor, backend, element: host });

		const ledger = installLedger();
		try {
			backend.activate(host);
			exercise(host);
			backend.deactivate();

			expect(ledger.outstanding()).toEqual([]);
			expect(ledger.liveObservers()).toBe(0);
		} finally {
			ledger.restore();
		}
	});

	it("releases the editing host's tabindex with the listeners", () => {
		const { editor, blockId } = seedEditor();
		const host = document.createElement("div");
		document.body.append(host);
		const backend = new ExpandedContentEditableBackend(
			editor,
			stubController(blockId),
		);
		fixtures.push({ editor, backend, element: host });

		backend.activate(host);
		expect(host.getAttribute("tabindex")).toBe("-1");
		backend.deactivate();

		expect(host.hasAttribute("tabindex")).toBe(false);
	});

	it("survives a second detach without unbinding a live re-attach", () => {
		const { editor, blockId } = seedEditor();
		const element = inlineElement(blockId);
		const backend = new ContentEditableBackend(
			editor,
			stubController(blockId),
		);
		fixtures.push({ editor, backend, element });

		const ledger = installLedger();
		try {
			backend.activate(element, getYText(editor, blockId));
			backend.deactivate();
			backend.deactivate();
			backend.activate(element, getYText(editor, blockId));
			exercise(element);
			backend.deactivate();

			expect(ledger.outstanding()).toEqual([]);
			expect(ledger.liveObservers()).toBe(0);
		} finally {
			ledger.restore();
		}
	});
});
