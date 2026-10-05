import { describe, expect, it } from "vitest";
import {
	aiEgressFacet,
	createEditor,
	defineExtension,
	getInlineCompletionController,
	streamThroughEgress,
} from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { createModelDouble } from "@input/pen-test";
import type {
	AIRequestContext,
	AIRequestFilter,
	DiagnosticEvent,
	ModelAdapter,
} from "@input/pen-types";
import { AI_REQUEST_REFUSED_CODE } from "@input/pen-types";
import { streamThroughEgress as localStreamThroughEgress } from "../aiEgress";
import { autocompleteExtension, getAutocompleteController } from "../index";
import { fieldEditorSlot, waitForCondition } from "./extension.testHelpers";

const SECRET = "SECRET";

function aiEgressExtension(filter: AIRequestFilter) {
	return defineExtension({
		name: "test-ai-egress",
		facets: [aiEgressFacet.of(filter)],
	});
}

function countingAdapter(inner: ModelAdapter): ModelAdapter & {
	calls: number;
} {
	const adapter = {
		calls: 0,
		stream(options: Parameters<ModelAdapter["stream"]>[0]) {
			adapter.calls += 1;
			return inner.stream(options);
		},
	};
	return adapter;
}

function redactSecret(context: AIRequestContext): AIRequestContext {
	const redact = (value: string) =>
		value.replace(new RegExp(SECRET, "g"), "[redacted]");
	return {
		...context,
		documentExcerpts: context.documentExcerpts.map((excerpt) => ({
			...excerpt,
			text: redact(excerpt.text),
		})),
		messages: context.messages.map((message) => ({
			...message,
			content:
				typeof message.content === "string"
					? redact(message.content)
					: message.content,
		})),
	};
}

function assertAutocompleteDeclaration(recorded: AIRequestContext): void {
	expect(recorded.feature).toBe("autocomplete");
	expect(recorded.tools).toEqual([]);
	for (const excerpt of recorded.documentExcerpts) {
		expect(["target", "context"]).toContain(excerpt.kind);
	}
	expect(
		recorded.documentExcerpts.some(
			(excerpt) => excerpt.kind === "selection",
		),
	).toBe(false);
	expect(
		recorded.documentExcerpts.some(
			(excerpt) => excerpt.kind === "tool-result",
		),
	).toBe(false);
}

describe("AIB1 autocomplete live egress", () => {
	it("uses the core streamThroughEgress, not a local copy", () => {
		expect(localStreamThroughEgress).toBe(streamThroughEgress);
	});

	it("AIB1: a refusing facet blocks the autocomplete request path", async () => {
		const slot = fieldEditorSlot();
		const double = createModelDouble({
			responses: [{ text: " should never appear" }],
		});
		const model = countingAdapter(double);
		const diagnostics: DiagnosticEvent[] = [];
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				aiEgressExtension(() => null),
				autocompleteExtension({
					debounceMs: 0,
					model,
				}),
				slot.extension,
			],
		});
		editor.on("diagnostic", (event) => {
			diagnostics.push(event as DiagnosticEvent);
		});
		const blockId = editor.firstBlock()!.id;
		slot.fieldEditor.focusBlockId = blockId;
		editor.apply(
			[{ type: "splice-text", blockId, from: 0, to: 0, insert: "Hello" }],
			{ origin: "user" },
		);
		editor.selectText(blockId, 5, 5);

		const controller = getAutocompleteController(editor);
		const inlineCompletion = getInlineCompletionController(editor);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(() => controller?.getState().status === "idle");

		expect(model.calls).toBe(0);
		expect(double.requests).toEqual([]);
		expect(inlineCompletion?.getState().visibleSuggestion).toBeNull();
		expect(
			diagnostics.some(
				(event) =>
					event.code === AI_REQUEST_REFUSED_CODE &&
					event.feature === "autocomplete",
			),
		).toBe(true);

		editor.destroy();
	});

	it("AIB1: a redacting facet changes the autocomplete request payload", async () => {
		const slot = fieldEditorSlot();
		const double = createModelDouble({
			responses: [{ text: " world" }],
		});
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				aiEgressExtension(redactSecret),
				autocompleteExtension({
					debounceMs: 0,
					model: double,
				}),
				slot.extension,
			],
		});
		const firstBlockId = editor.firstBlock()!.id;
		editor.apply(
			[
				{
					type: "splice-text",
					blockId: firstBlockId,
					from: 0,
					to: 0,
					insert: "Neighbor SECRET context.",
				},
			],
			{ origin: "user" },
		);
		const targetBlockId = crypto.randomUUID();
		editor.apply(
			[
				{
					type: "insert-block",
					blockId: targetBlockId,
					blockType: "paragraph",
					props: {},
					position: { after: firstBlockId },
				},
				{
					type: "splice-text",
					blockId: targetBlockId,
					from: 0,
					to: 0,
					insert: "Hello SECRET",
				},
			],
			{ origin: "user" },
		);
		slot.fieldEditor.focusBlockId = targetBlockId;
		editor.selectText(targetBlockId, 12, 12);

		const controller = getAutocompleteController(editor);
		const inlineCompletion = getInlineCompletionController(editor);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(
			() =>
				inlineCompletion?.getState().visibleSuggestion?.text ===
				" world",
		);

		expect(double.requests).toHaveLength(1);
		const recorded = double.requests[0]!;
		assertAutocompleteDeclaration(recorded);
		expect(
			recorded.documentExcerpts.some(
				(excerpt) =>
					excerpt.blockId === targetBlockId &&
					excerpt.kind === "target",
			),
		).toBe(true);
		expect(
			recorded.documentExcerpts.some(
				(excerpt) =>
					excerpt.blockId === firstBlockId &&
					excerpt.kind === "context",
			),
		).toBe(true);
		const payload = JSON.stringify(recorded);
		expect(payload).toContain("[redacted]");
		expect(payload).not.toContain(SECRET);

		editor.destroy();
	});

	it("AIB1: a refusing facet blocks the autocomplete continuation path", async () => {
		const slot = fieldEditorSlot();
		const double = createModelDouble({
			responses: [
				{ text: " world from pen" },
				{ text: " should never prefetch" },
			],
		});
		const model = countingAdapter(double);
		let autocompleteRequests = 0;
		const diagnostics: DiagnosticEvent[] = [];
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				aiEgressExtension((context) => {
					if (context.feature !== "autocomplete") {
						return context;
					}
					autocompleteRequests += 1;
					return autocompleteRequests === 1 ? context : null;
				}),
				autocompleteExtension({
					debounceMs: 0,
					prefetchAfterAccept: true,
					model,
				}),
				slot.extension,
			],
		});
		editor.on("diagnostic", (event) => {
			diagnostics.push(event as DiagnosticEvent);
		});
		const blockId = editor.firstBlock()!.id;
		slot.fieldEditor.focusBlockId = blockId;
		editor.apply(
			[{ type: "splice-text", blockId, from: 0, to: 0, insert: "Hello" }],
			{ origin: "user" },
		);
		editor.selectText(blockId, 5, 5);

		const controller = getAutocompleteController(editor);
		const inlineCompletion = getInlineCompletionController(editor);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(
			() =>
				inlineCompletion?.getState().visibleSuggestion?.text ===
				" world from pen",
		);
		expect(model.calls).toBe(1);

		expect(controller?.acceptVisibleSuggestion()).toBe(true);
		await waitForCondition(() =>
			diagnostics.some((event) => event.code === AI_REQUEST_REFUSED_CODE),
		);

		expect(model.calls).toBe(1);
		expect(double.requests).toHaveLength(1);
		expect(inlineCompletion?.getState().visibleSuggestion).toBeNull();

		editor.destroy();
	});

	it("AIB1: a redacting facet changes the autocomplete continuation payload", async () => {
		const slot = fieldEditorSlot();
		const double = createModelDouble({
			responses: [
				{ text: " world from pen" },
				{ text: " and then some more" },
			],
		});
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				aiEgressExtension(redactSecret),
				autocompleteExtension({
					debounceMs: 0,
					prefetchAfterAccept: true,
					model: double,
				}),
				slot.extension,
			],
		});
		const blockId = editor.firstBlock()!.id;
		slot.fieldEditor.focusBlockId = blockId;
		editor.apply(
			[
				{
					type: "splice-text",
					blockId,
					from: 0,
					to: 0,
					insert: "Hello SECRET",
				},
			],
			{ origin: "user" },
		);
		editor.selectText(blockId, 12, 12);

		const controller = getAutocompleteController(editor);
		const inlineCompletion = getInlineCompletionController(editor);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(
			() =>
				inlineCompletion?.getState().visibleSuggestion?.text ===
				" world from pen",
		);

		expect(controller?.acceptVisibleSuggestion()).toBe(true);
		await waitForCondition(() => double.requests.length === 2);

		const continuation = double.requests[1]!;
		assertAutocompleteDeclaration(continuation);
		expect(String(continuation.messages[1]?.content ?? "")).toContain(
			"[continuation]",
		);
		const payload = JSON.stringify(continuation);
		expect(payload).toContain("[redacted]");
		expect(payload).not.toContain(SECRET);

		editor.destroy();
	});
});
