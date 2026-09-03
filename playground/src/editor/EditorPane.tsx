import { getAIController } from "@input/pen-ai";
import { Pen } from "@input/pen-react";
import type { Editor } from "@input/pen-types";
import { playgroundAssets } from "./assets";
import { FormatToolbar } from "./FormatToolbar";
import { ImageBlockRenderer } from "./ImageBlock";
import { InlinePrompt } from "./InlinePrompt";
import { openInlinePrompt } from "./openInlinePrompt";
import { ReviewSurface } from "./ReviewSurface";
import { SlashMenu } from "./SlashMenu";

/**
 * Pen renders `image` itself; this swaps in a version that also lets you fill
 * an empty one. Every other block type falls through to the library renderer.
 */
const BLOCK_RENDERERS = { image: ImageBlockRenderer };

interface EditorPaneProps {
	editor: Editor;
	inspectorOpen: boolean;
	collaborationLive: boolean;
	onOpenCollaborate: () => void;
	onToggleInspector: () => void;
}

/**
 * The middle column: a toolbar above the document.
 *
 * `Pen.Editor.Root` owns the editing surface — focus, selection, keyboard, and
 * clipboard — and `Pen.Editor.Content` renders the blocks. Both are unstyled;
 * everything you see comes from `editor.css`.
 */
export function EditorPane({
	editor,
	inspectorOpen,
	collaborationLive,
	onOpenCollaborate,
	onToggleInspector,
}: EditorPaneProps) {
	const handleOpenInlinePrompt = () => {
		openInlinePrompt(getAIController(editor));
	};

	return (
		<main className="editor-pane">
			<FormatToolbar
				editor={editor}
				inspectorOpen={inspectorOpen}
				collaborationLive={collaborationLive}
				onOpenCollaborate={onOpenCollaborate}
				onToggleInspector={onToggleInspector}
				onOpenInlinePrompt={handleOpenInlinePrompt}
			/>
			<ReviewSurface editor={editor}>
				<div className="editor-scroll">
					{/*
					 * `Pen.Editor.Root` binds a field editor and a rendered DOM tree
					 * to one editor instance for its whole lifetime. Joining or
					 * leaving a room replaces the instance, so the surface is keyed
					 * to force a fresh mount instead of leaving the old field editor
					 * projecting DOM selections into a document it no longer knows.
					 *
					 * `Pen.AI.Root` has to wrap the content host: the inline prompt
					 * looks up `[data-pen-editor-content]` from that ancestor, then
					 * inserts itself before the current block.
					 */}
					<Pen.AI.Root editor={editor}>
						<Pen.Editor.Root
							editor={editor}
							key={editor.internals.viewId}
							assets={playgroundAssets}
							renderers={BLOCK_RENDERERS}
						>
							<Pen.Editor.Content emptyPlaceholder="Write something, or ask AI." />
							{collaborationLive ? (
								<Pen.Multiplayer.CaretOverlay />
							) : null}
							<SlashMenu editor={editor} />
							<InlinePrompt />
						</Pen.Editor.Root>
					</Pen.AI.Root>
				</div>
			</ReviewSurface>
		</main>
	);
}
