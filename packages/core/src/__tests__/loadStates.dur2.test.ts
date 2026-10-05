import {
	getDocumentLoadReport,
	initBlockMap,
	yjsAdapter,
	type CRDTDiagnostic,
	type YjsCRDTDocument,
} from "@input/pen-yjs";
import type { DocumentOp } from "@input/pen-types";
import { describe, expect, it } from "vitest";

import { createDefaultSchema } from "./fixtures/testSchema";
import { createHeadlessEditor, defineBlock, prop } from "../index";

const noDefaultExtensionsPreset = {
	resolve() {
		return { extensions: [] };
	},
};

async function flushMicrotasks(count = 2): Promise<void> {
	for (let index = 0; index < count; index++) {
		await Promise.resolve();
	}
}

function seedParagraph(
	adapter: ReturnType<typeof yjsAdapter>,
	blockId: string,
): YjsCRDTDocument {
	const doc = adapter.createDocument() as YjsCRDTDocument;
	adapter.transact(doc, () => {
		initBlockMap(doc.penDocument.blocks, blockId, "paragraph", "inline");
		doc.penDocument.blockOrder.push([blockId]);
	});
	return doc;
}

describe("editor load recovery events (DUR2)", () => {
	it("DUR2: editor.loadDocument emits crdt:recovered after a repaired load", async () => {
		const adapter = yjsAdapter();
		const source = seedParagraph(adapter, "b1");
		source.ydoc.transact(() => {
			source.penDocument.blockOrder.push(["b1"]);
		});
		const loaded = adapter.loadDocument(adapter.encodeState(source));

		const editor = createHeadlessEditor({
			crdt: adapter,
			schema: createDefaultSchema(),
			preset: noDefaultExtensionsPreset,
		});
		const recovered: string[] = [];
		editor.on("crdt:recovered", (method) => {
			recovered.push(method);
		});

		editor.loadDocument(loaded);
		await flushMicrotasks(8);

		expect(recovered).toEqual(["repair"]);
		expect(editor.getBlock("b1")?.type).toBe("paragraph");

		editor.destroy();
	});

	it("DUR2: editor.loadDocument does not emit crdt:recovered for an ok load", async () => {
		const adapter = yjsAdapter();
		const source = seedParagraph(adapter, "b1");
		const loaded = adapter.loadDocument(adapter.encodeState(source));

		const editor = createHeadlessEditor({
			crdt: adapter,
			schema: createDefaultSchema(),
			preset: noDefaultExtensionsPreset,
		});
		const recovered: string[] = [];
		editor.on("crdt:recovered", (method) => {
			recovered.push(method);
		});

		editor.loadDocument(loaded);
		await flushMicrotasks(8);

		expect(recovered).toEqual([]);
		expect(editor.getBlock("b1")?.type).toBe("paragraph");

		editor.destroy();
	});
});

/** A container shaped like the built-in `toggle`: inline title, collapsible. */
const nestingToggle = defineBlock("nestingToggle", {
	content: "inline",
	isContainer: true,
	props: {
		open: prop.boolean().default(false),
		parentId: prop.string().optional(),
	},
});

const nestedSchema = createDefaultSchema().extend([nestingToggle]);

const insert = (blockId: string, blockType: string, position: unknown, props = {}) =>
	({ type: "insert-block", blockId, blockType, props, position }) as DocumentOp;

describe("loading a saved nested document (DUR2, RI6)", () => {
	it("DUR2: children-array and parentId children load ok, unchanged, through editor.loadDocument", async () => {
		const adapter = yjsAdapter();
		const author = createHeadlessEditor({ crdt: adapter, schema: nestedSchema, preset: noDefaultExtensionsPreset });
		author.apply(
			[
				insert("toggle", "nestingToggle", "last"),
				insert("inner", "nestingToggle", { parent: "toggle", index: 0 }),
				insert("deep", "paragraph", { parent: "inner", index: 0 }),
				insert("routed", "paragraph", { after: "toggle" }, { parentId: "toggle" }),
				insert("tail", "paragraph", "last"),
			],
			{ origin: "user" },
		);
		const savedOrder = [...author.documentState.blockOrder];
		const savedPreorder = [...author.documentState.preorderBlockIds()];
		const bytes = adapter.encodeState(author.internals.crdtDoc);
		author.destroy();

		const diagnostics: CRDTDiagnostic[] = [];
		const recovered: string[] = [];
		const loader = yjsAdapter({
			onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
			onRecovered: (method) => recovered.push(method),
		});
		const editor = createHeadlessEditor({ crdt: loader, schema: nestedSchema, preset: noDefaultExtensionsPreset });
		editor.on("crdt:recovered", (method) => {
			recovered.push(method);
		});
		// editor construction emits adapter diagnostics of its own; only the
		// load's are under test
		diagnostics.length = 0;
		const loaded = loader.loadDocument(bytes) as YjsCRDTDocument;

		// children-array children are absent from the root order by design,
		// and the load must not write them into it
		expect(savedOrder).not.toContain("inner");
		expect(savedOrder).not.toContain("deep");
		expect(loaded.penDocument.blockOrder.toArray()).toEqual(savedOrder);
		expect(getDocumentLoadReport(loaded)).toEqual({ state: "ok", diagnostics: [] });

		editor.loadDocument(loaded);
		await flushMicrotasks(8);

		expect(editor.documentState.blockOrder).toEqual(savedOrder);
		expect([...editor.documentState.preorderBlockIds()]).toEqual(savedPreorder);
		expect(editor.documentState.childrenOf("toggle")).toEqual(["inner", "routed"]);
		expect(editor.documentState.childrenOf("inner")).toEqual(["deep"]);
		expect(diagnostics).toEqual([]);
		expect(recovered).toEqual([]);

		editor.destroy();
	});
});
