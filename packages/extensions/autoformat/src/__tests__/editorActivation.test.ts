import {
	createEditor as createCoreEditor,
	defineBlock,
	prop,
	SchemaRegistryImpl,
} from "@input/pen-core";
import type {
	ComposableSchema,
	InlineSchema,
} from "@input/pen-types";
import { describe, expect, it } from "vitest";

import { autoformatExtension } from "../extension";
import type { AutoformatConfig } from "../types";

const noDefaultExtensionsPreset = {
	resolve() {
		return { extensions: [] };
	},
};

const paragraph = defineBlock("paragraph", {
	content: "inline",
	fieldEditor: "richtext",
});

const heading = defineBlock("heading", {
	props: {
		level: prop.enum([1, 2, 3, 4, 5, 6]).default(1),
	},
	content: "inline",
	fieldEditor: "richtext",
});

const bold: InlineSchema = {
	type: "bold",
	propSchema: {},
	kind: "mark",
	expand: "after",
	priority: 100,
	serialize: {},
};

function createTestSchema(): ComposableSchema {
	return new SchemaRegistryImpl({
		blocks: [paragraph, heading],
		inlines: [bold],
	});
}

function createEditor(config?: AutoformatConfig) {
	return createCoreEditor({
		schema: createTestSchema(),
		extensions: [autoformatExtension(config)],
		preset: noDefaultExtensionsPreset,
	});
}

async function flushMicrotasks(count = 2): Promise<void> {
	for (let index = 0; index < count; index++) {
		await Promise.resolve();
	}
}

function visibleText(text: string): string {
	return text.replace(/\u200B/g, "");
}

describe("autoformatExtension editor activation", () => {
	it("activates autoformat extensions and applies block conversions", async () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;

		editor.selectTextRange({ blockId, offset: 0 }, { blockId, offset: 0 });

		editor.apply(
			[
				{
					type: "splice-text",
					blockId,
					from: 0,
					to: 0,
					insert: "#",
				},
			],
			{ origin: "user" },
		);
		editor.selectTextRange({ blockId, offset: 1 }, { blockId, offset: 1 });
		editor.apply(
			[
				{
					type: "splice-text",
					blockId,
					from: 1,
					to: 1,
					insert: " ",
				},
			],
			{ origin: "user" },
		);
		await flushMicrotasks();

		expect(editor.getBlock(blockId)?.type).toBe("heading");
		expect(editor.getBlock(blockId)?.props.level).toBe(1);
		expect(visibleText(editor.getBlock(blockId)!.textContent())).toBe("");

		editor.destroy();
	});

	it("keeps a list marker as text when the schema has no list block", async () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;
		await editor.whenReady();

		editor.apply(
			[
				{
					type: "splice-text",
					blockId,
					from: 0,
					to: 0,
					insert: "1.",
				},
			],
			{ origin: "user" },
		);
		editor.selectTextRange({ blockId, offset: 2 }, { blockId, offset: 2 });
		editor.apply(
			[
				{
					type: "splice-text",
					blockId,
					from: 2,
					to: 2,
					insert: " ",
				},
			],
			{ origin: "user" },
		);
		await flushMicrotasks();

		expect(editor.getBlock(blockId)?.type).toBe("paragraph");
		expect(visibleText(editor.getBlock(blockId)!.textContent())).toBe(
			"1. ",
		);

		editor.destroy();
	});

	it("activates autoformat extensions and applies inline markdown conversions", async () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;

		editor.apply(
			[
				{
					type: "splice-text",
					blockId,
					from: 0,
					to: 0,
					insert: "**hello*",
				},
			],
			{ origin: "user" },
		);
		editor.apply(
			[
				{
					type: "splice-text",
					blockId,
					from: 8,
					to: 8,
					insert: "*",
				},
			],
			{ origin: "user" },
		);
		await flushMicrotasks();

		expect(visibleText(editor.getBlock(blockId)!.textContent())).toBe(
			"hello",
		);
		expect(editor.getBlock(blockId)?.textDeltas()).toEqual([
			{
				insert: "hello",
				attributes: { bold: true },
			},
		]);

		editor.destroy();
	});

	it("a rule whose replacement rematches its trigger fires once per apply", async () => {
		let fires = 0;
		const editor = createEditor({
			disableDefaults: true,
			disableDefaultInlineRules: true,
			rules: [
				{
					id: "echo-space",
					match: /^!\s$/,
					blockTypes: ["paragraph"],
					handler: (_match, ctx) => {
						fires += 1;
						if (fires > 8) {
							throw new Error(
								"input rule rematched its own output",
							);
						}
						return [
							{
								type: "splice-text",
								blockId: ctx.blockId,
								from: ctx.fullText.length + 1,
								to: ctx.fullText.length + 1,
								insert: " ",
							},
						];
					},
				},
			],
		});
		const blockId = editor.firstBlock()!.id;
		await editor.whenReady();

		editor.apply(
			[
				{
					type: "splice-text",
					blockId,
					from: 0,
					to: 0,
					insert: "!",
				},
			],
			{ origin: "user" },
		);
		editor.selectTextRange({ blockId, offset: 1 }, { blockId, offset: 1 });
		editor.apply(
			[
				{
					type: "splice-text",
					blockId,
					from: 1,
					to: 1,
					insert: " ",
				},
			],
			{ origin: "user" },
		);
		await flushMicrotasks();

		expect(fires).toBe(1);
		expect(visibleText(editor.getBlock(blockId)!.textContent())).toBe(
			"!  ",
		);

		editor.destroy();
	});

	it("does not convert when the apply origin is input-rule", async () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;
		await editor.whenReady();

		editor.selectTextRange({ blockId, offset: 0 }, { blockId, offset: 0 });
		editor.apply(
			[
				{
					type: "splice-text",
					blockId,
					from: 0,
					to: 0,
					insert: "#",
				},
			],
			{ origin: "input-rule" },
		);
		editor.selectTextRange({ blockId, offset: 1 }, { blockId, offset: 1 });
		editor.apply(
			[
				{
					type: "splice-text",
					blockId,
					from: 1,
					to: 1,
					insert: " ",
				},
			],
			{ origin: "input-rule" },
		);
		await flushMicrotasks();

		expect(editor.getBlock(blockId)?.type).toBe("paragraph");
		expect(visibleText(editor.getBlock(blockId)!.textContent())).toBe("# ");

		editor.destroy();
	});
});
