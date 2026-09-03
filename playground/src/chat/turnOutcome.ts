import type { GenerationState } from "@input/pen-ai";

/**
 * One line about what a finished turn did to the document.
 *
 * The agent never answers in prose the sidebar could print — the answer is
 * the document — so this reads the generation Pen hands back and says what
 * changed: staged suggestions, tool edits, streamed text, or nothing.
 */
export function describeTurnOutcome(
	generation: GenerationState | null,
): string {
	if (!generation) {
		return "Nothing ran — is a model configured?";
	}

	if (generation.status === "cancelled") {
		return "Stopped.";
	}

	// A turn can fail after the model answered at length — an edit plan that
	// did not parse leaves the document untouched. Report why rather than the
	// character count, which reads like a success.
	if (generation.status === "error" && generation.turnReason) {
		return generation.turnReason;
	}

	const refusal = describeRefusal(generation);
	if (refusal) {
		return refusal;
	}

	if (generation.mutationReceipt?.status === "staged_suggestions") {
		const proposedCount = generation.suggestionIds?.length ?? 0;
		return `Proposed ${proposedCount} changes — review in the editor`;
	}

	const toolNames = uniqueToolNames(generation);
	if (toolNames.length > 0) {
		return `Edited the document with ${toolNames.join(", ")}.`;
	}

	const writtenLength = generation.text.trim().length;
	if (writtenLength > 0) {
		// On the tool channel the model's text is an answer, not an edit, so a
		// turn that only talked wrote nothing — saying otherwise is how a
		// request the model quietly declined reads as a success.
		return generation.mutationReceipt?.status === "applied"
			? `Wrote ${writtenLength} characters into the document.`
			: "Answered without editing the document.";
	}

	return "No changes.";
}

function uniqueToolNames(generation: GenerationState): string[] {
	const names = generation.steps
		.filter((step) => step.type === "tool-call")
		.map((step) => step.toolName)
		.filter((name): name is string => Boolean(name));
	return [...new Set(names)];
}

/**
 * A document tool can refuse part of what it was asked and hand the reason
 * back to the model. Those turns still ran a tool, so reporting them as edits
 * would hide the interesting half of the transcript.
 */
function describeRefusal(generation: GenerationState): string | null {
	const reasons = generation.steps.flatMap((step) => {
		const rejected = (step.output as { rejected?: unknown } | null)
			?.rejected;
		return Array.isArray(rejected)
			? rejected.map((entry) =>
					String((entry as { reason?: unknown }).reason),
				)
			: [];
	});

	if (reasons.length === 0) {
		return null;
	}

	return `Refused ${reasons.length} operation(s): ${[...new Set(reasons)].join(" ")}`;
}
