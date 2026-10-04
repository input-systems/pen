import { yjsAdapter } from "@input/pen-yjs";
import { createDefaultSchema } from "./fixtures/testSchema";
import {
	defineBlock,
	defineExtension,
	mergeSchemas,
	SchemaRegistryImpl,
} from "@input/pen-core";
import { describe, expect, it } from "vitest";

import { createDocumentSession, createHeadlessEditor } from "../index";
import { createEditor } from "./editorCore.testHelpers";

const flowDisallowedWidget = defineBlock("widget", {
	content: "none",
	fieldEditor: "none",
	authoring: {
		flowCapability: "flow-disallowed",
	},
});

const flowPolicySchema = mergeSchemas(
	createDefaultSchema(),
	new SchemaRegistryImpl({
		blocks: [flowDisallowedWidget],
		inlines: [],
	}),
);

describe("@input/pen-core createEditor: sessions, profiles, and the flow mutation boundary", () => {
	it("installs extensions from presets before user extensions", () => {
		let presetInstalled = false;
		const editor = createEditor({
			preset: {
				resolve() {
					return {
						extensions: [
							defineExtension({
								name: "preset-test-extension",
								activateClient: async () => {
									presetInstalled = true;
								},
							}),
						],
					};
				},
			},
		});

		expect(presetInstalled).toBe(true);

		editor.destroy();
	});

	it("supports multiple editors sharing one document session", () => {
		const session = createDocumentSession({
			adapter: yjsAdapter(),
		});
		const editorA = createEditor({
			documentSession: session,
		});
		const editorB = createEditor({
			documentSession: session,
		});
		const blockId = editorA.firstBlock()!.id;

		editorA.apply([
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "Shared",
			},
		]);

		expect(editorB.getBlock(blockId)?.textContent()).toBe("Shared");
		expect(editorA.documentScope.id).toBe(editorB.documentScope.id);
		expect(editorA.internals.documentSession).toBe(session);
		expect(editorB.internals.documentSession).toBe(session);

		editorA.destroy();
		editorB.apply([
			{
				type: "splice-text",
				blockId,
				from: 6,
				to: 6,
				insert: " doc",
			},
		]);

		expect(editorB.getBlock(blockId)?.textContent()).toBe("Shared doc");

		editorB.destroy();
		session.destroy();
	});

	it("creates headless editors around caller-owned documents without default undo behavior", () => {
		const adapter = yjsAdapter();
		const document = adapter.createDocument();
		const editor = createHeadlessEditor({
			schema: createDefaultSchema(),
			crdt: adapter,
			document,
		});
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "Server edit",
			},
		]);

		expect(editor.getBlock(blockId)?.textContent()).toBe("Server edit");
		expect(editor.undoManager.undo()).toBe(false);

		editor.destroy();
	});

	it("does not destroy caller-owned documents on editor teardown", () => {
		const adapter = yjsAdapter();
		const document = adapter.createDocument();
		const editorA = createEditor({
			document,
		});
		const blockId = editorA.firstBlock()!.id;

		editorA.apply([
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "Persisted",
			},
		]);
		editorA.destroy();

		const editorB = createEditor({
			document,
		});

		expect(editorB.getBlock(blockId)?.textContent()).toBe("Persisted");

		editorB.destroy();
	});

	it("persists document profile metadata for new editors", () => {
		const editor = createEditor({
			documentProfile: "flow",
		});

		expect(editor.documentProfile).toBe("flow");
		expect(editor.documentState.documentProfile).toBe("flow");
		expect(editor.editorViewMode).toBe("flow");
		expect(
			editor.internals.adapter.getDocumentProfile?.(
				editor.internals.crdtDoc,
			),
		).toBe("flow");

		editor.destroy();
	});

	it("loads persisted document profile independently from local editor view mode", () => {
		const adapter = yjsAdapter();
		const document = adapter.createDocument();
		adapter.setDocumentProfile?.(document, "flow");

		const editor = createEditor({
			document,
			editorViewMode: "structured",
		});

		expect(editor.documentProfile).toBe("flow");
		expect(editor.documentState.documentProfile).toBe("flow");
		expect(editor.editorViewMode).toBe("structured");

		editor.destroy();
	});

	it("keeps document profile in sync with persisted metadata changes", () => {
		const adapter = yjsAdapter();
		const document = adapter.createDocument();
		const editor = createEditor({
			document,
		});

		expect(editor.documentProfile).toBe("structured");
		expect(editor.documentState.documentProfile).toBe("structured");

		adapter.setDocumentProfile?.(document, "flow");

		expect(editor.documentProfile).toBe("flow");
		expect(editor.documentState.documentProfile).toBe("flow");
		expect(editor.editorViewMode).toBe("flow");

		editor.destroy();
	});

	it("drops flow-disallowed block insertions at the mutation boundary", () => {
		const editor = createEditor({
			documentProfile: "flow",
			schema: flowPolicySchema,
		});
		const diagnostics: unknown[] = [];

		editor.on("diagnostic", (event) => {
			diagnostics.push(event);
		});

		editor.apply([
			{
				type: "insert-block",
				blockId: "db1",
				blockType: "widget",
				props: {},
				position: "last",
			},
		]);

		expect(editor.getBlock("db1")).toBeNull();
		expect(diagnostics).toContainEqual(
			expect.objectContaining({
				code: "PEN_PROFILE_001",
				level: "warn",
				source: "profile-policy",
				blockType: "widget",
				documentProfile: "flow",
			}),
		);

		editor.destroy();
	});

	it("re-applies the flow mutation boundary after extension hooks run", () => {
		const editor = createEditor({
			documentProfile: "flow",
			schema: flowPolicySchema,
		});
		const diagnostics: unknown[] = [];

		editor.on("diagnostic", (event) => {
			diagnostics.push(event);
		});

		editor.onBeforeApply(
			(ops) => [
				...ops,
				{
					type: "insert-block",
					blockId: "db-after-hook",
					blockType: "widget",
					props: {},
					position: "last",
				},
			],
			{ priority: 20000 },
		);

		editor.apply([
			{
				type: "insert-block",
				blockId: "p-after-hook",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
		]);

		expect(editor.getBlock("p-after-hook")?.type).toBe("paragraph");
		expect(editor.getBlock("db-after-hook")).toBeNull();
		expect(diagnostics).toContainEqual(
			expect.objectContaining({
				code: "PEN_PROFILE_001",
				blockType: "widget",
				documentProfile: "flow",
			}),
		);

		editor.destroy();
	});

	it("drops flow-disallowed block conversions at the mutation boundary", () => {
		const editor = createEditor({
			documentProfile: "flow",
			schema: flowPolicySchema,
		});
		const firstBlockId = editor.firstBlock()!.id;

		editor.apply([
			{
				type: "splice-text",
				blockId: firstBlockId,
				from: 0,
				to: 0,
				insert: "Hello",
			},
		]);

		editor.apply([
			{
				type: "set-props",
				blockId: firstBlockId,
				props: { type: "widget", ...{} },
			},
		]);

		expect(editor.getBlock(firstBlockId)?.type).toBe("paragraph");
		expect(editor.getBlock(firstBlockId)?.textContent()).toBe("Hello");

		editor.destroy();
	});

	it("still allows optional structural blocks in flow documents", () => {
		const editor = createEditor({
			documentProfile: "flow",
		});

		editor.apply([
			{
				type: "insert-block",
				blockId: "table1",
				blockType: "table",
				props: {},
				position: "last",
			},
		]);

		expect(editor.getBlock("table1")?.type).toBe("table");

		editor.destroy();
	});
});
