import type { Editor } from "@input/pen-types";
import { Icon } from "../ui/Icon";
import { ScrollArea } from "../ui/ScrollArea";
import { ChatComposer } from "./ChatComposer";
import { ChatEmpty } from "./ChatEmpty";
import { ChatBarActions } from "./ChatBarActions";
import { ChatTranscript } from "./ChatTranscript";
import { useChat } from "./useChat";

/**
 * The left column: ask for an edit, watch the document change.
 *
 * The composer stays at the bottom. Before anything is asked, the suggestions
 * sit in the middle of the column; after that the transcript takes the room.
 *
 * Pen ships no chat component. It exposes the AI state and the actions, and the
 * UI is entirely yours: `useChat` is the state, the four components are the
 * view.
 */
export function ChatSidebar({ editor }: { editor: Editor }) {
	const chat = useChat(editor);
	const isFirstPrompt = chat.turns.length === 0;

	return (
		<aside className="chat-panel" aria-label="Agent">
			<header className="chat-bar">
				<span className="chat-bar-icon">
					<Icon.PenMagic />
				</span>
				<h5>Agent</h5>
				<ChatBarActions editor={editor} onNewChat={chat.reset} />
			</header>

			{isFirstPrompt ? (
				<ChatEmpty onSend={chat.send} />
			) : (
				<div className="chat-body">
					<ScrollArea autoScroll>
						<ChatTranscript
							turns={chat.turns}
							activity={chat.activity}
						/>
					</ScrollArea>
				</div>
			)}

			<ChatComposer
				busy={chat.isBusy}
				onSend={chat.send}
				onStop={chat.stop}
			/>
		</aside>
	);
}
