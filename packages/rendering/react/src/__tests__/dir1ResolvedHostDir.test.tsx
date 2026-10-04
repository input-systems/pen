// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import {
	blockDirectionFacet,
	createEditor as createCoreEditor,
	defaultDirectionFacet,
	defineExtension,
	resolveBlockDirection,
} from "@input/pen-core";
import { defaultPreset } from "@input/pen";
import { Pen } from "../primitives/index";
import { defaultSchema } from "@input/pen-schema";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function createEditor(options: Parameters<typeof createCoreEditor>[0] = {}) {
	return createCoreEditor({
		schema: defaultSchema,
		...options,
		preset: defaultPreset({
			tools: false,
			deltaStream: false,
			undo: false,
		}),
	});
}

async function cleanupEditor(
	editor: ReturnType<typeof createEditor>,
	root: Root,
	container: HTMLElement,
): Promise<void> {
	await act(async () => {
		root.unmount();
	});
	container.remove();
	editor.destroy();
}

async function renderEditor(editor: ReturnType<typeof createEditor>): Promise<{
	container: HTMLElement;
	root: Root;
}> {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);

	await act(async () => {
		root.render(
			<Pen.Editor.Root editor={editor}>
				<Pen.Editor.Content />
			</Pen.Editor.Root>,
		);
	});

	return { container, root };
}

function getBlockHost(container: HTMLElement, blockId: string): HTMLElement {
	const host = container.querySelector(
		`[data-pen-editor-block][data-block-id="${blockId}"]`,
	);
	if (!(host instanceof HTMLElement)) {
		throw new Error(`Missing block content host for ${blockId}`);
	}
	return host;
}

function setBlockText(
	editor: ReturnType<typeof createEditor>,
	blockId: string,
	text: string,
	direction?: "ltr" | "rtl" | "auto",
) {
	editor.apply([
		{
			type: "splice-text",
			blockId,
			from: 0,
			to: 0,
			insert: text,
		},
		...(direction
			? [
					{
						type: "set-props" as const,
						blockId,
						props: { direction },
					},
				]
			: []),
	]);
}

const DIR1_CASES: Array<{
	name: string;
	extensions: NonNullable<
		Parameters<typeof createCoreEditor>[0]
	>["extensions"];
	text: string;
	direction?: "ltr" | "rtl";
	expected: "ltr" | "rtl";
}> = [
	{
		name: "LTR text with no facet and no prop omits dir",
		extensions: [],
		text: "Hello",
		expected: "ltr",
	},
	{
		name: "pen.blockDirection resolver changes rendered dir",
		extensions: [
			defineExtension({
				name: "dir-facet",
				facets: [blockDirectionFacet.of(() => "rtl")],
			}),
		],
		text: "Hello",
		expected: "rtl",
	},
	{
		name: "explicit props.direction wins over pen.blockDirection",
		extensions: [
			defineExtension({
				name: "dir-facet",
				facets: [blockDirectionFacet.of(() => "rtl")],
			}),
		],
		text: "Hello",
		direction: "ltr",
		expected: "ltr",
	},
	{
		name: "first-strong RTL text with no prop and no resolver renders RTL",
		extensions: [],
		text: "مرحبا",
		expected: "rtl",
	},
	{
		name: "pen.defaultDirection applies when nothing else does",
		extensions: [
			defineExtension({
				name: "dir-default",
				facets: [defaultDirectionFacet.of("rtl")],
			}),
		],
		text: "12345",
		expected: "rtl",
	},
];

describe("React DIR1 resolved host dir", () => {
	it.each(DIR1_CASES)(
		"DIR1: $name",
		async ({ extensions, text, direction, expected }) => {
			const editor = createEditor({ extensions });
			const blockId = editor.firstBlock()!.id;
			setBlockText(editor, blockId, text, direction);

			const { container, root } = await renderEditor(editor);
			const block = editor.getBlock(blockId)!;

			expect(resolveBlockDirection(editor, block)).toBe(expected);
			expect(getBlockHost(container, blockId).getAttribute("dir")).toBe(
				expected === "ltr" && !direction ? null : expected,
			);
			expect(container.innerHTML).not.toContain('dir="auto"');

			await cleanupEditor(editor, root, container);
		},
	);

	it("RI1: block and inline content hosts are unicode-bidi isolate", async () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;
		setBlockText(editor, blockId, "مرحبا");

		const { container, root } = await renderEditor(editor);
		const host = getBlockHost(container, blockId);
		const inline = host.querySelector("[data-pen-inline-content]");

		expect(host.style.unicodeBidi).toBe("isolate");
		if (!(inline instanceof HTMLElement)) {
			throw new Error(`Missing inline content host for ${blockId}`);
		}
		expect(inline.style.unicodeBidi).toBe("isolate");

		await cleanupEditor(editor, root, container);
	});

	it("DIR1: host dir tracks cache invalidation when block text changes", async () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;
		setBlockText(editor, blockId, "مرحبا");

		const { container, root } = await renderEditor(editor);
		expect(getBlockHost(container, blockId).getAttribute("dir")).toBe(
			"rtl",
		);

		await act(async () => {
			editor.apply([
				{
					type: "splice-text",
					blockId,
					from: 0,
					to: 0 + editor.getBlock(blockId)!.length(),
					insert: "Hello",
				},
			]);
		});

		expect(resolveBlockDirection(editor, editor.getBlock(blockId)!)).toBe(
			"ltr",
		);
		expect(getBlockHost(container, blockId).hasAttribute("dir")).toBe(
			false,
		);

		await cleanupEditor(editor, root, container);
	});
});
