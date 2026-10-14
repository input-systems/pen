import { describe, it, expect } from "vitest";
import { InputRuleEngine } from "../engine";
import { defaultBlockRules } from "../defaultRules";
import type { Editor, InputRule } from "@input/pen-types";

// Every block type the rules under test convert to.
const registeredBlocks = [
	"paragraph",
	"heading",
	"bulletListItem",
	"numberedListItem",
	"checkListItem",
	"blockquote",
	"codeBlock",
	"divider",
	"callout",
].map((type) => ({ type }));

type InputRuleTestEditor = {
	getBlock(): {
		type: string;
		textContent(): string;
	};
	selection: {
		type: "text";
		anchor: { blockId: string; offset: number };
		focus: { blockId: string; offset: number };
	} | null;
	schema: {
		resolve(): {
			content: "inline";
			fieldEditor: "richtext" | "code";
		};
		resolveInline(): { kind: "mark" } | null;
		allBlocks(): readonly { type: string }[];
	};
};

function mockEditor(opts: {
	blockType: string;
	textContent: string;
	cursorOffset?: number;
}) {
	const offset = opts.cursorOffset ?? opts.textContent.length;
	const editor = {
		getBlock: () => ({
			type: opts.blockType,
			textContent: () => opts.textContent,
		}),
		selection: {
			type: "text" as const,
			anchor: { blockId: "b1", offset },
			focus: { blockId: "b1", offset },
		},
		schema: {
			resolve: () => ({
				content: "inline",
				fieldEditor: "richtext",
			}),
			resolveInline: () => ({ kind: "mark" }),
			allBlocks: () => registeredBlocks,
		},
	} satisfies InputRuleTestEditor;

	return editor as unknown as Editor;
}

function mockEditorWithSelection(opts: {
	blockType: string;
	textContent: string;
	anchorOffset: number;
	focusOffset: number;
}) {
	const editor = {
		getBlock: () => ({
			type: opts.blockType,
			textContent: () => opts.textContent,
		}),
		selection: {
			type: "text" as const,
			anchor: { blockId: "b1", offset: opts.anchorOffset },
			focus: { blockId: "b1", offset: opts.focusOffset },
		},
		schema: {
			resolve: () => ({
				content: "inline",
				fieldEditor: "richtext",
			}),
			resolveInline: () => ({ kind: "mark" }),
			allBlocks: () => registeredBlocks,
		},
	} satisfies InputRuleTestEditor;

	return editor as unknown as Editor;
}

function engineWithDefaults() {
	const engine = new InputRuleEngine();
	for (const rule of defaultBlockRules) engine.register(rule);
	return engine;
}

describe("InputRuleEngine", () => {
	describe("register / unregister", () => {
		it("registers and deduplicates by id", () => {
			const engine = new InputRuleEngine();
			const rule: InputRule = {
				id: "test",
				match: /^# $/,
				handler: () => null,
			};
			engine.register(rule);
			engine.register(rule);

			const editor = mockEditor({
				blockType: "paragraph",
				textContent: "",
			});
			const result = engine.tryMatch(editor, "b1", " ");
			expect(result).toBeNull();
		});

		it("unregister removes rule", () => {
			const engine = new InputRuleEngine();
			engine.register({
				id: "test",
				match: /^# $/,
				handler: (_m, ctx) => [
					{
						type: "set-props",
						blockId: ctx.blockId,
						props: { type: "heading", ...{ level: 1 } },
					},
				],
			});

			engine.unregister("test");

			const editor = mockEditor({
				blockType: "paragraph",
				textContent: "#",
			});
			const result = engine.tryMatch(editor, "b1", " ");
			expect(result).toBeNull();
		});
	});

	describe("tryMatch — block rules", () => {
		it("returns null for non-trigger characters", () => {
			const engine = engineWithDefaults();
			const editor = mockEditor({
				blockType: "paragraph",
				textContent: "#",
			});
			const result = engine.tryMatch(editor, "b1", "a");
			expect(result).toBeNull();
		});

		it("matches heading-1 on '# '", () => {
			const engine = engineWithDefaults();
			const editor = mockEditor({
				blockType: "paragraph",
				textContent: "#",
			});
			const result = engine.tryMatch(editor, "b1", " ");

			expect(result).not.toBeNull();
			expect(result).toHaveLength(2);
			expect(result![0]).toMatchObject({
				type: "splice-text",
				blockId: "b1",
				from: 0,
				to: 0 + 2,
				insert: "",
			});
			expect(result![1]).toMatchObject({
				type: "set-props",
				blockId: "b1",
				props: { type: "heading", ...{ level: 1 } },
			});
		});

		it("matches heading-3 on '### '", () => {
			const engine = engineWithDefaults();
			const editor = mockEditor({
				blockType: "paragraph",
				textContent: "###",
			});
			const result = engine.tryMatch(editor, "b1", " ");

			expect(result).not.toBeNull();
			expect(result![1]).toMatchObject({
				type: "set-props",
				props: { type: "heading", level: 3 },
			});
		});

		it("matches bullet list on '- '", () => {
			const engine = engineWithDefaults();
			const editor = mockEditor({
				blockType: "paragraph",
				textContent: "-",
			});
			const result = engine.tryMatch(editor, "b1", " ");

			expect(result).not.toBeNull();
			expect(result![1]).toMatchObject({
				type: "set-props",
				props: { type: "bulletListItem" },
			});
		});

		it("matches bullet list on '* '", () => {
			const engine = engineWithDefaults();
			const editor = mockEditor({
				blockType: "paragraph",
				textContent: "*",
			});
			const result = engine.tryMatch(editor, "b1", " ");

			expect(result).not.toBeNull();
			expect(result![1]).toMatchObject({
				type: "set-props",
				props: { type: "bulletListItem" },
			});
		});

		it("matches ordered list on '1. '", () => {
			const engine = engineWithDefaults();
			const editor = mockEditor({
				blockType: "paragraph",
				textContent: "1.",
			});
			const result = engine.tryMatch(editor, "b1", " ");

			expect(result).not.toBeNull();
			expect(result![1]).toMatchObject({
				type: "set-props",
				props: { type: "numberedListItem" },
			});
		});

		it("matches ordered list with start > 1", () => {
			const engine = engineWithDefaults();
			const editor = mockEditor({
				blockType: "paragraph",
				textContent: "5.",
			});
			const result = engine.tryMatch(editor, "b1", " ");

			expect(result).not.toBeNull();
			expect(result![1]).toMatchObject({
				type: "set-props",
				props: { type: "numberedListItem", start: 5 },
			});
		});

		it("matches unchecked todo on '[ ] '", () => {
			const engine = engineWithDefaults();
			const editor = mockEditor({
				blockType: "paragraph",
				textContent: "[ ]",
			});
			const result = engine.tryMatch(editor, "b1", " ");

			expect(result).not.toBeNull();
			expect(result![1]).toMatchObject({
				type: "set-props",
				props: { type: "checkListItem", checked: false },
			});
		});

		it("matches checked todo on '[x] '", () => {
			const engine = engineWithDefaults();
			const editor = mockEditor({
				blockType: "paragraph",
				textContent: "[x]",
			});
			const result = engine.tryMatch(editor, "b1", " ");

			expect(result).not.toBeNull();
			expect(result![1]).toMatchObject({
				type: "set-props",
				props: { type: "checkListItem", checked: true },
			});
		});

		it("matches blockquote on '> '", () => {
			const engine = engineWithDefaults();
			const editor = mockEditor({
				blockType: "paragraph",
				textContent: ">",
			});
			const result = engine.tryMatch(editor, "b1", " ");

			expect(result).not.toBeNull();
			expect(result![1]).toMatchObject({
				type: "set-props",
				props: { type: "blockquote" },
			});
		});

		it("matches code block on '``` '", () => {
			const engine = engineWithDefaults();
			const editor = mockEditor({
				blockType: "paragraph",
				textContent: "```",
			});
			const result = engine.tryMatch(editor, "b1", " ");

			expect(result).not.toBeNull();
			expect(result![1]).toMatchObject({
				type: "set-props",
				props: { type: "codeBlock" },
			});
		});

		it("matches divider on '--- '", () => {
			const engine = engineWithDefaults();
			const editor = mockEditor({
				blockType: "paragraph",
				textContent: "---",
			});
			const result = engine.tryMatch(editor, "b1", " ");

			expect(result).not.toBeNull();
			expect(result![1]).toMatchObject({
				type: "set-props",
				props: { type: "divider" },
			});
		});

		it("matches divider on '*** '", () => {
			const engine = engineWithDefaults();
			const editor = mockEditor({
				blockType: "paragraph",
				textContent: "***",
			});
			const result = engine.tryMatch(editor, "b1", " ");

			expect(result).not.toBeNull();
			expect(result![1]).toMatchObject({
				type: "set-props",
				props: { type: "divider" },
			});
		});

		it("matches callout on '> [!note] '", () => {
			const engine = engineWithDefaults();
			const editor = mockEditor({
				blockType: "paragraph",
				textContent: "> [!note]",
			});
			const result = engine.tryMatch(editor, "b1", " ");

			expect(result).not.toBeNull();
			expect(result![1]).toMatchObject({
				type: "set-props",
				blockId: "b1",
				props: { type: "callout", severity: "info" },
			});
		});

		it("matches callout on '> [!WARNING] ' (case insensitive)", () => {
			const engine = engineWithDefaults();
			const editor = mockEditor({
				blockType: "paragraph",
				textContent: "> [!WARNING]",
			});
			const result = engine.tryMatch(editor, "b1", " ");

			expect(result).not.toBeNull();
			expect(result![1]).toMatchObject({
				type: "set-props",
				blockId: "b1",
				props: { type: "callout", severity: "warning" },
			});
		});

		it("skips non-paragraph blocks", () => {
			const engine = engineWithDefaults();
			const editor = mockEditor({
				blockType: "heading",
				textContent: "#",
			});
			const result = engine.tryMatch(editor, "b1", " ");
			expect(result).toBeNull();
		});

		it("does not match partial patterns", () => {
			const engine = engineWithDefaults();
			const editor = mockEditor({
				blockType: "paragraph",
				textContent: "hello #",
			});
			const result = engine.tryMatch(editor, "b1", " ");
			expect(result).toBeNull();
		});

		it("skips when selection is not collapsed", () => {
			const engine = engineWithDefaults();
			const editor = mockEditorWithSelection({
				blockType: "paragraph",
				textContent: "#",
				anchorOffset: 0,
				focusOffset: 1,
			});
			const result = engine.tryMatch(editor, "b1", " ");
			expect(result).toBeNull();
		});

		it("skips when no selection", () => {
			const engine = engineWithDefaults();
			const editor = {
				...mockEditor({ blockType: "paragraph", textContent: "#" }),
				selection: null,
			};
			const result = engine.tryMatch(
				editor as unknown as Editor,
				"b1",
				" ",
			);
			expect(result).toBeNull();
		});
	});

	describe("self-trigger and overlapping rules", () => {
		const conversions: Array<{ text: string; newType: string }> = [
			{ text: "#", newType: "heading" },
			{ text: "-", newType: "bulletListItem" },
			{ text: "*", newType: "bulletListItem" },
			{ text: "+", newType: "bulletListItem" },
			{ text: "1.", newType: "numberedListItem" },
			{ text: "[ ]", newType: "checkListItem" },
			{ text: "[x]", newType: "checkListItem" },
			{ text: ">", newType: "blockquote" },
			{ text: "```", newType: "codeBlock" },
			{ text: "---", newType: "divider" },
			{ text: "***", newType: "divider" },
			{ text: "___", newType: "divider" },
			{ text: "> [!note]", newType: "callout" },
		];

		it("does not rematch after converting a paragraph into the rule's result type", () => {
			const engine = engineWithDefaults();

			for (const { text, newType } of conversions) {
				const before = mockEditor({
					blockType: "paragraph",
					textContent: text,
				});
				const ops = engine.tryMatch(before, "b1", " ");
				expect(ops, text).not.toBeNull();
				expect(ops).toEqual(
					expect.arrayContaining([
						expect.objectContaining({
							type: "set-props",
							props: expect.objectContaining({ type: newType }),
						}),
					]),
				);

				const leftoverTrigger = mockEditor({
					blockType: newType,
					textContent: text,
				});
				expect(engine.tryMatch(leftoverTrigger, "b1", " ")).toBeNull();

				const emptied = mockEditor({
					blockType: newType,
					textContent: "",
				});
				expect(engine.tryMatch(emptied, "b1", " ")).toBeNull();
			}
		});

		it("matches at most one default block rule for each trigger", () => {
			const triggers = [
				"# ",
				"## ",
				"### ",
				"- ",
				"* ",
				"+ ",
				"1. ",
				"[ ] ",
				"[x] ",
				"> ",
				"``` ",
				"--- ",
				"*** ",
				"___ ",
				"> [!note] ",
			];

			for (const trigger of triggers) {
				const matches = defaultBlockRules.filter((rule) =>
					rule.match.test(trigger),
				);
				expect(matches, trigger).toHaveLength(1);
			}
		});

		it("when two rules match the same input, the first registered wins", () => {
			const engine = new InputRuleEngine();
			engine.register({
				id: "first",
				match: /^-\s$/,
				blockTypes: ["paragraph"],
				handler: (_match, ctx) => [
					{
						type: "set-props",
						blockId: ctx.blockId,
						props: { type: "bulletListItem", ...{} },
					},
				],
			});
			engine.register({
				id: "second",
				match: /^-\s$/,
				blockTypes: ["paragraph"],
				handler: (_match, ctx) => [
					{
						type: "set-props",
						blockId: ctx.blockId,
						props: { type: "heading", ...{ level: 1 } },
					},
				],
			});

			const result = engine.tryMatch(
				mockEditor({ blockType: "paragraph", textContent: "-" }),
				"b1",
				" ",
			);

			expect(result).toEqual([
				{
					type: "set-props",
					blockId: "b1",
					props: { type: "bulletListItem", ...{} },
				},
			]);
		});
	});

	describe("tryMatchInline", () => {
		it("skips inline rules for code field editors", () => {
			const engine = new InputRuleEngine();
			engine.registerInline({
				id: "bold",
				trigger: "*",
				pattern: /\*\*(.+)\*\*$/,
				markType: "bold",
			});

			const editor = {
				getBlock: () => ({
					type: "codeBlock",
					textContent: () => "**bold*",
				}),
				selection: {
					type: "text" as const,
					anchor: { blockId: "b1", offset: 7 },
					focus: { blockId: "b1", offset: 7 },
				},
				schema: {
					resolve: () => ({
						content: "inline",
						fieldEditor: "code",
					}),
					resolveInline: () => ({ kind: "mark" }),
					allBlocks: () => registeredBlocks,
				},
			} satisfies InputRuleTestEditor;

			expect(
				engine.tryMatchInline(editor as unknown as Editor, "b1", "*"),
			).toBeNull();
		});
	});
});
