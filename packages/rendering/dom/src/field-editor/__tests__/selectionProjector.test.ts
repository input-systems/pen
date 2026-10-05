// @vitest-environment jsdom

import type { SelectionRecord } from "@input/pen-types";
import { describe, expect, it } from "vitest";
import { DATA_ATTRS } from "../../utils/dataAttributes";
import type { ProjectionReadBack } from "../selectionReader";
import {
	createTestProjector,
	textRecord,
} from "./selectionProjector.testHelpers";

const CARET = textRecord({ blockId: "first", offset: 2 });

const DROPPED: ProjectionReadBack = {
	equivalent: false,
	focusOnTarget: true,
	expected: {
		type: "text",
		anchor: { blockId: "first", offset: 2 },
		focus: { blockId: "first", offset: 2 },
	},
	actual: {
		type: "text",
		anchor: { blockId: "first", offset: 0 },
		focus: { blockId: "first", offset: 0 },
	},
};

const AGREEING: ProjectionReadBack = {
	...DROPPED,
	equivalent: true,
	actual: DROPPED.expected,
};

/** A projector whose write lands nowhere: the read-back sees the old caret. */
function createDroppingProjector() {
	return createTestProjector({ readBack: () => DROPPED });
}

/** A text node holding a native caret, appended to `parent`. */
function placeNativeCaret(parent: HTMLElement = document.body): HTMLElement {
	const text = document.createElement("span");
	text.textContent = "hello";
	parent.append(text);
	document.getSelection()!.collapse(text.firstChild, 2);
	return text;
}

/** Counts `attachElement` calls: each is a text projection into a field. */
function countingAttach(result = true) {
	const counter = {
		attached: 0,
		attachElement: () => {
			counter.attached += 1;
			return result;
		},
	};
	return counter;
}

describe("selection projector read-back (P)", () => {
	it("P1: a read-back that does not map to the record emits selection-projection-mismatch with both values", () => {
		const { projector, diagnostics, calls } = createDroppingProjector();
		projector.project("selection-change");
		expect(calls.backendWrites).toBe(1);
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]).toMatchObject({
			code: "selection-projection-mismatch",
			version: 1,
			trigger: "selection-change",
			expected: DROPPED.expected,
			actual: DROPPED.actual,
			surface: "text",
		});
	});

	it("P1: a mismatch is reported once per version and trigger, and a new version reports again", () => {
		const { projector, diagnostics, setRecord } = createDroppingProjector();
		projector.project("selection-change");
		projector.project("selection-change");
		expect(diagnostics).toHaveLength(1);
		projector.requestDivergenceProjection();
		expect(diagnostics.map((event) => event.trigger)).toEqual([
			"selection-change",
			"divergence",
		]);
		setRecord({ ...CARET, version: 2 });
		projector.project("selection-change");
		expect(diagnostics).toHaveLength(3);
	});

	it("P1: an equivalent read-back with focus on the target emits nothing and writes nothing", () => {
		const { projector, diagnostics, calls } = createTestProjector({
			readBack: () => AGREEING,
		});
		projector.project("selection-change");
		expect(diagnostics).toEqual([]);
		expect(calls.backendWrites).toBe(0);
		expect(projector.lastProjectedVersion).toBe(1);
	});

	it.each([
		[true, { domWrites: 0, stateWrites: 0 }],
		[false, { domWrites: 0, stateWrites: 1 }],
	])(
		"P1: an equivalent DOM with backend agreement %s writes only the lagging backend state",
		(backendAgrees, expected) => {
			let stateWrites = 0;
			const { projector, calls } = createTestProjector({
				readBack: () => AGREEING,
				backendSelectionAgrees: () => backendAgrees,
				writeBackendSelectionState: () => {
					stateWrites += 1;
				},
			});
			projector.project("selection-change");
			expect({ domWrites: calls.backendWrites, stateWrites }).toEqual(
				expected,
			);
		},
	);

	it("P2: a divergence equal to the reported read-back is not re-projected", () => {
		const { projector, diagnostics, calls } = createDroppingProjector();
		projector.project("selection-change");
		expect(diagnostics).toHaveLength(1);
		projector.requestDivergenceProjection(DROPPED.actual);
		expect(calls.backendWrites).toBe(1);
		// A different divergent read is a new state and is answered.
		projector.requestDivergenceProjection({
			type: "text",
			anchor: { blockId: "first", offset: 1 },
			focus: { blockId: "first", offset: 1 },
		});
		expect(calls.backendWrites).toBe(2);
	});

	it("P1: projection is withheld while composing in the target field and runs once on compositionend-completed", () => {
		const { projector, gesture, calls } = createDroppingProjector();
		gesture("compositionstart");
		expect(projector.withholdForComposition()).toBe(true);
		projector.requestDivergenceProjection();
		projector.projectAfterRebuild(["first"]);
		expect(calls.backendWrites).toBe(0);
		gesture("compositionend-completed");
		expect(calls.backendWrites).toBe(1);
		gesture("compositionend-completed");
		expect(calls.backendWrites).toBe(1);
	});

	it("keeps lastProjectedVersion across reset", () => {
		const { projector } = createTestProjector();
		projector.recordProjectedVersion(9);
		projector.reset();
		expect(projector.lastProjectedVersion).toBe(9);
	});

	it("S4: does not expose leftover suppress stubs", () => {
		const { projector } = createTestProjector();
		expect("shouldSuppressSelectionSync" in projector).toBe(false);
		expect("consumeDomSelectionProjectionSuppression" in projector).toBe(
			false,
		);
		expect("suppressNextDomSelectionProjection" in projector).toBe(false);
	});
});

describe("selection projector rebuild projection (P3, HOST9)", () => {
	it("P3: a rebuild of the mounted target projects the authority once with trigger target-rebuilt", () => {
		const { projector, diagnostics, element, calls } =
			createDroppingProjector();
		element.tabIndex = -1;
		element.focus();
		projector.projectAfterRebuild(["first"]);
		expect(calls.backendWrites).toBe(1);
		expect(diagnostics.map((event) => event.trigger)).toEqual([
			"target-rebuilt",
		]);
	});

	it("P3: a rebuild of a block that is not the projection target does not write", () => {
		const { projector, calls } = createDroppingProjector();
		projector.projectAfterRebuild(["second"]);
		expect(calls.backendWrites).toBe(0);
	});

	it("HOST9: a P3 rebuild while a foreign input owns focus does not write", () => {
		const { projector, calls } = createDroppingProjector();
		const input = document.createElement("input");
		document.body.append(input);
		input.focus();
		projector.projectAfterRebuild(["first"]);
		expect(calls.backendWrites).toBe(0);
		input.remove();
	});

	it("HOST9: does not project after reconcile while a native text input outside the editor owns focus", () => {
		const root = document.createElement("div");
		const attached = document.createElement("div");
		const input = document.createElement("input");
		root.append(attached);
		document.body.append(root, input);
		input.focus();
		const { projector } = createTestProjector({
			getAttachedElement: () => attached,
			getRootElement: () => root,
		});
		expect(projector.shouldProjectSelectionAfterReconcile()).toBe(false);

		attached.tabIndex = 0;
		attached.focus();
		expect(projector.shouldProjectSelectionAfterReconcile()).toBe(true);
		input.remove();
		root.remove();
	});
});

describe("selection projector non-text projection (S2, T3)", () => {
	it("S2: projecting a block selection clears a native range inside the root", () => {
		const { projector } = createDroppingProjector();
		const text = placeNativeCaret();
		projector.projectNonTextSelection({
			type: "block",
			blockIds: ["first"],
		});
		expect(document.getSelection()!.rangeCount).toBe(0);
		text.remove();
	});

	it("S2: the pointerup projection clears the caret a drag left under a block record with no active field", () => {
		const { gesture } = createTestProjector(
			{ readBack: () => DROPPED, isEditing: () => false },
			{
				...CARET,
				version: 2,
				state: { type: "block", blockIds: ["first"], head: "first" },
			},
		);
		gesture("pointerdown");
		const text = placeNativeCaret();
		gesture("pointerup");
		expect(document.getSelection()!.rangeCount).toBe(0);
		text.remove();
	});

	it("S2: projecting a text selection leaves the native range alone", () => {
		const { projector } = createDroppingProjector();
		const text = placeNativeCaret();
		projector.projectNonTextSelection(CARET.state);
		expect(document.getSelection()!.rangeCount).toBe(1);
		text.remove();
	});

	it("HOST9: a null-selection projection while a foreign input owns focus does not clear", () => {
		const { projector } = createDroppingProjector();
		const input = document.createElement("input");
		document.body.append(input);
		input.focus();
		const text = placeNativeCaret();
		projector.projectNonTextSelection(null);
		expect(document.getSelection()!.rangeCount).toBe(1);
		input.remove();
		text.remove();
	});

	it.each<[string, SelectionRecord["state"]]>([
		["null", null],
		["block", { type: "block", blockIds: ["divider"], head: "divider" }],
	])(
		"S2: a %s record clears the native range and completes without a text read-back",
		(_label, state) => {
			const root = document.createElement("div");
			document.body.append(root);
			placeNativeCaret(root);
			const attach = countingAttach();
			const { projector, diagnostics } = createTestProjector(
				{
					getRootElement: () => root,
					resolveInlineElement: () => root,
					attachElement: attach.attachElement,
				},
				{ state, version: 5, origin: "restore", commitId: 0 },
			);
			projector.project("selection-change");
			expect(document.getSelection()!.rangeCount).toBe(0);
			expect(attach.attached, "no text projection ran").toBe(0);
			expect(projector.lastProjectedVersion).toBe(5);
			expect(diagnostics).toEqual([]);
			root.remove();
		},
	);

	it("T3: mode block does not clamp a multi-block text range onto the focused field", () => {
		const attach = countingAttach();
		const { projector, diagnostics } = createTestProjector(
			{
				getMode: () => "block",
				resolveInlineElement: () =>
					({ isConnected: true }) as HTMLElement,
				attachElement: attach.attachElement,
			},
			textRecord(
				{ blockId: "first", offset: 0 },
				{ blockId: "last", offset: 3 },
				{ version: 11, origin: "pointer" },
			),
		);
		projector.project("selection-change");
		expect(attach.attached).toBe(0);
		expect(projector.lastProjectedVersion).toBe(11);
		expect(projector.parkedProjectionVersion).toBeNull();
		expect(diagnostics).toEqual([]);
	});

	it("S2: a cell selection clears a native range outside its table and keeps an edited cell's caret", () => {
		const root = document.createElement("div");
		document.body.append(root);
		placeNativeCaret(root);
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
		const { projector } = createTestProjector({
			getRootElement: () => root,
		});
		projector.projectNonTextSelection(cell);
		expect(
			document.getSelection()!.rangeCount,
			"a stale range outside the table",
		).toBe(0);

		document.getSelection()!.collapse(table.firstChild, 2);
		projector.projectNonTextSelection(cell);
		expect(
			document.getSelection()!.rangeCount,
			"the edited cell's caret stays",
		).toBe(1);
		root.remove();
	});

	it("S2: pointerup projects the gesture's last record again", () => {
		const attach = countingAttach(false);
		const { projector } = createTestProjector(
			{
				resolveInlineElement: () =>
					({ isConnected: true }) as HTMLElement,
				attachElement: attach.attachElement,
			},
			{ ...CARET, version: 7 },
		);
		projector.onGesture("pointerup");
		expect(attach.attached, "the record was projected at pointerup").toBe(
			1,
		);
	});

	it("S2: a text record activates its block when the editor owns focus and no field is active", () => {
		const root = document.createElement("div");
		root.tabIndex = -1;
		document.body.append(root);
		root.focus();
		let editing = false;
		const activated: string[] = [];
		const { projector } = createTestProjector(
			{
				getRootElement: () => root,
				isEditing: () => editing,
				activate: (blockId) => {
					activated.push(blockId);
					editing = true;
				},
			},
			textRecord({ blockId: "p2", offset: 0 }, undefined, { version: 3 }),
		);
		projector.project("selection-change");
		// The fake's focus block never moves, so target resolution activates again.
		expect(activated[0]).toBe("p2");
		root.blur();
		editing = false;
		activated.length = 0;
		projector.project("selection-change");
		expect(activated, "focus is elsewhere: the record waits").toEqual([]);
		root.remove();
	});
});

describe("selection projector substitute states for ranges over 50 blocks (S2, P4)", () => {
	function rangeRecord(version: number, focusBlockId: string) {
		return textRecord(
			{ blockId: "first", offset: 0 },
			{ blockId: focusBlockId, offset: 3 },
			{ version },
		);
	}

	/** A 2-block range the engine confined to its anchor field. */
	const CONFINED: ProjectionReadBack = {
		equivalent: false,
		focusOnTarget: true,
		expected: {
			type: "text",
			anchor: { blockId: "first", offset: 0 },
			focus: { blockId: "second", offset: 3 },
		},
		actual: {
			type: "text",
			anchor: { blockId: "first", offset: 0 },
			focus: { blockId: "first", offset: 5 },
		},
	};

	function mountBlock(blockId: string): HTMLElement {
		const block = document.createElement("div");
		block.setAttribute("data-block-id", blockId);
		document.body.append(block);
		return block;
	}

	/**
	 * Every port the projector could reach the DOM through counts its calls;
	 * the state reads (`getRecord`, `isBlockSurfaceRange`, the windows) do not.
	 */
	function createSubstituteProjector(
		current: SelectionRecord,
		blockSurface: boolean,
	) {
		const element = document.createElement("span");
		document.body.append(element);
		mountBlock("first");
		mountBlock("second");
		const counts = { domPort: 0, substituteFocus: 0, substituteChanges: 0 };
		const dom = <T>(value: T): T => {
			counts.domPort += 1;
			return value;
		};
		const fake = createTestProjector(
			{
				getMode: () => (blockSurface ? "block" : "expanded"),
				getAttachedElement: () => dom(null),
				getRootElement: () => dom(document.body),
				findExpandedHost: () => dom(element),
				resolveInlineElement: () => dom(element),
				attachElement: () => dom(true),
				requestDomFocus: () => dom(true),
				readBack: () => dom(CONFINED),
				isBlockSurfaceRange: () => blockSurface,
				projectSubstituteFocus: () => {
					counts.substituteFocus += 1;
				},
				onSubstituteChange: () => {
					counts.substituteChanges += 1;
				},
			},
			current,
		);
		/** The accessor's value, asserting it reached no DOM port. */
		const substitute = () => {
			const before = counts.domPort;
			const value = fake.projector.getSubstituteState();
			expect(counts.domPort - before).toBe(0);
			return value;
		};
		const writes = () => ({
			backendWrites: fake.calls.backendWrites,
			...counts,
		});
		return { ...fake, writes, substitute };
	}

	it("S2: getSubstituteState reports block-surface-range from the record, engine-confined-range after a fallback, and null while a pointer window withholds", () => {
		const surface = createSubstituteProjector(
			rangeRecord(1, "block-60"),
			true,
		);
		expect(surface.substitute()).toBe("block-surface-range");

		const dragged = createSubstituteProjector(
			rangeRecord(1, "block-60"),
			true,
		);
		dragged.gesture("pointerdown");
		dragged.projector.project("selection-change");
		expect(dragged.substitute()).toBeNull();
		expect(dragged.writes().substituteFocus).toBe(0);
		dragged.gesture("pointerup");
		expect(dragged.substitute()).toBe("block-surface-range");

		const confined = createSubstituteProjector(
			rangeRecord(1, "second"),
			false,
		);
		expect(confined.substitute()).toBeNull();
		confined.projector.project("selection-change");
		expect(confined.substitute()).toBe("engine-confined-range");
		confined.setRecord(rangeRecord(2, "second"));
		expect(confined.substitute()).toBeNull();
	});

	it("S2: a block-surface range is never written into a field; the pointerup projection applies the substitute once", () => {
		const { projector, writes, gesture } = createSubstituteProjector(
			rangeRecord(1, "block-60"),
			true,
		);
		gesture("pointerdown");
		projector.project("selection-change");
		expect(writes()).toMatchObject({
			backendWrites: 0,
			substituteFocus: 0,
		});
		gesture("pointerup");
		expect(writes()).toMatchObject({
			backendWrites: 0,
			substituteFocus: 1,
			substituteChanges: 1,
		});
		expect(projector.lastProjectedVersion).toBe(1);
	});

	it("S2: an engine-confined read-back falls back once with no mismatch diagnostic and is not written again", () => {
		const { projector, writes, diagnostics } = createSubstituteProjector(
			rangeRecord(1, "second"),
			false,
		);
		projector.project("selection-change");
		expect(diagnostics).toEqual([]);
		expect(writes()).toMatchObject({
			backendWrites: 1,
			substituteFocus: 1,
			substituteChanges: 1,
		});
		projector.project("target-rebuilt");
		expect(writes().backendWrites).toBe(1);
		expect(diagnostics).toEqual([]);
	});

	it("P4: an expanded range whose endpoint block is not mounted parks on that block and projects on its ack", () => {
		const { projector, calls } = createSubstituteProjector(
			rangeRecord(1, "restored"),
			false,
		);
		projector.project("selection-change");
		expect(calls.backendWrites).toBe(0);
		expect(projector.parkedProjectionVersion).toBe(1);
		const restored = mountBlock("restored");
		projector.ackBlockMounted("restored", restored);
		expect(calls.backendWrites).toBe(1);
		expect(projector.parkedProjectionVersion).toBeNull();
		restored.remove();
	});
});
