// @vitest-environment jsdom

import React, { act, createContext, useContext, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
	getInlineAtomElementData,
	getLogicalTextContent,
	getLogicalNodeLength,
	INLINE_ATOM_REPLACEMENT_TEXT,
	findLogicalDOMPoint,
	isInlineAtomCaretBoundaryNode,
	isInlineAtomHostNode,
} from "@input/pen-dom/field-editor/inlineAtomDom";
import {
	fullReconcileDeltasToDOM,
} from "@input/pen-dom/field-editor/reconciler";
import { DATA_ATTRS } from "@input/pen-dom/utils/dataAttributes";
import {
	domPointToOffset,
	getSelectionOffsets,
} from "@input/pen-dom/field-editor/selectionBridge";
import { handleFieldEditorKeyDown } from "@input/pen-dom/field-editor/keyHandling";
import { Pen } from "../primitives/index";
import {
	createPresetEditor,
	flushAnimationFrames,
	seedInlineAtomDocument,
} from "./utils/inlineAtomTestHelpers";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("Pen inline atom editing: caret boundaries and rendering", () => {
	it("selects an inline atom with ArrowLeft and then collapses before it", () => {
		const editor = createPresetEditor();
		const blockId = seedInlineAtomDocument(editor);
		const activations: Array<{
			blockId: string;
			anchorOffset: number;
			focusOffset: number;
		}> = [];
		const fieldEditor = {
			focusBlockId: blockId,
			inputMode: "richtext" as const,
			activeCellCoord: null,
			activateCell: vi.fn(),
			activateTextSelection: (
				nextBlockId: string,
				anchorOffset: number,
				focusOffset: number,
			) => {
				activations.push({
					blockId: nextBlockId,
					anchorOffset,
					focusOffset,
				});
			},
			deactivate: vi.fn(),
			selectAllBehavior: "block-first" as const,
		};
		const ytext = {
			length: 3,
			toString: () => `A${INLINE_ATOM_REPLACEMENT_TEXT}B`,
			toDelta: () => [
				{ insert: "A" },
				{
					insert: {
						type: "mention",
						props: { id: "user-1", label: "Ada" },
					},
				},
				{ insert: "B" },
			],
			insert: vi.fn(),
			delete: vi.fn(),
		};

		try {
			expect(
				handleFieldEditorKeyDown({
					editor,
					fieldEditor,
					ytext,
					range: { start: 2, end: 2 },
					event: new KeyboardEvent("keydown", {
						key: "ArrowLeft",
						bubbles: true,
						cancelable: true,
					}),
				}),
			).toBe(true);

			expect(activations.at(-1)).toEqual({
				blockId,
				anchorOffset: 1,
				focusOffset: 2,
			});

			expect(
				handleFieldEditorKeyDown({
					editor,
					fieldEditor,
					ytext,
					range: { start: 1, end: 2 },
					event: new KeyboardEvent("keydown", {
						key: "ArrowLeft",
						bubbles: true,
						cancelable: true,
					}),
				}),
			).toBe(true);

			expect(activations.at(-1)).toEqual({
				blockId,
				anchorOffset: 1,
				focusOffset: 1,
			});

			expect(
				handleFieldEditorKeyDown({
					editor,
					fieldEditor,
					ytext,
					range: { start: 2, end: 2 },
					event: new KeyboardEvent("keydown", {
						key: "ArrowLeft",
						shiftKey: true,
						bubbles: true,
						cancelable: true,
					}),
				}),
			).toBe(true);

			expect(activations.at(-1)).toEqual({
				blockId,
				anchorOffset: 2,
				focusOffset: 1,
			});
		} finally {
			editor.destroy();
		}
	});

	it("projects caret selections onto inline atom caret boundaries", () => {
		const editor = createPresetEditor();
		const blockId = seedInlineAtomDocument(editor);
		const block = editor.getBlock(blockId)!;
		const inlineElement = document.createElement("span");
		inlineElement.setAttribute(DATA_ATTRS.inlineContent, "");
		fullReconcileDeltasToDOM(
			block.inlineDeltas() as unknown as Parameters<
				typeof fullReconcileDeltasToDOM
			>[0],
			inlineElement,
			editor.schema,
			{ editor },
		);
		document.body.appendChild(inlineElement);

		try {
			const host = inlineElement.querySelector(
				`[${DATA_ATTRS.inlineAtomHost}]`,
			) as HTMLElement | null;
			expect(host).not.toBeNull();
			expect(isInlineAtomHostNode(host)).toBe(true);

			const afterAtomPoint = findLogicalDOMPoint(inlineElement, 2);
			expect(isInlineAtomCaretBoundaryNode(afterAtomPoint.node)).toBe(
				true,
			);
			expect(afterAtomPoint.offset).toBe(0);
			expect(afterAtomPoint.node.textContent).toBe("");
			expect(getLogicalNodeLength(afterAtomPoint.node)).toBe(0);
			expect(getLogicalTextContent(inlineElement)).toBe(
				`A${INLINE_ATOM_REPLACEMENT_TEXT}B`,
			);

			const selection = window.getSelection();
			expect(selection).not.toBeNull();
			selection!.removeAllRanges();
			const range = document.createRange();
			range.setStart(afterAtomPoint.node, afterAtomPoint.offset);
			range.collapse(true);
			selection!.addRange(range);

			expect(getSelectionOffsets(inlineElement)).toEqual({
				start: 2,
				end: 2,
			});
		} finally {
			inlineElement.remove();
			editor.destroy();
		}
	});

	it("renders inline nodes as logical atom elements", async () => {
		const editor = createPresetEditor();
		seedInlineAtomDocument(editor);
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		try {
			await act(async () => {
				root.render(
					<Pen.Editor.Root editor={editor}>
						<Pen.Editor.Content />
					</Pen.Editor.Root>,
				);
				await flushAnimationFrames(2);
			});

			const atom = container.querySelector(
				`[${DATA_ATTRS.inlineAtom}]`,
			) as HTMLElement | null;

			expect(atom).not.toBeNull();
			expect(atom?.getAttribute(DATA_ATTRS.inlineAtomType)).toBe(
				"mention",
			);
			expect(atom?.textContent).toBe("@Ada");
		} finally {
			await act(async () => {
				root.unmount();
			});
			container.remove();
			editor.destroy();
		}
	});

	it("renders inline atoms with configured React renderers", async () => {
		const editor = createPresetEditor();
		const blockId = seedInlineAtomDocument(editor);
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		try {
			await act(async () => {
				root.render(
					<Pen.Editor.Root
						editor={editor}
						inlineAtomRenderers={{
							mention: ({ props, selected, text }) => (
								<span
									data-selected={selected ? "true" : "false"}
									data-testid="mention-renderer"
								>
									{props.label as string}:{text}
								</span>
							),
						}}
					>
						<Pen.Editor.Content />
					</Pen.Editor.Root>,
				);
				await flushAnimationFrames(2);
			});

			const atom = container.querySelector(
				`[${DATA_ATTRS.inlineAtom}]`,
			) as HTMLElement | null;
			const renderedAtom = container.querySelector(
				"[data-testid='mention-renderer']",
			);
			const inlineElement = container.querySelector(
				`[${DATA_ATTRS.inlineContent}]`,
			) as HTMLElement | null;

			expect(atom).not.toBeNull();
			expect(inlineElement).not.toBeNull();
			expect(renderedAtom?.textContent).toBe("Ada:@Ada");
			expect(renderedAtom?.getAttribute("data-selected")).toBe("false");
			expect(atom?.textContent).toBe("Ada:@Ada");
			expect(domPointToOffset(inlineElement!, atom!, 0)).toBe(1);
			expect(domPointToOffset(inlineElement!, atom!, 1)).toBe(2);
			expect(
				domPointToOffset(
					inlineElement!,
					renderedAtom?.firstChild ?? renderedAtom!,
					1,
				),
			).toBe(2);
			expect(getInlineAtomElementData(atom!)).toEqual({
				type: "mention",
				props: { id: "user-1", label: "Ada" },
				text: "@Ada",
			});

			await act(async () => {
				editor.selectTextRange(
					{ blockId, offset: 1 },
					{ blockId, offset: 2 },
				);
				await flushAnimationFrames(2);
			});

			expect(renderedAtom?.getAttribute("data-selected")).toBe("true");
			expect(atom?.hasAttribute(DATA_ATTRS.selected)).toBe(true);
		} finally {
			await act(async () => {
				root.unmount();
			});
			container.remove();
			editor.destroy();
		}
	});

	it("keeps hook order stable when an inline atom renderer uses hooks", async () => {
		const editor = createPresetEditor();
		const blockId = seedInlineAtomDocument(editor);
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);
		const AtomRenderContext = createContext("chip");
		const hookErrors: string[] = [];
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation((...args: unknown[]) => {
				hookErrors.push(args.map(String).join(" "));
			});

		function MentionRenderer(props: {
			props: Record<string, unknown>;
			text: string;
		}) {
			const label = useContext(AtomRenderContext);
			useLayoutEffect(() => {
				void label;
			}, [label]);
			return (
				<span data-testid="hooked-mention">
					{String(props.props.label)}:{props.text}
				</span>
			);
		}

		try {
			await act(async () => {
				root.render(
					<AtomRenderContext.Provider value="chip">
						<Pen.Editor.Root
							editor={editor}
							inlineAtomRenderers={{
								mention: MentionRenderer,
							}}
						>
							<Pen.Editor.Content />
						</Pen.Editor.Root>
					</AtomRenderContext.Provider>,
				);
				await flushAnimationFrames(2);
			});

			expect(
				container.querySelector("[data-testid='hooked-mention']")
					?.textContent,
			).toBe("Ada:@Ada");
			expect(
				hookErrors.some((message) =>
					/change in the order of Hooks|Rendered more hooks than during the previous render/i.test(
						message,
					),
				),
			).toBe(false);

			await act(async () => {
				editor.selectTextRange(
					{ blockId, offset: 1 },
					{ blockId, offset: 2 },
				);
				await flushAnimationFrames(2);
			});

			expect(
				hookErrors.some((message) =>
					/change in the order of Hooks|Rendered more hooks than during the previous render/i.test(
						message,
					),
				),
			).toBe(false);
		} finally {
			consoleError.mockRestore();
			await act(async () => {
				root.unmount();
			});
			container.remove();
			editor.destroy();
		}
	});
});
