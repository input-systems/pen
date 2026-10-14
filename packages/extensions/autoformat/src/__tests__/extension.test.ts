import { describe, expect, it, vi } from "vitest";
import { autoformatExtension } from "../extension";
import type { DocumentOp, Editor } from "@input/pen-types";

type BeforeApplyHook = (
	ops: DocumentOp[],
	options: { origin?: string },
) => DocumentOp[];

type AutoformatExtensionTestEditor = {
	apply: ReturnType<typeof vi.fn>;
	getBlock(): {
		type: string;
		textContent(): string;
	};
	onBeforeApply: ReturnType<typeof vi.fn>;
	internals: {
		assignSlot: ReturnType<typeof vi.fn>;
	};
	selection: {
		type: "text";
		anchor: { blockId: string; offset: number };
		focus: { blockId: string; offset: number };
	};
	schema: {
		resolve(): {
			content: "inline";
			fieldEditor: "richtext";
		};
		resolveInline(): { kind: "mark" };
		allBlocks(): readonly { type: string }[];
	};
};

function createMockEditor(textContent: string) {
	let beforeApplyHook: BeforeApplyHook | null = null;
	const apply = vi.fn();

	const editor = {
		apply,
		getBlock: () => ({
			type: "paragraph",
			textContent: () => textContent,
		}),
		onBeforeApply: vi.fn((hook: BeforeApplyHook) => {
			beforeApplyHook = hook;
			return () => {
				beforeApplyHook = null;
			};
		}),
		internals: {
			assignSlot: vi.fn(),
		},
		selection: {
			type: "text" as const,
			anchor: { blockId: "b1", offset: textContent.length },
			focus: { blockId: "b1", offset: textContent.length },
		},
		schema: {
			resolve: () => ({
				content: "inline",
				fieldEditor: "richtext",
			}),
			resolveInline: () => ({ kind: "mark" }),
			allBlocks: () => [{ type: "paragraph" }, { type: "heading" }],
		},
	} satisfies AutoformatExtensionTestEditor;

	return {
		editor: editor as unknown as Editor,
		apply,
		getHook: () => beforeApplyHook,
	};
}

describe("autoformatExtension", () => {
	it("appends block rule transforms into the same apply pass", async () => {
		const { editor, apply, getHook } = createMockEditor("#");
		const extension = autoformatExtension();

		await extension.activateClient?.({
			editor,
			dom: {} as Document,
			emit: () => undefined,
			getState: () => undefined,
		});

		const hook = getHook();
		expect(hook).toBeTypeOf("function");

		const ops = hook!(
			[
				{
					type: "splice-text",
					blockId: "b1",
					from: 1,
					to: 1,
					insert: " ",
				},
			],
			{ origin: "user" },
		);

		expect(ops).toEqual([
			{ type: "splice-text", blockId: "b1", from: 1, to: 1, insert: " " },
			{
				type: "splice-text",
				blockId: "b1",
				from: 0,
				to: 0 + 2,
				insert: "",
			},
			{
				type: "set-props",
				blockId: "b1",
				props: { type: "heading", ...{ level: 1 } },
			},
		]);
		expect(apply).not.toHaveBeenCalled();
	});

	it("does not re-apply a rule against the insert-text it just appended", async () => {
		let fires = 0;
		const { editor, getHook } = createMockEditor("!");
		const extension = autoformatExtension({
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

		await extension.activateClient?.({
			editor,
			dom: {} as Document,
			emit: () => undefined,
			getState: () => undefined,
		});

		const ops = getHook()!(
			[
				{
					type: "splice-text",
					blockId: "b1",
					from: 1,
					to: 1,
					insert: " ",
				},
			],
			{ origin: "user" },
		);

		expect(fires).toBe(1);
		expect(ops).toEqual([
			{ type: "splice-text", blockId: "b1", from: 1, to: 1, insert: " " },
			{ type: "splice-text", blockId: "b1", from: 2, to: 2, insert: " " },
		]);
	});

	it("skips transforms for bypass origins", async () => {
		const { editor, getHook } = createMockEditor("#");
		const extension = autoformatExtension();

		await extension.activateClient?.({
			editor,
			dom: {} as Document,
			emit: () => undefined,
			getState: () => undefined,
		});

		const originalOps: DocumentOp[] = [
			{ type: "splice-text", blockId: "b1", from: 1, to: 1, insert: " " },
		];
		const ops = getHook()!(originalOps, { origin: "input-rule" });

		expect(ops).toBe(originalOps);
	});
});
