import { useLayoutEffect, type FormEvent, type KeyboardEvent } from "react";
import type { AISession } from "@input/pen-ai";
import {
	useAIContext,
	useAISessionActions,
	useContextualPromptSession,
} from "@input/pen-react";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { keepCaret } from "../ui/keepCaret";

/**
 * Input's inline intelligence chrome: history of what you asked, the textarea,
 * then an action row. The send arrow stays put like the agent composer — this
 * playground has no quick-action chips to fill an empty row. While a review is
 * pending and the box is empty, that row is Discard / Accept instead.
 */
export function InlinePromptComposer({ placeholder }: { placeholder: string }) {
	const { editor } = useAIContext();
	const session = useContextualPromptSession(editor);

	if (!session) {
		return null;
	}
	return <InlinePromptForm session={session} placeholder={placeholder} />;
}

interface InlinePromptFormProps {
	session: AISession;
	placeholder: string;
}

function InlinePromptForm({ session, placeholder }: InlinePromptFormProps) {
	const { editor, state, controller } = useAIContext();
	const actions = useAISessionActions(editor);

	const sessionId = session.id;
	const isRunning =
		state.activeGeneration?.sessionId === sessionId &&
		state.activeGeneration.status === "streaming";
	const pendingCount = session.pendingSuggestionIds.length;
	const isReviewing = pendingCount > 0 && !isRunning;

	// Undo restages the last ask as the draft; Input keeps it in history only.
	const storedDraft = session.contextualPrompt?.composer.draftPrompt ?? "";
	const latestTurnPrompt = session.turns.at(-1)?.prompt ?? "";
	const isRestoredReviewDraft =
		isReviewing &&
		latestTurnPrompt !== "" &&
		storedDraft === latestTurnPrompt;
	const draftPrompt = isRestoredReviewDraft ? "" : storedDraft;

	const isPromptEmpty = draftPrompt.trim().length === 0;
	const showApprove = isReviewing && isPromptEmpty;
	const canSend = !isPromptEmpty && !isRunning;

	useLayoutEffect(() => {
		if (isRestoredReviewDraft) {
			controller?.updateContextualPromptDraft(sessionId, "");
		}
	}, [controller, isRestoredReviewDraft, sessionId]);

	function submit() {
		const prompt = draftPrompt.trim();
		if (!prompt || isRunning) {
			return;
		}
		void actions.runSessionPrompt(sessionId, prompt, {
			target: "selection",
		});
	}

	function accept() {
		if (actions.acceptSession(sessionId)) {
			editor.undoManager.stopCapturing();
		}
	}

	function discard() {
		if (actions.rejectSession(sessionId)) {
			editor.undoManager.stopCapturing();
			return;
		}
		actions.cancelSession(sessionId);
	}

	function dismiss() {
		if (isRunning) {
			return;
		}
		if (isReviewing) {
			discard();
			return;
		}
		actions.cancelSession(sessionId);
	}

	// Enter sends (or accepts while reviewing), Shift+Enter breaks a line,
	// Escape dismisses.
	function confirm() {
		if (showApprove) {
			accept();
		} else {
			submit();
		}
	}

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		confirm();
	}

	function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
		if (
			event.key === "Enter" &&
			!event.shiftKey &&
			event.target instanceof HTMLTextAreaElement
		) {
			event.preventDefault();
			event.stopPropagation();
			confirm();
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			dismiss();
		}
	}

	const historyItems = session.turns.map((turn) => (
		<div key={turn.id} data-pen-ai-inline-session-prompt="">
			{turn.prompt}
		</div>
	));

	return (
		<form
			data-pen-ai-inline-session-form=""
			onSubmit={handleSubmit}
			onKeyDown={handleKeyDown}
		>
			{historyItems.length > 0 ? (
				<div data-pen-ai-inline-session-history="">{historyItems}</div>
			) : null}
			<textarea
				data-pen-ai-inline-session-input=""
				placeholder={placeholder}
				value={draftPrompt}
				onChange={(event) =>
					actions.updateContextualPromptDraft(
						sessionId,
						event.target.value,
					)
				}
			/>
			<div data-pen-ai-inline-session-controls="">
				<div data-pen-ai-inline-session-status="">
					{describeStatus(isRunning, pendingCount)}
				</div>
				<div data-pen-ai-inline-session-actions="">
					{isRunning ? (
						<Button.Tooltip content="Stop" side="top">
							<Button.Icon
								label="Stop"
								kind="faded"
								onPointerDown={keepCaret}
								onClick={() => actions.cancelSession(sessionId)}
							>
								<Icon.Stop />
							</Button.Icon>
						</Button.Tooltip>
					) : null}
					{!isRunning && !showApprove ? (
						<Button.Tooltip
							content="Send"
							shortcut="Enter"
							side="top"
						>
							<Button.Icon
								label="Send"
								kind="primary"
								type="submit"
								disabled={!canSend}
								onPointerDown={keepCaret}
							>
								<Icon.ArrowUp />
							</Button.Icon>
						</Button.Tooltip>
					) : null}
					{showApprove ? (
						<>
							<Button
								size="sm"
								onPointerDown={keepCaret}
								onClick={discard}
							>
								Discard
							</Button>
							<Button
								kind="secondary"
								size="sm"
								onPointerDown={keepCaret}
								onClick={accept}
							>
								Accept
							</Button>
						</>
					) : null}
				</div>
			</div>
		</form>
	);
}

function describeStatus(isRunning: boolean, pendingCount: number): string {
	if (isRunning) {
		return "Writing";
	}
	if (pendingCount === 1) {
		return "1 proposed change";
	}
	if (pendingCount > 1) {
		return `${pendingCount} proposed changes`;
	}
	return "";
}
