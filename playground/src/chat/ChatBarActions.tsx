import { useState } from "react";
import { getAIController } from "@input/pen-ai";
import { useAI } from "@input/pen-react";
import type { Editor } from "@input/pen-types";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Toggle } from "../ui/Toggle";
import { ApiKeyModal } from "./ApiKeyModal";
import { useSmoothStream } from "./useSmoothStream";

/**
 * The controls on the agent bar: review vs apply directly, a new chat,
 * and the Anthropic key. Paced reveal is always on (except reduced motion).
 */
export function ChatBarActions({
	editor,
	onNewChat,
}: {
	editor: Editor;
	onNewChat: () => void;
}) {
	const [isKeyOpen, setIsKeyOpen] = useState(false);

	const openKey = () => {
		setIsKeyOpen(true);
	};

	const closeKey = () => {
		setIsKeyOpen(false);
	};

	return (
		<div className="chat-bar-actions">
			<ReviewToggle editor={editor} />
			<RevealStatus editor={editor} />
			<Button.Tooltip content="New Chat">
				<Button.Icon label="New Chat" onClick={onNewChat}>
					<Icon.Plus />
				</Button.Icon>
			</Button.Tooltip>
			<Button.Tooltip content="Anthropic API Key">
				<Button.Icon label="Anthropic API Key" onClick={openKey}>
					<Icon.Anthropic />
				</Button.Icon>
			</Button.Tooltip>
			<ApiKeyModal open={isKeyOpen} onClose={closeKey} />
		</div>
	);
}

function ReviewToggle({ editor }: { editor: Editor }) {
	const aiState = useAI(editor);
	const isReview = aiState.mutationPreference !== "direct";

	const handleChange = (active: boolean) => {
		getAIController(editor)?.setMutationPreference(
			active ? "suggestions" : "direct",
		);
	};

	return <Toggle active={isReview} label="Review" onChange={handleChange} />;
}

function RevealStatus({ editor }: { editor: Editor }) {
	const smooth = useSmoothStream(editor);
	if (!smooth.isRevealing && smooth.hiddenCharCount === 0) {
		return null;
	}

	return (
		<span className="chat-reveal-status">
			{smooth.hiddenCharCount} characters catching up
		</span>
	);
}
