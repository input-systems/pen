import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import type { Editor } from "@input/pen-types";
import { vi } from "vitest";
import { collapsedRect } from "../../geometry/types";
import {
	createGeometryReader,
	type GeometryReaderHost,
} from "../../geometry/geometryReader";
import type { Point, Rect } from "../../geometry/types";
import { DomScheduler } from "../../scheduler";
import {
	OverlayController,
	type OverlayFieldSource,
} from "../overlayController";
import type { OverlayContributor } from "../types";

let frameQueue: FrameRequestCallback[] = [];

/** Deterministic frames: a flush runs only when the test calls `flushFrame`. */
export function installMockRaf(): void {
	frameQueue = [];
	vi.stubGlobal(
		"requestAnimationFrame",
		(callback: FrameRequestCallback): number => {
			frameQueue.push(callback);
			return frameQueue.length;
		},
	);
}

export function pendingFrames(): number {
	return frameQueue.length;
}

export function flushFrame(): void {
	const batch = frameQueue.splice(0);
	for (const callback of batch) {
		callback(0);
	}
}

export type FieldSnapshot = ReturnType<OverlayFieldSource["getSnapshot"]>;

export type OverlayFixture = {
	readonly editor: Editor;
	readonly blockId: string;
	readonly root: HTMLElement;
	readonly scheduler: DomScheduler;
	readonly reader: GeometryReaderHost;
	readonly controller: OverlayController;
	/** Measure-adapter call counts, so tests can assert zero reads. */
	readonly measured: { caret: number; block: number };
	/** Blocks the fake geometry treats as mounted. */
	readonly mounted: Set<string>;
	setField(patch: Partial<FieldSnapshot> & { readonly?: boolean }): void;
	destroy(): void;
};

/**
 * A headless controller over a fake geometry adapter: carets sit at
 * x = offset * 10 in a 20px-tall line, blocks are 100x20 boxes. jsdom has no
 * layout, so the layer origin reads as zero.
 */
export function createOverlayFixture(): OverlayFixture {
	const editor = createEditor({ schema: defaultSchema });
	const blockId = editor.firstBlock()!.id;
	editor.apply(
		[
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "hello world",
			},
		],
		{ origin: "system" },
	);
	const root = document.createElement("div");
	document.body.append(root);
	const measured = { caret: 0, block: 0 };
	const mounted = new Set([blockId]);
	const reader = createGeometryReader({
		root,
		observeResize: false,
		observeFonts: false,
		observeScroll: false,
		measure: {
			caretRect(point: Point): Rect | null {
				measured.caret += 1;
				return mounted.has(point.blockId)
					? collapsedRect(point.offset * 10, 0, 20)
					: null;
			},
			blockRect(id: string): Rect | null {
				measured.block += 1;
				return mounted.has(id) ? box(0, 0, 100, 20) : null;
			},
			rangeRects() {
				return [];
			},
		},
	});
	const scheduler = new DomScheduler("overlay-test", { geometry: reader });
	const unsubscribeCommit = editor.on("commit", (event) => {
		scheduler.acceptCommit(event);
	});
	// FieldEditorImpl forwards its own selection and state changes; the
	// fixture stands in for it.
	const unsubscribeSelection = editor.onSelectionChange((record) => {
		controller.notifySelectionChange(record);
	});
	let snapshot: FieldSnapshot = {
		isEditing: true,
		isFocused: true,
		isComposing: false,
		mode: "single",
		activeCellCoord: null,
	};
	let readonly = false;
	const field: OverlayFieldSource = {
		get isReadOnly() {
			return readonly;
		},
		getSnapshot: () => snapshot,
	};
	const controller = new OverlayController({
		root,
		editor,
		field,
		reader,
		scheduler,
	});
	controller.attach(field);
	return {
		editor,
		blockId,
		root,
		scheduler,
		reader,
		controller,
		measured,
		mounted,
		setField(patch) {
			const { readonly: nextReadonly, ...rest } = patch;
			snapshot = { ...snapshot, ...rest };
			if (nextReadonly !== undefined) {
				readonly = nextReadonly;
			}
			controller.notifyFieldChange();
		},
		destroy() {
			unsubscribeCommit();
			unsubscribeSelection();
			controller.dispose();
			reader.dispose();
			root.remove();
			editor.destroy();
		},
	};
}

/** A contributor that asks for one local caret at the record's focus. */
export function focusCaretContributor(): OverlayContributor {
	return {
		id: "test-focus-caret",
		requests: ({ selection }) => {
			const state = selection.state;
			if (state?.type !== "text") {
				return [];
			}
			return [
				{
					kind: "caret",
					key: "local",
					role: "local",
					point: state.focus,
					affinity: state.affinity,
				},
			];
		},
	};
}

export function box(x: number, y: number, width: number, height: number): Rect {
	return {
		x,
		y,
		left: x,
		top: y,
		width,
		height,
		right: x + width,
		bottom: y + height,
	};
}
