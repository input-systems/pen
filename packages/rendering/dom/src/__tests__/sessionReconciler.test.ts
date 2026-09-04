import {
	createDecorationSet,
	createHeadlessEditor,
	decorationsFacet,
	defineExtension,
	emptyDecorationSet,
} from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionReconciler } from "../field-editor/sessionReconciler";
import { DomScheduler } from "../scheduler";

describe("SessionReconciler", () => {
	beforeEach(() => {
		vi.stubGlobal(
			"requestAnimationFrame",
			(callback: FrameRequestCallback) => {
				callback(0);
				return 1;
			},
		);
		vi.stubGlobal("cancelAnimationFrame", () => {});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("does not reconcile the focus block after a user commit", () => {
		const editor = createHeadlessEditor({ schema: defaultSchema });
		const blockId = editor.firstBlock()!.id;
		const getYText = vi.fn(() => null);
		const reconciler = createReconciler(editor, blockId, getYText);

		editor.apply([
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "a",
			},
		]);

		expect(getYText).not.toHaveBeenCalled();
		reconciler.destroy();
		editor.destroy();
	});

	it("reconciles the focus block after a structured history commit", () => {
		const editor = createHeadlessEditor({ schema: defaultSchema });
		const blockId = editor.firstBlock()!.id;
		const getYText = vi.fn(() => null);
		const reconciler = createReconciler(editor, blockId, getYText);

		editor.apply(
			[
				{
					type: "splice-text",
					blockId,
					from: 0,
					to: 0,
					insert: "a",
				},
			],
			{ origin: { type: "history", source: "undo" } },
		);

		expect(getYText).toHaveBeenCalledWith(blockId);
		reconciler.destroy();
		editor.destroy();
	});

	it("projects the selection back after a decoration change rebuilds an expanded surface", () => {
		// a refresh that changes nothing keeps the decoration set (SCALE2), so the
		// facet has to produce a different decoration for the change to fire
		let isMarked = false;
		const editor = createHeadlessEditor({
			schema: defaultSchema,
			extensions: [
				defineExtension({
					name: "test-toggle-decoration",
					facets: [
						decorationsFacet.of((_state, currentEditor) => {
							const firstBlockId = currentEditor.firstBlock()?.id;
							if (!firstBlockId || !isMarked) {
								return emptyDecorationSet();
							}
							return createDecorationSet([
								{
									type: "block",
									blockId: firstBlockId,
									attributes: { marked: true },
								},
							]);
						}),
					],
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		const projectSelection = vi.fn();
		const reconciler = createReconciler(editor, blockId, () => null, {
			mode: "expanded",
			projectSelection,
		});

		isMarked = true;
		editor.requestDecorationUpdate();

		expect(projectSelection).toHaveBeenCalledTimes(1);
		reconciler.destroy();
		editor.destroy();
	});
});

function createReconciler(
	editor: ReturnType<typeof createHeadlessEditor>,
	blockId: string,
	getYText: () => null,
	options: {
		mode?: "single" | "expanded";
		projectSelection?: () => void;
	} = {},
) {
	const scheduler = new DomScheduler("session-reconciler-test");
	const shouldProjectSelection = options.projectSelection !== undefined;
	return new SessionReconciler(editor, {
		getSnapshot: () => ({
			focusBlockId: blockId,
			activeBlockIds: [blockId],
			isEditing: true,
			mode: options.mode ?? "single",
		}),
		getAttachedElement: () => null,
		getInlineElement: () => null,
		getYText,
		shouldPreserveSelection: () => false,
		shouldProjectSelection: () => shouldProjectSelection,
		projectSelection: options.projectSelection ?? (() => {}),
		getScheduler: () => scheduler,
	});
}
