import { useEffect } from "react";
import { useAIContext } from "@input/pen-react";
import { isModShortcut } from "../ui/shortcut";
import { openInlinePrompt } from "./openInlinePrompt";

/**
 * Input's `⌘J` / `Ctrl+J`. The library `SelectionTrigger` only opens when
 * text is highlighted; a caret in a block is enough here, the way the
 * composer works.
 *
 * Listens in the capture phase so the editor's own keymap cannot swallow it.
 * Ignored inside form fields and inside an open prompt, where `J` is a letter.
 */
export function useAskAiShortcut(): void {
	const { controller } = useAIContext();

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (
				controller == null ||
				!isModShortcut(event, "j") ||
				isTypingTarget(event.target)
			) {
				return;
			}
			event.preventDefault();
			openInlinePrompt(controller);
		};

		document.addEventListener("keydown", handleKeyDown, true);
		return () =>
			document.removeEventListener("keydown", handleKeyDown, true);
	}, [controller]);
}

function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) {
		return false;
	}
	return (
		target.closest("[data-pen-ai-inline-session]") !== null ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLInputElement ||
		target instanceof HTMLSelectElement
	);
}
