// @vitest-environment jsdom

import {
	defineBlock,
	mergeSchemas,
	prop,
	SchemaRegistryImpl,
	shouldRenderContainerChildren,
} from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import type { DocumentOp, Editor } from "@input/pen-types";
import { createTestEditor } from "@input/pen-test";
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { h } from "vue";
import { PenEditor } from "../components/PenEditor";
import type { PenBlockRenderer } from "../types";

afterEach(() => {
	document.body.replaceChildren();
});

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

function createQuoteEditor() {
	return createTestEditor({
		schema,
		blocks: [{ id: "quote-1", type: "emailQuote", props: {} }],
	});
}

/**
 * The Vue children outlet is `ctx.childNodes`, which `PenBlock` passes to every
 * renderer. Collapsing stays the renderer's decision, through the same shared
 * predicate the DOM navigation uses.
 */
function quoteRenderer(editor: Editor): PenBlockRenderer {
	return (block, ctx) =>
		h("div", { "data-quote": block.id }, [
			shouldRenderContainerChildren(editor, editor.getBlock(block.id))
				? h("div", { "data-quote-children": "" }, ctx.childNodes)
				: null,
		]);
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
	it.each(CHILD_PLACEMENTS)(
		"passes children written through $name into a host renderer",
		({ text, place }) => {
			const editor = createQuoteEditor();

			editor.apply(
				[
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

			const wrapper = mount(PenEditor, {
				attachTo: document.body,
				props: {
					editor,
					renderers: { emailQuote: quoteRenderer(editor) },
				},
			});

			const children = wrapper.find("[data-quote-children]");
			expect(children.exists()).toBe(true);
			expect(children.text()).toContain(text);

			wrapper.unmount();
			editor.destroy();
		},
	);
});
