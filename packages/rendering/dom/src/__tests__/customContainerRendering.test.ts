// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
	createEditor,
	defineBlock,
	mergeSchemas,
	prop,
	SchemaRegistryImpl,
} from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import type { DocumentOp, Editor } from "@input/pen-types";
import { mountEditor } from "../host/mountEditor";
import { DATA_ATTRS } from "../utils/dataAttributes";

const noDefaultExtensionsPreset = {
	resolve() {
		return { extensions: [] };
	},
};

/**
 * A host-defined container, deliberately not `toggle`, `callout`, or
 * `blockquote`: container behavior has to follow from `isContainer` in the
 * schema, not from a type list inside the renderer.
 */
const emailQuote = defineBlock("emailQuote", {
	content: "inline",
	isContainer: true,
	props: {
		open: prop.boolean().default(true),
		parentId: prop.string().optional(),
	},
});

const schema = mergeSchemas(
	defaultSchema,
	new SchemaRegistryImpl({
		blocks: [emailQuote],
		inlines: [],
	}),
);

function createQuoteEditor(): Editor {
	return createEditor({ schema, preset: noDefaultExtensionsPreset });
}

function blockElement(root: HTMLElement, blockId: string): HTMLElement | null {
	return root.querySelector<HTMLElement>(
		`[${DATA_ATTRS.editorBlock}][${DATA_ATTRS.blockId}="${blockId}"]`,
	);
}

type InsertBlockOp = Extract<DocumentOp, { type: "insert-block" }>;

/** The two ways a child joins a container: its children array, or a parentId prop. */
const CHILD_PLACEMENTS: Array<{
	name: string;
	text: string;
	place(parentId: string): Pick<InsertBlockOp, "props" | "position">;
}> = [
	{
		name: "the container's children array",
		text: "quoted line",
		place: (parentId) => ({
			props: {},
			position: { parent: parentId, index: 0 },
		}),
	},
	{
		name: "the parentId prop",
		text: "sibling child",
		place: (parentId) => ({
			props: { parentId },
			position: { after: parentId },
		}),
	},
];

describe("host-defined container rendering", () => {
	const cleanups: Array<() => void> = [];

	afterEach(() => {
		for (const cleanup of cleanups.splice(0)) {
			cleanup();
		}
		document.body.replaceChildren();
	});

	function mount(editor: Editor): HTMLElement {
		const root = document.createElement("div");
		document.body.append(root);
		const mounted = mountEditor(editor, root);
		cleanups.push(() => {
			mounted.destroy();
			editor.destroy();
		});
		return root;
	}

	it.each(CHILD_PLACEMENTS)(
		"nests children written through $name",
		({ text, place }) => {
			const editor = createQuoteEditor();

			editor.apply(
				[
					{
						type: "insert-block",
						blockId: "quote-1",
						blockType: "emailQuote",
						props: {},
						position: "last",
					},
					{
						type: "insert-block",
						blockId: "child",
						blockType: "paragraph",
						...place("quote-1"),
					},
					{
						type: "splice-text",
						blockId: "child",
						from: 0,
						to: 0,
						insert: text,
					},
				],
				{ origin: "user" },
			);

			const root = mount(editor);
			const quote = blockElement(root, "quote-1");

			expect(quote).not.toBeNull();
			expect(blockElement(quote as HTMLElement, "child")).not.toBeNull();
			expect(quote?.textContent).toContain(text);
		},
	);

	it("collapses children when the container is closed", () => {
		const editor = createQuoteEditor();

		editor.apply(
			[
				{
					type: "insert-block",
					blockId: "quote-1",
					blockType: "emailQuote",
					props: { open: false },
					position: "last",
				},
				{
					type: "insert-block",
					blockId: "hidden-child",
					blockType: "paragraph",
					props: { parentId: "quote-1" },
					position: { after: "quote-1" },
				},
				{
					type: "splice-text",
					blockId: "hidden-child",
					from: 0,
					to: 0,
					insert: "hidden line",
				},
			],
			{ origin: "user" },
		);

		const root = mount(editor);

		expect(blockElement(root, "hidden-child")).toBeNull();
		expect(root.textContent).not.toContain("hidden line");
	});

	// a parentId naming a non-container renders nowhere: getRootBlockIds drops
	// any block with a parent, and a non-container has no children host to
	// receive it. Pre-existing, and unchanged here.
	it("gives a non-container block no children host, so parentId does not nest", () => {
		const editor = createQuoteEditor();

		editor.apply(
			[
				{
					type: "insert-block",
					blockId: "paragraph-1",
					blockType: "paragraph",
					props: {},
					position: "last",
				},
				{
					type: "insert-block",
					blockId: "not-a-child",
					blockType: "paragraph",
					props: { parentId: "paragraph-1" },
					position: { after: "paragraph-1" },
				},
			],
			{ origin: "user" },
		);

		const root = mount(editor);
		const paragraph = blockElement(root, "paragraph-1");

		expect(paragraph).not.toBeNull();
		// a container gets a second child element for its children host; a
		// non-container gets only its body
		expect(paragraph?.children.length).toBe(1);
		expect(
			blockElement(paragraph as HTMLElement, "not-a-child"),
		).toBeNull();
	});
});
