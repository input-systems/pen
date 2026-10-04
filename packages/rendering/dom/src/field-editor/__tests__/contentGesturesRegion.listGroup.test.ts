// @vitest-environment jsdom

import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import type { DocumentOp } from "@input/pen-types";
import { afterEach, describe, expect, it } from "vitest";

import { DATA_ATTRS } from "../../utils/dataAttributes";
import { RegionSelectionStore } from "../../utils/regionSelection";
import { createRegionGestures } from "../contentGesturesRegion";
import type { ContentGesturesContext } from "../contentGesturesShared";

afterEach(() => {
	document.body.replaceChildren();
});

function slot<T>(current: T): { current: T } {
	return { current };
}

function blockElement(blockId: string, top: number): HTMLElement {
	const element = document.createElement("div");
	element.setAttribute(DATA_ATTRS.editorBlock, "");
	element.setAttribute(DATA_ATTRS.blockId, blockId);
	element.getBoundingClientRect = () =>
		({ x: 0, y: top, top, bottom: top + 20, left: 0, right: 200, width: 200, height: 20, toJSON: () => ({}) }) as DOMRect;
	return element;
}

describe("region gestures over list groups", () => {
	it("FE5: region selection reaches list items inside a list group", () => {
		const editor = createEditor({ schema: defaultSchema });
		const first = editor.firstBlock()!.id;
		const ops: DocumentOp[] = ["b1", "b2"].map((blockId) => ({
			type: "insert-block",
			blockId,
			blockType: "bulletListItem",
			props: {},
			position: "last",
		}));
		editor.apply(ops, { origin: "system" });

		const root = document.createElement("div");
		root.setAttribute(DATA_ATTRS.editorRoot, "");
		const blocksHost = document.createElement("div");
		const group = document.createElement("div");
		group.setAttribute(DATA_ATTRS.listGroup, "");
		group.setAttribute("role", "list");
		group.append(blockElement("b1", 20), blockElement("b2", 40));
		blocksHost.append(blockElement(first, 0), group);
		root.append(blocksHost);
		document.body.append(root);

		const store = new RegionSelectionStore();
		store.setConfig({ enabled: true, threshold: 2, selectionMode: "block", activation: "whenInactive" });
		const ctx = {
			editor,
			fieldEditor: { deactivate() {} },
			gestureEl: root,
			currentEditorRoot: root,
			getBlocksHost: () => blocksHost,
			regionSelectionStore: store,
			regionGestureRef: slot({ clientX: 0, clientY: 25, isSelecting: true }),
			pointerGestureRef: slot(null),
			pointerGestureVersionRef: slot(0),
			interactionModelRef: slot({}),
			clearPointerSelectionState() {},
			blockSelectionEnabled: true,
			runSync: (run: () => void) => run(),
		} as unknown as ContentGesturesContext;

		const gestures = createRegionGestures(ctx);
		gestures.handleMouseMove(new MouseEvent("mousemove", { clientX: 100, clientY: 55 }));

		const selection = editor.selection;
		expect(selection?.type).toBe("block");
		expect(selection?.type === "block" ? [...selection.blockIds] : []).toEqual(["b1", "b2"]);
		editor.destroy();
	});
});
