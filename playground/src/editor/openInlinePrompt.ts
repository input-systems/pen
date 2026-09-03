import type { AIController } from "@input/pen-ai";

export function openInlinePrompt(controller: AIController | null): void {
	controller?.openContextualPrompt({
		surface: "inline-edit",
		target: "auto",
	});
}
