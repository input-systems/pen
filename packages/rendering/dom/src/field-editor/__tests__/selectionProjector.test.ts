// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import type { SelectionRecord } from "@input/pen-types";
import { HistorySelectionCoordinator } from "../historySelectionCoordinator";
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
		historySelectionCoordinator: new HistorySelectionCoordinator({
			facet: () => undefined as never,
		}),
		isEditing: () => true,
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
		activate: () => {},
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
