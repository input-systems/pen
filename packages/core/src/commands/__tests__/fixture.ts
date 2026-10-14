import type {
	Editor,
	FacetProvider,
	InlineSchema,
} from "@input/pen-types";

import { createHeadlessEditor } from "../../editor/editor";
import { defineBlock } from "../../schema/defineBlock";
import { prop } from "../../schema/prop";
import { SchemaRegistryImpl } from "../../schema/registry";
import {
	builtinCommandHandlers,
	createCommandRegistry,
	getCommandRegistry,
	type CommandRegistry,
} from "..";
import { applyCommandSelection } from "../install";

export { applyCommandSelection };

const paragraph = defineBlock("paragraph", {
	props: {
		direction: prop
			.enum(["ltr", "rtl", "auto"])
			.optional()
			.default(undefined),
	},
	content: "inline",
	fieldEditor: "richtext",
	display: { title: "Paragraph", group: "basic" },
});

const heading = defineBlock("heading", {
	props: {
		level: prop.enum([1, 2, 3, 4, 5, 6]).default(1),
	},
	content: "inline",
	fieldEditor: "richtext",
	display: { title: "Heading", group: "basic" },
});

const bulletListItem = defineBlock("bulletListItem", {
	props: {
		indent: prop.number().default(0).min(0),
		parentId: prop.string().optional(),
	},
	content: "inline",
	fieldEditor: "richtext",
	display: { title: "Bullet List", group: "lists" },
});

const numberedListItem = defineBlock("numberedListItem", {
	props: {
		indent: prop.number().default(0).min(0),
		parentId: prop.string().optional(),
	},
	content: "inline",
	fieldEditor: "richtext",
	display: { title: "Numbered List", group: "lists" },
});

const checkListItem = defineBlock("checkListItem", {
	props: {
		indent: prop.number().default(0).min(0),
		checked: prop.boolean().default(false),
		parentId: prop.string().optional(),
	},
	content: "inline",
	fieldEditor: "richtext",
	display: { title: "Check List", group: "lists" },
});

const blockquote = defineBlock("blockquote", {
	props: {
		parentId: prop.string().optional(),
	},
	content: "inline",
	fieldEditor: "richtext",
	display: { title: "Quote", group: "basic" },
});

const divider = defineBlock("divider", {
	content: "none",
	fieldEditor: "none",
	authoring: {
		flowCapability: "flow-structural",
		selectionRole: "structural",
	},
	display: { title: "Divider", group: "basic" },
});

const table = defineBlock("table", {
	props: {
		hasHeaderRow: prop.boolean().default(true),
	},
	content: "table",
	fieldEditor: "table",
	authoring: {
		flowCapability: "flow-delegated",
		selectionRole: "delegated",
	},
	display: { title: "Table", group: "advanced" },
});

const codeBlock = defineBlock("codeBlock", {
	props: {
		language: prop.string().optional(),
	},
	content: "inline",
	fieldEditor: "code",
	display: { title: "Code Block", group: "basic" },
});

const bold = {
	type: "bold",
	propSchema: {},
	kind: "mark" as const,
	expand: "after" as const,
	priority: 100,
	serialize: {},
};

const italic = {
	type: "italic",
	propSchema: {},
	kind: "mark" as const,
	expand: "after" as const,
	priority: 90,
	serialize: {},
};

const underline = {
	type: "underline",
	propSchema: {},
	kind: "mark" as const,
	expand: "after" as const,
	priority: 80,
	serialize: {},
};

const link = {
	type: "link",
	propSchema: {
		href: prop.string().default(""),
	},
	kind: "mark" as const,
	expand: "none" as const,
	priority: 70,
	serialize: {},
};

const mention = {
	type: "mention",
	propSchema: {
		id: prop.string().default(""),
		label: prop.string().default(""),
	},
	kind: "node" as const,
	serialize: {},
};

export function createCommandTestSchema() {
	return new SchemaRegistryImpl({
		blocks: [
			paragraph,
			heading,
			bulletListItem,
			numberedListItem,
			checkListItem,
			blockquote,
			divider,
			table,
			codeBlock,
		],
		inlines: [
			bold,
			italic,
			underline,
			link,
			mention,
		] as unknown as InlineSchema[],
		onUnknownBlock: () => "passthrough",
	});
}

export interface TestBlockSpec {
	readonly id: string;
	readonly type: string;
	readonly text?: string;
	readonly props?: Record<string, unknown>;
}

export function createCommandEditor(blocks: readonly TestBlockSpec[]): Editor {
	const editor = createHeadlessEditor({
		schema: createCommandTestSchema(),
	});
	const initial = editor.firstBlock();
	const ops = [];
	if (initial) {
		ops.push({ type: "delete-block" as const, blockId: initial.id });
	}
	for (const block of blocks) {
		ops.push({
			type: "insert-block" as const,
			blockId: block.id,
			blockType: block.type,
			props: block.props ?? {},
			position: "last" as const,
		});
		if (block.text && block.text.length > 0) {
			ops.push({
				type: "splice-text" as const,
				blockId: block.id,
				from: 0,
				to: 0,
				insert: block.text,
			});
		}
	}
	if (ops.length > 0) {
		editor.apply(ops, { origin: "user" });
	}
	return editor;
}

export function createCommandHarness(
	editor: Editor,
	extraProviders: readonly FacetProvider[] = [],
): CommandRegistry {
	return createCommandRegistry({
		editor,
		providers: [...extraProviders, ...builtinCommandHandlers()],
		apply: (ops, options) => {
			editor.apply(ops, options);
		},
		setSelection: (selection, origin) => {
			applyCommandSelection(editor, selection, origin);
		},
	});
}

/**
 * The registry `createEditor` / `createHeadlessEditor` installed — not a
 * parallel harness. Family-migration tests must use this so a miss cannot
 * be rescued by a second registry.
 */
export function liveRegistry(editor: Editor): CommandRegistry {
	const registry = getCommandRegistry(editor);
	if (!registry) {
		throw new Error("createEditor did not install a command registry");
	}
	return registry;
}

export function insertMention(
	editor: Editor,
	blockId: string,
	offset: number,
	props: { id?: string; label?: string } = {},
): void {
	editor.apply(
		[
			{
				type: "splice-text",
				blockId,
				from: offset,
				to: offset,
				insert: {
					nodeType: "mention",
					props: {
						id: props.id ?? "1",
						label: props.label ?? "Ada",
					},
				},
			},
		],
		{ origin: "user" },
	);
}

export function caretOf(editor: Editor): { blockId: string; offset: number } {
	const selection = editor.selection;
	if (!selection || selection.type !== "text") {
		throw new Error(
			`expected text selection, got ${selection?.type ?? "null"}`,
		);
	}
	return selection.focus;
}
