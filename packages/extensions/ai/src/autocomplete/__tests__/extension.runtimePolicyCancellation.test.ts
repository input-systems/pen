import { describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { autocompleteExtension, getAutocompleteController } from "../index";
import { fieldEditorSlot, waitForCondition } from "./extension.testHelpers";

describe("@input/pen-ai/autocomplete: runtime policy cancellation", () => {
	it("cancels a scheduled request when runtime policy becomes ineligible", async () => {
		let modelCalled = false;
		const { fieldEditor, extension: fieldEditorSlotExtension } =
			fieldEditorSlot({ activeCellCoord: null });
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				autocompleteExtension({
					debounceMs: 50,
					model: {
						async *stream() {
							modelCalled = true;
							yield {
								type: "text-delta" as const,
								delta: " value",
							};
							yield { type: "done" as const };
						},
					},
				}),
				fieldEditorSlotExtension,
			],
		});
		const firstBlockId = editor.firstBlock()!.id;
		const codeBlockId = crypto.randomUUID();
		editor.apply([
			{
				type: "insert-block",
				blockId: codeBlockId,
				blockType: "codeBlock",
				props: {},
				position: { after: firstBlockId },
			},
			{
				type: "splice-text",
				blockId: codeBlockId,
				from: 0,
				to: 0,
				insert: "const answer =",
			},
		]);
		fieldEditor.focusBlockId = codeBlockId;
		editor.selectText(codeBlockId, 14, 14);

		const controller = getAutocompleteController(editor);
		expect(controller?.request()).toBe(true);
		expect(controller?.getState().status).toBe("scheduled");

		controller?.updateBlockPolicy({ allowInCodeBlocks: false });
		await new Promise((resolve) => setTimeout(resolve, 70));

		expect(modelCalled).toBe(false);
		expect(controller?.getState().status).toBe("idle");
		expect(controller?.getState().visibleSuggestionId).toBeNull();
		expect(controller?.getState().diagnostics.lastDismissReason).toBe(
			"policy-change",
		);
		expect(controller?.getState().diagnostics.lastBlockedReason).toBe(
			"code-block-disabled",
		);
		expect(
			controller?.getState().diagnostics.lastPolicyInvalidationStage,
		).toBe("scheduled");
		expect(
			controller?.getState().metrics.policyInvalidationScheduledCount,
		).toBe(1);
		expect(
			controller?.getState().metrics.policyInvalidationRequestingCount,
		).toBe(0);
		expect(
			controller?.getState().metrics.policyInvalidationShowingCount,
		).toBe(0);

		controller?.updateBlockPolicy({ allowInCodeBlocks: true });
		expect(controller?.request({ explicit: true })).toBe(true);
		expect(
			controller?.getState().diagnostics.lastPolicyInvalidationStage,
		).toBeNull();

		editor.destroy();
	});

	it("cancels an in-flight request when runtime policy becomes ineligible", async () => {
		let streamStarted = false;
		const { fieldEditor, extension: fieldEditorSlotExtension } =
			fieldEditorSlot({ activeCellCoord: null });
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				autocompleteExtension({
					debounceMs: 0,
					model: {
						async *stream() {
							streamStarted = true;
							await new Promise((resolve) =>
								setTimeout(resolve, 20),
							);
							yield {
								type: "text-delta" as const,
								delta: " value",
							};
							yield { type: "done" as const };
						},
					},
				}),
				fieldEditorSlotExtension,
			],
		});
		const firstBlockId = editor.firstBlock()!.id;
		const codeBlockId = crypto.randomUUID();
		editor.apply([
			{
				type: "insert-block",
				blockId: codeBlockId,
				blockType: "codeBlock",
				props: {},
				position: { after: firstBlockId },
			},
			{
				type: "splice-text",
				blockId: codeBlockId,
				from: 0,
				to: 0,
				insert: "const answer =",
			},
		]);
		fieldEditor.focusBlockId = codeBlockId;
		editor.selectText(codeBlockId, 14, 14);

		const controller = getAutocompleteController(editor);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(() => streamStarted);
		expect(controller?.getState().status).toBe("requesting");

		controller?.updateBlockPolicy({ allowInCodeBlocks: false });
		await new Promise((resolve) => setTimeout(resolve, 30));

		expect(controller?.getState().status).toBe("idle");
		expect(controller?.getState().visibleSuggestionId).toBeNull();
		expect(controller?.getState().metrics.successCount).toBe(0);
		expect(controller?.getState().diagnostics.lastDismissReason).toBe(
			"policy-change",
		);
		expect(controller?.getState().diagnostics.lastBlockedReason).toBe(
			"code-block-disabled",
		);
		expect(
			controller?.getState().diagnostics.lastPolicyInvalidationStage,
		).toBe("requesting");
		expect(
			controller?.getState().metrics.policyInvalidationScheduledCount,
		).toBe(0);
		expect(
			controller?.getState().metrics.policyInvalidationRequestingCount,
		).toBe(1);
		expect(
			controller?.getState().metrics.policyInvalidationShowingCount,
		).toBe(0);

		editor.destroy();
	});

	it("dismisses a visible suggestion when runtime policy becomes ineligible", async () => {
		const { fieldEditor, extension: fieldEditorSlotExtension } =
			fieldEditorSlot({ activeCellCoord: null });
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				autocompleteExtension({
					debounceMs: 0,
					model: {
						async *stream() {
							yield {
								type: "text-delta" as const,
								delta: " value",
							};
							yield { type: "done" as const };
						},
					},
				}),
				fieldEditorSlotExtension,
			],
		});
		const firstBlockId = editor.firstBlock()!.id;
		const codeBlockId = crypto.randomUUID();
		editor.apply([
			{
				type: "insert-block",
				blockId: codeBlockId,
				blockType: "codeBlock",
				props: {},
				position: { after: firstBlockId },
			},
			{
				type: "splice-text",
				blockId: codeBlockId,
				from: 0,
				to: 0,
				insert: "const answer =",
			},
		]);
		fieldEditor.focusBlockId = codeBlockId;
		editor.selectText(codeBlockId, 14, 14);

		const controller = getAutocompleteController(editor);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(
			() => controller?.getState().visibleSuggestionId !== null,
		);

		controller?.updateBlockPolicy({ allowInCodeBlocks: false });

		expect(controller?.getState().visibleSuggestionId).toBeNull();
		expect(controller?.getState().status).toBe("idle");
		expect(controller?.hasVisibleSuggestion()).toBe(false);
		expect(controller?.getState().diagnostics.lastDismissReason).toBe(
			"policy-change",
		);
		expect(
			controller?.getState().diagnostics.lastPolicyInvalidationStage,
		).toBe("showing");
		expect(
			controller?.getState().metrics.policyInvalidationScheduledCount,
		).toBe(0);
		expect(
			controller?.getState().metrics.policyInvalidationRequestingCount,
		).toBe(0);
		expect(
			controller?.getState().metrics.policyInvalidationShowingCount,
		).toBe(1);

		const controllerImpl = controller as unknown as {
			_state: {
				blockPolicy: {
					allowInCodeBlocks?: boolean;
					allowInTables?: boolean;
					allowedBlockTypes?: readonly string[];
					deniedBlockTypes?: readonly string[];
				};
			};
			_continuation: {
				setSequence(sequence: {
					requestId: string;
					blockId: string;
					startOffset: number;
					candidate: {
						rawText: string;
						inlineText: string;
						appendedBlocks: readonly [];
						previewBlocks: readonly [];
					};
					continuationDepth: number;
				}): void;
			};
			_setState: (nextState: {
				status: "showing";
				activeRequestId: string;
				visibleSuggestionId: string;
			}) => void;
		};
		controllerImpl._state.blockPolicy = {
			...controller!.getBlockPolicy(),
			allowInCodeBlocks: false,
		};
		controllerImpl._continuation.setSequence({
			requestId: "manual-policy-recheck",
			blockId: codeBlockId,
			startOffset: 14,
			candidate: {
				rawText: " value",
				inlineText: " value",
				appendedBlocks: [],
				previewBlocks: [],
			},
			continuationDepth: 0,
		});
		controllerImpl._setState({
			status: "showing",
			activeRequestId: "manual-policy-recheck",
			visibleSuggestionId: "manual-policy-recheck",
		});
		expect(controller?.acceptVisibleSuggestion()).toBe(false);
		expect(
			controller?.getState().metrics.policyInvalidationShowingCount,
		).toBe(2);
		expect(controller?.getState().diagnostics.lastDismissReason).toBe(
			"policy-change",
		);

		editor.destroy();
	});

	it("blocks table-cell autocomplete when tables are disabled", () => {
		let modelCalled = false;
		const { fieldEditor, extension: fieldEditorSlotExtension } =
			fieldEditorSlot({ activeCellCoord: { blockId: "table-1", row: 0, col: 0 } });
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				autocompleteExtension({
					debounceMs: 0,
					blockPolicy: {
						allowInTables: false,
					},
					model: {
						async *stream() {
							modelCalled = true;
							yield {
								type: "text-delta" as const,
								delta: " cell",
							};
							yield { type: "done" as const };
						},
					},
				}),
				fieldEditorSlotExtension,
			],
		});

		editor.apply([
			{
				type: "insert-block",
				blockId: "table-1",
				blockType: "table",
				props: {},
				position: "last",
			},
		]);
		fieldEditor.focusBlockId = "table-1";
		editor.selectText("table-1", 0, 0);

		const controller = getAutocompleteController(editor);
		expect(controller?.request({ explicit: true })).toBe(false);
		expect(modelCalled).toBe(false);
		expect(controller?.getState().diagnostics.lastBlockedReason).toBe(
			"table-disabled",
		);

		editor.destroy();
	});
});
