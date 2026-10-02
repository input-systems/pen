// @vitest-environment jsdom

import type { DiagnosticEvent, SelectionRecord } from "@input/pen-types";
import { describe, expect, it } from "vitest";
import { HistorySelectionCoordinator } from "../historySelectionCoordinator";
import { SelectionProjectionController } from "../selectionProjectionController";
import type { ProjectionReadBack } from "../selectionReader";

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
	const controller = new SelectionProjectionController({
		historySelectionCoordinator: new HistorySelectionCoordinator({
			facet: () => undefined as never,
		}),
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
	return {
		controller,
		diagnostics,
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
		controller.syncDomSelectionOnce();
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
		controller.syncDomSelectionOnce();
		controller.syncDomSelectionOnce();
		expect(diagnostics).toHaveLength(1);
		controller.requestDivergenceProjection();
		expect(diagnostics.map((event) => event.trigger)).toEqual([
			"selection-change",
			"divergence",
		]);
		setVersion(2);
		controller.syncDomSelectionOnce();
		expect(diagnostics).toHaveLength(3);
	});

	it("P1: an equivalent read-back with focus on the target emits nothing", () => {
		const { controller, diagnostics } = createDroppingController(() => ({
			...DROPPED,
			equivalent: true,
			actual: DROPPED.expected,
		}));
		controller.syncDomSelectionOnce();
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
