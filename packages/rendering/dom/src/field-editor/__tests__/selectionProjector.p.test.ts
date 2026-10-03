// @vitest-environment jsdom

import type { DiagnosticEvent, SelectionRecord } from "@input/pen-types";
import { describe, expect, it } from "vitest";
import { SelectionProjector } from "../selectionProjector";
import {
	CLOSED_GESTURE_WINDOWS,
	nextGestureWindowState,
	type GestureEventKind,
	type ProjectionReadBack,
} from "../selectionReader";

function record(version: number): SelectionRecord {
	return {
		state: {
			type: "text",
			anchor: { blockId: "first", offset: 2 },
			focus: { blockId: "first", offset: 2 },
			affinity: "downstream",
			goalX: null,
		},
		version,
		origin: "programmatic",
		commitId: 0,
	};
}

/** A controller whose write lands nowhere: the read-back sees the old caret. */
function createDroppingController(readBack: () => ProjectionReadBack) {
	const element = document.createElement("span");
	document.body.append(element);
	const diagnostics: DiagnosticEvent[] = [];
	let writes = 0;
	let current = record(1);
	let windows = CLOSED_GESTURE_WINDOWS;
	const controller = new SelectionProjector({
		getGestureWindows: () => windows,
		isEditing: () => true,
		getMode: () => "single",
		getFocusBlockId: () => "first",
		getAttachedElement: () => element,
		getRootElement: () => document.body,
		findExpandedHost: () => null,
		resolveInlineElement: () => element,
		attachElement: () => true,
		requestDomFocus: () => true,
		updateBackendSelection: () => {
			writes += 1;
		},
		setTextSelection: () => {},
		activate: () => {},
		emitSelectionProjected: () => {},
		getRecord: () => current,
		emitDiagnostic: (event) => diagnostics.push(event),
		readBack: () => readBack(),
	});
	/** A gesture input as the reader delivers it: windows first, then the projector. */
	const gesture = (kind: GestureEventKind) => {
		windows = nextGestureWindowState(kind, windows);
		controller.onGesture(kind);
	};
	return {
		controller,
		diagnostics,
		gesture,
		writes: () => writes,
		setVersion: (version: number) => {
			current = record(version);
		},
	};
}

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

describe("selection projector read-back (W3.R1)", () => {
	it("P1: a read-back that does not map to the record emits selection-projection-mismatch with both values", () => {
		const { controller, diagnostics, writes } = createDroppingController(
			() => DROPPED,
		);
		controller.project("selection-change");
		expect(writes()).toBe(1);
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
		const { controller, diagnostics, setVersion } =
			createDroppingController(() => DROPPED);
		controller.project("selection-change");
		controller.project("selection-change");
		expect(diagnostics).toHaveLength(1);
		controller.requestDivergenceProjection();
		expect(diagnostics.map((event) => event.trigger)).toEqual([
			"selection-change",
			"divergence",
		]);
		setVersion(2);
		controller.project("selection-change");
		expect(diagnostics).toHaveLength(3);
	});

	it("P1: an equivalent read-back with focus on the target emits nothing", () => {
		const { controller, diagnostics } = createDroppingController(() => ({
			...DROPPED,
			equivalent: true,
			actual: DROPPED.expected,
		}));
		controller.project("selection-change");
		expect(diagnostics).toEqual([]);
	});
});

describe("selection projector rebuild projection (P3)", () => {
	it("P3: a rebuild of the mounted target projects the authority once with trigger target-rebuilt", () => {
		const { controller, diagnostics, writes } = createDroppingController(
			() => DROPPED,
		);
		controller.projectAfterRebuild(["first"]);
		expect(writes()).toBe(1);
		expect(diagnostics.map((event) => event.trigger)).toEqual([
			"target-rebuilt",
		]);
	});

	it("P3: a rebuild of a block that is not the projection target does not write", () => {
		const { controller, writes } = createDroppingController(() => DROPPED);
		controller.projectAfterRebuild(["second"]);
		expect(writes()).toBe(0);
	});

	it("HOST9: a P3 rebuild while a foreign input owns focus does not write", () => {
		const { controller, writes } = createDroppingController(() => DROPPED);
		const input = document.createElement("input");
		document.body.append(input);
		input.focus();
		try {
			controller.projectAfterRebuild(["first"]);
			expect(writes()).toBe(0);
		} finally {
			input.remove();
		}
	});
});

describe("selection projector non-text projection (S2)", () => {
	function placeNativeCaret(): HTMLElement {
		const text = document.createElement("span");
		text.textContent = "hello";
		document.body.append(text);
		document.getSelection()!.collapse(text.firstChild, 2);
		return text;
	}

	it("S2: projecting a block selection clears a native range inside the root", () => {
		const { controller } = createDroppingController(() => DROPPED);
		const text = placeNativeCaret();
		controller.projectNonTextSelection({
			type: "block",
			blockIds: ["first"],
		});
		expect(document.getSelection()!.rangeCount).toBe(0);
		text.remove();
	});

	it("S2: projecting a text selection leaves the native range alone", () => {
		const { controller } = createDroppingController(() => DROPPED);
		const text = placeNativeCaret();
		controller.projectNonTextSelection(record(1).state);
		expect(document.getSelection()!.rangeCount).toBe(1);
		text.remove();
	});

	it("HOST9: a null-selection projection while a foreign input owns focus does not clear", () => {
		const { controller } = createDroppingController(() => DROPPED);
		const input = document.createElement("input");
		document.body.append(input);
		input.focus();
		const text = placeNativeCaret();
		controller.projectNonTextSelection(null);
		expect(document.getSelection()!.rangeCount).toBe(1);
		input.remove();
		text.remove();
	});
});

describe("selection projector triggers and guards (W3.R6, W3.R7)", () => {
	const AGREEING: ProjectionReadBack = {
		...DROPPED,
		equivalent: true,
		actual: DROPPED.expected,
	};

	it("P1: a projection that finds the DOM equivalent and focus on target writes nothing", () => {
		const { controller, writes } = createDroppingController(() => AGREEING);
		controller.project("selection-change");
		expect(writes()).toBe(0);
		expect(controller.lastProjectedVersion).toBe(1);
	});

	it("P2: a divergence equal to the reported read-back is not re-projected", () => {
		const { controller, diagnostics, writes } = createDroppingController(
			() => DROPPED,
		);
		controller.project("selection-change");
		expect(diagnostics).toHaveLength(1);
		controller.requestDivergenceProjection(DROPPED.actual);
		expect(writes()).toBe(1);
		// A different divergent read is a new state and is answered.
		controller.requestDivergenceProjection({
			type: "text",
			anchor: { blockId: "first", offset: 1 },
			focus: { blockId: "first", offset: 1 },
		});
		expect(writes()).toBe(2);
	});

	it("P1: projection is withheld while composing in the target field and runs once on compositionend-completed", () => {
		const { controller, gesture, writes } = createDroppingController(
			() => DROPPED,
		);
		gesture("compositionstart");
		expect(controller.withholdForComposition()).toBe(true);
		controller.requestDivergenceProjection();
		controller.projectAfterRebuild(["first"]);
		expect(writes()).toBe(0);
		gesture("compositionend-completed");
		expect(writes()).toBe(1);
		gesture("compositionend-completed");
		expect(writes()).toBe(1);
	});
});

describe("selection projector equivalence skip (W3.R6)", () => {
	const AGREEING: ProjectionReadBack = {
		...DROPPED,
		equivalent: true,
		actual: DROPPED.expected,
	};

	function createAgreeingProjector(backendAgrees: boolean) {
		const element = document.createElement("span");
		document.body.append(element);
		const calls = { domWrites: 0, stateWrites: 0 };
		const projector = new SelectionProjector({
			getGestureWindows: () => CLOSED_GESTURE_WINDOWS,
			isEditing: () => true,
			getMode: () => "single",
			getFocusBlockId: () => "first",
			getAttachedElement: () => element,
			getRootElement: () => document.body,
			findExpandedHost: () => null,
			resolveInlineElement: () => element,
			attachElement: () => true,
			requestDomFocus: () => true,
			updateBackendSelection: () => {
				calls.domWrites += 1;
			},
			setTextSelection: () => {},
			activate: () => {},
			emitSelectionProjected: () => {},
			getRecord: () => record(1),
			readBack: () => AGREEING,
			backendSelectionAgrees: () => backendAgrees,
			writeBackendSelectionState: () => {
				calls.stateWrites += 1;
			},
		});
		return { projector, calls };
	}

	it("P1: a DOM that already shows the record and a backend that agrees is not written", () => {
		const { projector, calls } = createAgreeingProjector(true);
		projector.project("selection-change");
		expect(calls).toEqual({ domWrites: 0, stateWrites: 0 });
	});

	it("P1: when only the backend state lags, the projector writes that state and leaves the native range", () => {
		const { projector, calls } = createAgreeingProjector(false);
		projector.project("selection-change");
		expect(calls).toEqual({ domWrites: 0, stateWrites: 1 });
	});
});
