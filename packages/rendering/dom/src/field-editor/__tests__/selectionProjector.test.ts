// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import type { SelectionRecord } from "@input/pen-types";
import { DATA_ATTRS } from "../../utils/dataAttributes";
import { SelectionProjector } from "../selectionProjector";
import { CLOSED_GESTURE_WINDOWS } from "../selectionReader";

function programmaticRecord(
	blockId: string,
	anchorOffset: number,
	focusOffset: number,
	version = 1,
): SelectionRecord {
	return {
		state: {
			type: "text",
			anchor: { blockId, offset: anchorOffset },
			focus: { blockId, offset: focusOffset },
			affinity: "downstream",
			goalX: null,
		},
		version,
		origin: "programmatic",
		commitId: 0,
	};
}

function createController(
	initialRecord: SelectionRecord | null = null,
	overrides: {
		getMode?: () => "inactive" | "single" | "expanded" | "block";
		getAttachedElement?: () => HTMLElement | null;
		getRootElement?: () => HTMLElement | null;
		resolveInlineElement?: () => HTMLElement | null;
		attachElement?: () => boolean;
		requestDomFocus?: () => boolean;
		emitDiagnostic?: (event: { code: string }) => void;
		isEditing?: () => boolean;
		activate?: (blockId: string) => void;
	} = {},
) {
	const setTextSelection: Array<{
		blockId: string;
		anchorOffset: number;
		focusOffset: number;
	}> = [];
	const diagnostics: Array<{ code: string }> = [];
	let record = initialRecord;
	const controller = new SelectionProjector({
		getGestureWindows: () => CLOSED_GESTURE_WINDOWS,
		isEditing: overrides.isEditing ?? (() => true),
		getMode: overrides.getMode ?? (() => "single"),
		getFocusBlockId: () => "first",
		getAttachedElement: overrides.getAttachedElement ?? (() => null),
		getRootElement: overrides.getRootElement ?? (() => null),
		findExpandedHost: () => null,
		resolveInlineElement: overrides.resolveInlineElement ?? (() => null),
		attachElement: overrides.attachElement ?? (() => false),
		requestDomFocus: overrides.requestDomFocus ?? (() => false),
		updateBackendSelection: () => {},
		setTextSelection: (blockId, anchorOffset, focusOffset) => {
			setTextSelection.push({ blockId, anchorOffset, focusOffset });
			record = programmaticRecord(
				blockId,
				anchorOffset,
				focusOffset,
				(record?.version ?? 0) + 1,
			);
		},
		activate: overrides.activate ?? (() => {}),
		emitSelectionProjected: () => {},
		getRecord: () => record,
		emitDiagnostic: (event) => {
			diagnostics.push(event);
			overrides.emitDiagnostic?.(event);
		},
	});
	return { controller, setTextSelection, diagnostics };
}

describe("SelectionProjector lastProjectedVersion", () => {
	it("does not clear lastProjectedVersion on reset", () => {
		const { controller } = createController();
		controller.recordProjectedVersion(9);
		controller.reset();
		expect(controller.lastProjectedVersion).toBe(9);
	});
});

describe("SelectionProjector gesture windows", () => {
	it("does not expose leftover suppress stubs", () => {
		const { controller } = createController();
		expect("shouldSuppressSelectionSync" in controller).toBe(false);
		expect("consumeDomSelectionProjectionSuppression" in controller).toBe(
			false,
		);
		expect("suppressNextDomSelectionProjection" in controller).toBe(false);
	});
});

describe("SelectionProjector park diagnostics", () => {
	it("T3: mode block does not clamp a multi-block text range onto the focused field", () => {
		const target = { isConnected: true } as HTMLElement;
		let attached = 0;
		const { controller, diagnostics } = createController(
			{
				state: {
					type: "text",
					anchor: { blockId: "first", offset: 0 },
					focus: { blockId: "last", offset: 3 },
					affinity: "downstream",
					goalX: null,
				},
				version: 11,
				origin: "pointer",
				commitId: 0,
			},
			{
				getMode: () => "block",
				resolveInlineElement: () => target,
				attachElement: () => {
					attached += 1;
					return true;
				},
				requestDomFocus: () => true,
			},
		);

		controller.project("selection-change");

		expect(attached).toBe(0);
		expect(controller.lastProjectedVersion).toBe(11);
		expect(controller.parkedProjectionVersion).toBeNull();
		expect(diagnostics.map((event) => event.code)).toEqual([]);
	});
});

describe("SelectionProjector shouldProjectSelectionAfterReconcile", () => {
	it("does not project while a native text input outside the editor owns focus", () => {
		const root = document.createElement("div");
		const attached = document.createElement("div");
		const input = document.createElement("input");
		root.append(attached);
		document.body.append(root, input);
		input.focus();

		const { controller } = createController(null, {
			getAttachedElement: () => attached,
			getRootElement: () => root,
		});

		expect(controller.shouldProjectSelectionAfterReconcile()).toBe(false);

		input.remove();
		root.remove();
	});

	it("projects when the attached field surface owns focus", () => {
		const root = document.createElement("div");
		const attached = document.createElement("div");
		attached.tabIndex = 0;
		root.append(attached);
		document.body.append(root);
		attached.focus();

		const { controller } = createController(null, {
			getAttachedElement: () => attached,
			getRootElement: () => root,
		});

		expect(controller.shouldProjectSelectionAfterReconcile()).toBe(true);

		root.remove();
	});
});

/** A root holding one text node with a native caret inside it. */
function rootWithNativeRange(): HTMLElement {
	const root = document.createElement("div");
	root.textContent = "text";
	document.body.append(root);
	const range = document.createRange();
	range.setStart(root.firstChild!, 2);
	document.getSelection()!.removeAllRanges();
	document.getSelection()!.addRange(range);
	return root;
}

describe("SelectionProjector non-text and settle projections (fuzz seeds 23, 37, 41)", () => {
	it("S2 D18: a null record clears the native range and completes without a text read-back", () => {
		const root = rootWithNativeRange();
		let attached = 0;
		const { controller, diagnostics } = createController(
			{ state: null, version: 5, origin: "restore", commitId: 0 },
			{
				getRootElement: () => root,
				resolveInlineElement: () => root,
				attachElement: () => {
					attached += 1;
					return true;
				},
			},
		);
		controller.project("selection-change");
		expect(document.getSelection()!.rangeCount).toBe(0);
		expect(attached, "no text projection ran").toBe(0);
		expect(controller.lastProjectedVersion).toBe(5);
		expect(diagnostics).toEqual([]);
		root.remove();
	});

	it("S2: a block record completes without a text read-back", () => {
		const root = rootWithNativeRange();
		let attached = 0;
		const { controller } = createController(
			{ state: { type: "block", blockIds: ["divider"], head: "divider" }, version: 6, origin: "keyboard", commitId: 0 },
			{
				getRootElement: () => root,
				resolveInlineElement: () => root,
				attachElement: () => {
					attached += 1;
					return true;
				},
			},
		);
		controller.project("selection-change");
		expect(attached).toBe(0);
		expect(controller.lastProjectedVersion).toBe(6);
		root.remove();
	});

	it("S2: a cell selection clears a native range outside its table and keeps an edited cell's caret", () => {
		const root = rootWithNativeRange();
		const table = document.createElement("div");
		table.setAttribute(DATA_ATTRS.editorBlock, "");
		table.setAttribute(DATA_ATTRS.blockId, "table");
		table.textContent = "cell";
		root.append(table);
		const cell = {
			type: "cell" as const,
			blockId: "table",
			anchor: { row: 0, col: 0 },
			head: { row: 0, col: 0 },
		};
		const { controller } = createController(null, { getRootElement: () => root });
		controller.projectNonTextSelection(cell);
		expect(document.getSelection()!.rangeCount, "a stale range outside the table").toBe(0);

		const caret = document.createRange();
		caret.setStart(table.firstChild!, 2);
		document.getSelection()!.addRange(caret);
		controller.projectNonTextSelection(cell);
		expect(document.getSelection()!.rangeCount, "the edited cell's caret stays").toBe(1);
		root.remove();
	});

	it("S2: pointerup projects the gesture's last record again", () => {
		let attached = 0;
		const { controller } = createController(programmaticRecord("first", 2, 2, 7), {
			resolveInlineElement: () => ({ isConnected: true }) as HTMLElement,
			attachElement: () => {
				attached += 1;
				return false;
			},
		});
		controller.onGesture("pointerup");
		expect(attached, "the record was projected at pointerup").toBe(1);
	});

	it("S2: a text record activates its block when the editor owns focus and no field is active", () => {
		const root = document.createElement("div");
		root.tabIndex = -1;
		document.body.append(root);
		root.focus();
		let editing = false;
		const activated: string[] = [];
		const { controller } = createController(programmaticRecord("p2", 0, 0, 3), {
			getRootElement: () => root,
			isEditing: () => editing,
			activate: (blockId) => {
				activated.push(blockId);
				editing = true;
			},
		});
		controller.project("selection-change");
		// The fake's focus block never moves, so target resolution activates again.
		expect(activated[0]).toBe("p2");
		root.blur();
		editing = false;
		activated.length = 0;
		controller.project("selection-change");
		expect(activated, "focus is elsewhere: the record waits").toEqual([]);
		root.remove();
	});
});

