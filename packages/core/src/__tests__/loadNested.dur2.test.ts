import {
	getDocumentLoadReport,
	yjsAdapter,
	type CRDTDiagnostic,
	type YjsCRDTDocument,
} from "@input/pen-yjs";
import { describe, expect, it } from "vitest";

import {
	createHeadlessEditor,
	defineBlock,
	mergeSchemas,
	prop,
	SchemaRegistryImpl,
} from "../index";
import { createDefaultSchema } from "./fixtures/testSchema";

const noDefaultExtensionsPreset = {
	resolve() {
		return { extensions: [] };
	},
};

/** A container shaped like the built-in `toggle`: inline title, collapsible. */
const nestingToggle = defineBlock("nestingToggle", {
	content: "inline",
	isContainer: true,
	props: {
		open: prop.boolean().default(false),
		parentId: prop.string().optional(),
	},
});

const schema = mergeSchemas(
	createDefaultSchema(),
	new SchemaRegistryImpl({ blocks: [nestingToggle], inlines: [] }),
);

async function flushMicrotasks(count = 8): Promise<void> {
	for (let index = 0; index < count; index++) {
		await Promise.resolve();
	}
}

describe("loading a saved nested document (DUR2, RI6)", () => {
	it("DUR2: children-array and parentId children load ok, unchanged, through editor.loadDocument", async () => {
		const adapter = yjsAdapter();
		const author = createHeadlessEditor({
			crdt: adapter,
			schema,
			preset: noDefaultExtensionsPreset,
		});
		author.apply(
			[
				{
					type: "insert-block",
					blockId: "toggle",
					blockType: "nestingToggle",
					props: {},
					position: "last",
				},
				{
					type: "insert-block",
					blockId: "inner",
					blockType: "nestingToggle",
					props: {},
					position: { parent: "toggle", index: 0 },
				},
				{
					type: "insert-block",
					blockId: "deep",
					blockType: "paragraph",
					props: {},
					position: { parent: "inner", index: 0 },
				},
				{
					type: "insert-block",
					blockId: "routed",
					blockType: "paragraph",
					props: { parentId: "toggle" },
					position: { after: "toggle" },
				},
				{
					type: "insert-block",
					blockId: "tail",
					blockType: "paragraph",
					props: {},
					position: "last",
				},
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
		const editor = createHeadlessEditor({
			crdt: loader,
			schema,
			preset: noDefaultExtensionsPreset,
		});
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
		expect(getDocumentLoadReport(loaded)).toEqual({
			state: "ok",
			diagnostics: [],
		});

		editor.loadDocument(loaded);
		await flushMicrotasks();

		expect(editor.documentState.blockOrder).toEqual(savedOrder);
		expect([...editor.documentState.preorderBlockIds()]).toEqual(
			savedPreorder,
		);
		expect(editor.documentState.childrenOf("toggle")).toEqual([
			"inner",
			"routed",
		]);
		expect(editor.documentState.childrenOf("inner")).toEqual(["deep"]);
		expect(diagnostics).toEqual([]);
		expect(recovered).toEqual([]);

		editor.destroy();
	});
});
