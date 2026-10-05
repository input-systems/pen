// @vitest-environment jsdom
import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import type { DocumentOp } from "@input/pen-types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isForeignNativeTextEntryTarget } from "../../utils/textEntryTarget";
import { DATA_ATTRS } from "../../utils/dataAttributes";
import { createDocumentTree } from "../documentTree";
import { mountEditor } from "../mountEditor";

type SurfaceMode = "inactive" | "single" | "expanded" | "block";

const cleanups: Array<() => void> = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
	document.body.replaceChildren();
});

/** `mountEditor` over the first block plus `blocks`, each holding its id (or `text`) as text. */
function mount(blocks: Array<{ id: string; type: string; text?: string }> = []) {
	const editor = createEditor({ schema: defaultSchema });
	const ops: DocumentOp[] = blocks.flatMap(({ id, type, text }) => [
		{ type: "insert-block", blockId: id, blockType: type, props: {}, position: "last" } as const,
		{ type: "splice-text", blockId: id, from: 0, to: 0, insert: text ?? id } as const,
	]);
	if (ops.length > 0) editor.apply(ops, { origin: "system" });
	const root = document.createElement("div");
	document.body.append(root);
	const mounted = mountEditor(editor, root);
	cleanups.push(() => {
		mounted.destroy();
		editor.destroy();
	});
	const host = root.querySelector(`[${DATA_ATTRS.editorBlocksHost}]`) as HTMLElement;
	return { editor, mounted, host, first: editor.firstBlock()!.id };
}

/** The host's structure: block ids, with each list group as a nested array. */
function structure(host: Element): unknown[] {
	return [...host.children].map((child) =>
		child.hasAttribute("data-pen-list-group")
			? [...child.children].map((item) => item.getAttribute("data-block-id"))
			: child.getAttribute("data-block-id"),
	);
}

/** The block ids whose element subtree saw a DOM mutation. */
function touchedBlocks(records: MutationRecord[]): string[] {
	const ids = new Set<string>();
	for (const record of records) {
		const node = record.target instanceof Element ? record.target : record.target.parentElement;
		const id = node?.closest("[data-pen-editor-block]")?.getAttribute("data-block-id");
		if (id) ids.add(id);
	}
	return [...ids];
}

describe("vanilla document tree", () => {
	it("AX1: mountEditor groups list runs and reorder moves nodes without recreating them", () => {
		const types = ["bulletListItem", "bulletListItem", "paragraph", "bulletListItem"];
		const { editor, host, first } = mount(types.map((type, index) => ({ id: `b${index + 1}`, type })));
		expect(structure(host)).toEqual([first, ["b1", "b2"], "b3", ["b4"]]);

		const group = host.querySelector("[data-pen-list-group]") as HTMLElement;
		expect(group.getAttribute("role")).toBe("list");
		expect(group.getAttribute("style")).toBeNull();
		const b2 = host.querySelector('[data-block-id="b2"]') as HTMLElement;
		expect(b2.getAttribute("role")).toBe("listitem");
		expect(b2.getAttribute("aria-level")).toBe("1");
		expect(b2.getAttribute("aria-posinset")).toBe("2");
		expect(b2.getAttribute("aria-setsize")).toBe("2");
		expect(host.querySelector('[data-block-id="b3"]')?.hasAttribute("role")).toBe(false);
		expect(host.querySelectorAll("ul, ol, li")).toHaveLength(0);

		// Converting the paragraph between the runs merges them; nodes move.
		const nodes = new Map(["b1", "b2", "b3", "b4"].map((id) => [id, host.querySelector(`[data-block-id="${id}"]`)]));
		editor.apply([{ type: "set-props", blockId: "b3", props: { type: "bulletListItem" } }], { origin: "user" });
		expect(structure(host)).toEqual([first, ["b1", "b2", "b3", "b4"]]);
		expect(host.querySelectorAll("[data-pen-list-group]")).toHaveLength(1);
		expect(host.querySelector('[data-block-id="b4"]')?.getAttribute("aria-posinset")).toBe("4");

		// A move out of the group and back keeps every node.
		editor.apply([{ type: "move-block", blockId: "b2", position: { before: first } }], { origin: "user" });
		expect(structure(host)).toEqual([["b2"], first, ["b1", "b3", "b4"]]);
		editor.apply([{ type: "move-block", blockId: "b2", position: { after: "b1" } }], { origin: "user" });
		expect(structure(host)).toEqual([first, ["b1", "b2", "b3", "b4"]]);
		for (const [id, node] of nodes) {
			expect(host.querySelector(`[data-block-id="${id}"]`)).toBe(node);
		}

		// Leaving the list drops the item attributes.
		editor.apply([{ type: "set-props", blockId: "b4", props: { type: "paragraph" } }], { origin: "user" });
		const b4 = host.querySelector('[data-block-id="b4"]') as HTMLElement;
		expect(b4.hasAttribute("role")).toBe(false);
		expect(b4.hasAttribute("aria-setsize")).toBe(false);
		expect(structure(host)).toEqual([first, ["b1", "b2", "b3"], "b4"]);
	});

	it("SCALE6: the vanilla tree updates only notified blocks", () => {
		const blocks = Array.from({ length: 199 }, (_, index) => ({
			id: `b${index + 1}`,
			type: "paragraph",
			text: `block ${index + 1}`,
		}));
		const { editor, host } = mount(blocks);
		expect(host.children).toHaveLength(200);

		const observer = new MutationObserver(() => {});
		observer.observe(host, { subtree: true, childList: true, attributes: true, characterData: true });
		editor.apply([{ type: "splice-text", blockId: "b50", from: 0, to: 0, insert: "x" }], { origin: "user" });
		expect(touchedBlocks(observer.takeRecords())).toEqual(["b50"]);
		expect(host.querySelector('[data-block-id="b50"]')?.textContent).toBe("xblock 50");
		observer.disconnect();

		// A reorder moves only the node out of place.
		const insertBefore = host.insertBefore.bind(host);
		let moves = 0;
		host.insertBefore = ((node: Node, child: Node | null) => {
			moves += 1;
			return insertBefore(node, child);
		}) as typeof host.insertBefore;
		editor.apply([{ type: "move-block", blockId: "b150", position: { after: "b10" } }]);
		expect(moves).toBe(1);
		const order = [...host.children].map((element) => element.getAttribute("data-block-id"));
		expect(order.indexOf("b150")).toBe(order.indexOf("b10") + 1);
	});

	it("P4: the vanilla tree acks each block element it creates, connected, in the commit's turn", () => {
		const { editor, mounted } = mount();
		const ack = vi.spyOn(mounted.fieldEditor, "ackBlockMounted");

		editor.apply([{ type: "insert-block", blockId: "added", blockType: "paragraph", props: {}, position: "last" }]);

		const acked = ack.mock.calls.filter(([blockId]) => blockId === "added");
		expect(acked).toHaveLength(1);
		const element = acked[0]![1];
		expect(element.isConnected).toBe(true);
		expect(element.getAttribute(DATA_ATTRS.blockId)).toBe("added");
	});

	it("P4: a selection written to a block before it mounts is projected by that block's ack", () => {
		const { editor, mounted } = mount();
		const fieldEditor = mounted.fieldEditor as unknown as { projector: { lastProjectedVersion: number } };

		editor.apply([
			{ type: "insert-block", blockId: "added", blockType: "paragraph", props: {}, position: "last" },
			{ type: "splice-text", blockId: "added", from: 0, to: 0, insert: "Hi" },
		]);
		mounted.fieldEditor.activateTextSelection("added", 2, 2);

		expect(editor.selection).toMatchObject({ type: "text", anchor: { blockId: "added", offset: 2 } });
		expect(fieldEditor.projector.lastProjectedVersion).toBeGreaterThan(0);
	});
});

/** A document tree over a notifier whose surface mode the test sets. */
function mountTree() {
	const editor = createEditor({ schema: defaultSchema });
	let mode: SurfaceMode = "inactive";
	const surfaceListeners = new Set<() => void>();
	const fieldEditor = {
		blockNotifier: {
			subscribeListSegments: () => () => {},
			getListSegments: () => [],
			subscribeBlock: () => () => {},
			subscribeSurface: (listener: () => void) => {
				surfaceListeners.add(listener);
				return () => surfaceListeners.delete(listener);
			},
			getSurfaceSnapshot: () => ({ mode, activeBlockIds: [] }),
		},
		ackBlockMounted: () => {},
	};
	const root = document.createElement("div");
	root.setAttribute(DATA_ATTRS.editorRoot, "");
	document.body.append(root);
	const tree = createDocumentTree(editor, fieldEditor as never, root);
	cleanups.push(() => {
		tree.destroy();
		editor.destroy();
	});
	const setMode = (next: SurfaceMode) => {
		mode = next;
		for (const listener of surfaceListeners) listener();
	};
	return { root, blocksHost: tree.blocksHost, setMode, surfaceListeners, tree };
}

describe("HOST9: the vanilla document tree's expanded blocks host", () => {
	it("is marked as this editor's field surface while expanded, as the React and Vue hosts mark it", () => {
		const { root, blocksHost, setMode } = mountTree();
		expect(blocksHost.hasAttribute(DATA_ATTRS.fieldEditorSurface)).toBe(false);

		setMode("expanded");
		blocksHost.setAttribute("contenteditable", "true");
		expect(blocksHost.hasAttribute(DATA_ATTRS.fieldEditorSurface)).toBe(true);
		expect(blocksHost.hasAttribute(DATA_ATTRS.fieldEditorActiveSurface)).toBe(true);
		expect(blocksHost.getAttribute("role")).toBe("textbox");
		expect(blocksHost.getAttribute("aria-multiline")).toBe("true");
		// Unmarked, its contenteditable read as a foreign text control, and a
		// return to a single block attached passively and lost keyboard input.
		expect(isForeignNativeTextEntryTarget(blocksHost, root)).toBe(false);
	});

	it("drops the marks when the selection leaves the expanded surface", () => {
		const { blocksHost, setMode } = mountTree();
		setMode("expanded");
		setMode("single");
		expect(blocksHost.hasAttribute(DATA_ATTRS.fieldEditorSurface)).toBe(false);
		expect(blocksHost.hasAttribute(DATA_ATTRS.fieldEditorActiveSurface)).toBe(false);
		expect(blocksHost.hasAttribute("role")).toBe(false);
	});

	it("unsubscribes from the surface on destroy", () => {
		const { surfaceListeners, tree } = mountTree();
		expect(surfaceListeners.size).toBe(1);
		tree.destroy();
		expect(surfaceListeners.size).toBe(0);
	});
});
