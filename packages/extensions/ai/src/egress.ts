import {
	aiEgressExtension,
	aiEgressFacet,
	filterAIRequest,
	streamThroughEgress,
} from "@input/pen-core";
import {
	AI_EGRESS_INVENTORY_CODE,
	AI_REQUEST_REFUSED_CODE,
	type AIRequestContext,
	type Editor,
	type ModelRequestedOperation,
} from "@input/pen-types";
import {
	AI_TOOL_RESULT_MAX_CHARS,
	compactToolResult,
	type ToolJournalEntry,
} from "./runtime/stepJournal";
import type { AIWorkingSetEnvelope } from "./types";
import type { AISelectionWorkingSetContext } from "./types/controller";

export {
	aiEgressExtension,
	aiEgressFacet,
	filterAIRequest,
	streamThroughEgress,
};
export { AI_EGRESS_INVENTORY_CODE, AI_REQUEST_REFUSED_CODE };

type AIDocumentExcerpt = AIRequestContext["documentExcerpts"][number];
type AIDocumentExcerptKind = AIDocumentExcerpt["kind"];
type AIRequestFeature = AIRequestContext["feature"];

export const AI_FEATURE_CONTENT = {
	generation: {
		feature: "generation" as const,
		excerptKinds: ["selection", "target", "context"] as const,
		includesToolResults: false,
	},
	"agentic-step": {
		feature: "agentic-step" as const,
		excerptKinds: [
			"selection",
			"target",
			"context",
			"tool-result",
		] as const,
		includesToolResults: true,
		toolResultMaxChars: AI_TOOL_RESULT_MAX_CHARS,
	},
	suggestions: {
		feature: "suggestions" as const,
		excerptKinds: ["target", "context"] as const,
		includesToolResults: false,
		maxScopeChars: 320,
	},
	autocomplete: {
		feature: "autocomplete" as const,
		excerptKinds: ["target", "context"] as const,
		includesToolResults: false,
	},
} as const;

export function excerptsFromOperation(
	operation: ModelRequestedOperation,
	fallbackBlockId: string,
): AIDocumentExcerpt[] {
	const target = operation.target;
	switch (target.kind) {
		case "selection":
			return [
				{
					blockId: target.blockId ?? target.anchor.blockId,
					kind: "selection",
					text: target.sourceText,
				},
			];
		case "scoped-range":
			return [
				{
					blockId: target.blockId ?? target.anchor.blockId,
					kind: "selection",
					text: target.sourceText,
				},
			];
		case "block":
			return [
				{
					blockId: target.blockId,
					kind: "target",
					text: target.sourceText,
				},
			];
		case "document":
			return [
				{
					blockId: target.activeBlockId ?? fallbackBlockId,
					kind: "context",
					text: "",
				},
			];
		default: {
			const unexpected: never = target;
			return unexpected;
		}
	}
}

export function excerptsFromAgenticStep(input: {
	editor: Editor;
	blockId: string;
	workingSet: AIWorkingSetEnvelope | null;
	toolJournal: readonly ToolJournalEntry[];
}): AIDocumentExcerpt[] {
	const excerpts: AIDocumentExcerpt[] = [];
	const workingSet = input.workingSet;
	const selectionContext =
		workingSet?.source === "selection" &&
		workingSet.context &&
		typeof workingSet.context === "object"
			? (workingSet.context as AISelectionWorkingSetContext)
			: null;
	const targetBlock = input.editor.getBlock(input.blockId);
	if (targetBlock && !selectionContext) {
		excerpts.push({
			blockId: input.blockId,
			kind: "target",
			text: targetBlock.textContent(),
		});
	}

	if (workingSet) {
		if (selectionContext) {
			const selectedContent =
				selectionContext.selectionScope === "whole-blocks"
					? selectionContext.markdown
					: selectionContext.selectedText;
			if (selectedContent.length > 0) {
				excerpts.push({
					blockId: workingSet.trackedBlockIds[0] ?? input.blockId,
					kind: "selection",
					text: selectedContent,
				});
			}
		}
		if (!selectionContext) {
			for (const blockId of workingSet.trackedBlockIds) {
				if (blockId === input.blockId) {
					continue;
				}
				const block = input.editor.getBlock(blockId);
				if (!block) {
					continue;
				}
				excerpts.push({
					blockId,
					kind: "context",
					text: block.textContent(),
				});
			}
		}
	}

	for (const entry of input.toolJournal) {
		excerpts.push({
			blockId: toolResultBlockId(entry, input.blockId),
			kind: "tool-result",
			text: excerptText(compactToolResult(entry.output)),
		});
	}
	return excerpts;
}

export function requestFeatureForAgenticStep(
	toolJournalLength: number,
	preferred: AIRequestFeature = "generation",
): AIRequestFeature {
	return toolJournalLength > 0 ? "agentic-step" : preferred;
}

function toolResultBlockId(
	entry: ToolJournalEntry,
	fallbackBlockId: string,
): string {
	if (entry.input && typeof entry.input === "object") {
		const blockId = (entry.input as { blockId?: unknown }).blockId;
		if (typeof blockId === "string" && blockId.length > 0) {
			return blockId;
		}
	}
	return fallbackBlockId;
}

function excerptText(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	try {
		return JSON.stringify(value) ?? "";
	} catch {
		return "";
	}
}

export function excerptKindsOf(
	feature: AIRequestFeature,
): readonly AIDocumentExcerptKind[] {
	return AI_FEATURE_CONTENT[feature].excerptKinds;
}
