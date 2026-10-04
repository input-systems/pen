import { describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import type { Editor, InlineSchema } from "@input/pen-types";
import { handleCopy } from "../field-editor/clipboard";
import {
	serializeDeltasToFormat,
	sliceDeltas,
} from "../utils/clipboardSerialization";
import type { Delta } from "../utils/clipboardPayload";
import { createClipboardEvent } from "./clipboardSerialization.testHelpers";

const noDefaultExtensionsPreset = {
	resolve() {
		return { extensions: [] };
	},
};

const mentionEmbed: Delta = {
	insert: { type: "mention", props: { id: "user-1", label: "Ada" } },
};

const helloChipWorld: Delta[] = [
	{ insert: "hello " },
	mentionEmbed,
	{ insert: " world" },
];

function stubEditor(schema = defaultSchema): Editor {
	return {
		schema,
		facet: () => undefined,
	} as unknown as Editor;
}

const toolChip: InlineSchema = {
	type: "toolChip",
	kind: "node",
	propSchema: {
		name: { type: "string", default: "" },
	},
	serialize: {
		toText: (props) => `@tool:${String(props.name ?? "")}`,
	},
};

describe("IOP7 clipboard inline-atom slice", () => {
	it("IOP7: sliceDeltas keeps an embed that falls inside [from, to)", () => {
		expect(sliceDeltas(helloChipWorld, 0, 13)).toEqual(helloChipWorld);
		expect(sliceDeltas(helloChipWorld, 6, 7)).toEqual([mentionEmbed]);
		expect(sliceDeltas(helloChipWorld, 0, 6)).toEqual([
			{ insert: "hello " },
		]);
		expect(sliceDeltas(helloChipWorld, 7, 13)).toEqual([
			{ insert: " world" },
		]);
		expect(sliceDeltas(helloChipWorld, 3, 10)).toEqual([
			{ insert: "lo " },
			mentionEmbed,
			{ insert: " wo" },
		]);
	});

	it("IOP7: sliceDeltas keeps offset math when an embed sits in the range", () => {
		const sliced = sliceDeltas(helloChipWorld, 0, 8);
		expect(sliced).toEqual([
			{ insert: "hello " },
			mentionEmbed,
			{ insert: " " },
		]);
	});
});

describe("IOP8 clipboard inline-atom interchange text", () => {
	it("IOP8: serializeDeltasToFormat emits host toText on the text path", () => {
		const schema = defaultSchema.extend([toolChip]);
		const deltas: Delta[] = [
			{ insert: "hello " },
			{ insert: { type: "toolChip", props: { name: "search" } } },
			{ insert: " world" },
		];

		expect(
			serializeDeltasToFormat(deltas, stubEditor(schema), "text"),
		).toBe("hello @tool:search world");
	});

	it("IOP8: serializeDeltasToFormat emits toMarkdown / escaped toText on html", () => {
		const schema = defaultSchema.extend([toolChip]);
		const deltas: Delta[] = [
			{ insert: "hello " },
			{ insert: { type: "toolChip", props: { name: "search" } } },
			{ insert: " world" },
		];

		expect(
			serializeDeltasToFormat(deltas, stubEditor(schema), "markdown"),
		).toBe("hello @tool:search world");
		expect(
			serializeDeltasToFormat(deltas, stubEditor(schema), "html"),
		).toBe("hello @tool:search world");
	});

	it("IOP8: atoms with no serialize hook stay skipped", () => {
		const silentChip: InlineSchema = {
			type: "silentChip",
			kind: "node",
			propSchema: {},
			serialize: {},
		};
		const schema = defaultSchema.extend([silentChip]);
		const deltas: Delta[] = [
			{ insert: "hello " },
			{ insert: { type: "silentChip", props: {} } },
			{ insert: " world" },
		];

		expect(
			serializeDeltasToFormat(deltas, stubEditor(schema), "text"),
		).toBe("hello  world");
		expect(
			serializeDeltasToFormat(deltas, stubEditor(schema), "markdown"),
		).toBe("hello  world");
		expect(
			serializeDeltasToFormat(deltas, stubEditor(schema), "html"),
		).toBe("hello  world");
	});

	it("SEC5: atom toText is HTML-escaped when used as the html fallback", () => {
		const hostileChip: InlineSchema = {
			type: "hostileChip",
			kind: "node",
			propSchema: {},
			serialize: {
				toText: () => `<img src=x onerror=alert(1)>`,
			},
		};
		const schema = defaultSchema.extend([hostileChip]);
		const html = serializeDeltasToFormat(
			[{ insert: { type: "hostileChip", props: {} } }],
			stubEditor(schema),
			"html",
		);

		expect(html).toBe("&lt;img src=x onerror=alert(1)&gt;");
		expect(html).not.toContain("<img");
	});

	it("IOP8: copy writes host toText into text/plain for hello <atom> world", () => {
		const schema = defaultSchema.extend([toolChip]);
		const editor = createEditor({
			schema,
			preset: noDefaultExtensionsPreset,
		});
		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: [
					"hello ",
					{ nodeType: "toolChip", props: { name: "search" } },
					" world",
				],
			},
		]);
		editor.selectText(blockId, 0, editor.getBlock(blockId)!.length());

		const { event, get } = createClipboardEvent();
		handleCopy(editor, event);

		expect(get("text/plain")).toBe("hello @tool:search world");
		editor.destroy();
	});
});
