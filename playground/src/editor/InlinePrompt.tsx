import { InlinePromptComposer } from "./InlinePromptComposer";
import { InlinePromptPositioner } from "./InlinePromptPositioner";
import { useAskAiShortcut } from "./useAskAiShortcut";

const PLACEHOLDER = "Describe how to edit…";

/**
 * The inline prompt Input's composer uses: `⌘J` / `Ctrl+J` (or the wand in
 * the toolbar) opens a box on the current block. Ask for an edit; the answer
 * lands in the document, same path as the agent on the left.
 *
 * Three pieces: the shortcut that opens a session, the positioner that puts
 * the box in the document flow before the target block, and the composer
 * chrome inside it.
 */
export function InlinePrompt() {
	useAskAiShortcut();

	return (
		<InlinePromptPositioner>
			<InlinePromptComposer placeholder={PLACEHOLDER} />
		</InlinePromptPositioner>
	);
}
