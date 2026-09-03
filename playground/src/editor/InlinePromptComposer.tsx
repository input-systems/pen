import {
	useEffect,
	type FormEvent,
	type KeyboardEvent,
	type PointerEvent,
} from "react";
import {
	useAIContext,
	useAISessionActions,
	useContextualPromptSession,
} from "@input/pen-react";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";

/**
 * Input's inline intelligence chrome: history of what you asked, the textarea,
 * then an action row. The send arrow stays put like the agent composer — this
 * playground has no quick-action chips to fill an empty row. While a review is
 * pending and the box is empty, that row is Discard / Accept instead.
 */
export function InlinePromptComposer({ placeholder }: { placeholder: string }) {
	const { editor, state, controller } = useAIContext();
	const session = useContextualPromptSession(editor);
	const actions = useAISessionActions(editor);

	const isRunning =
		state.activeGeneration?.sessionId != null &&
		state.activeGeneration.sessionId === session?.id &&
		state.activeGeneration.status === "streaming";
	const draftPrompt = session?.contextualPrompt?.composer.draftPrompt ?? "";
	const openReason = session?.contextualPrompt?.composer.openReason;
	const sessionTurns = session?.turns ?? [];
	const pendingCount = session?.pendingSuggestionIds.length ?? 0;
	const isPromptEmpty = draftPrompt.trim().length === 0;
	const isReviewing = pendingCount > 0 && !isRunning;
	const showApprove = isReviewing && isPromptEmpty;
	const canSend = !isPromptEmpty && !isRunning;
	const sessionId = session?.id;

	// undo restores the turn prompt into the draft; Input clears it so the
	// row is Discard / Accept again and the ask stays in history.
	useEffect(() => {
		if (sessionId == null || openReason !== "history") {
			return;
		}
		controller?.updateContextualPromptDraft(sessionId, "");
	}, [controller, openReason, sessionId]);

	if (!session || sessionId == null) {
		return null;
	}

	function submit() {
		const nextPrompt = draftPrompt.trim();
		if (!nextPrompt || isRunning) {
			return;
		}
		void actions.runSessionPrompt(sessionId, nextPrompt, {
			target: "selection",
		});
	}

	function accept() {
		if (!actions.acceptSession(sessionId)) {
			return;
		}
		editor.undoManager.stopCapturing();
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

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (showApprove) {
			accept();
			return;
		}
		submit();
	}

	function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
		if (
			event.key === "Enter" &&
			!event.shiftKey &&
			event.target instanceof HTMLTextAreaElement
		) {
			event.preventDefault();
			event.stopPropagation();
			if (showApprove) {
				accept();
				return;
			}
			submit();
			return;
		}
		if (event.key !== "Escape") {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		dismiss();
	}

	function handleActionPointerDown(event: PointerEvent) {
		event.preventDefault();
	}

	const historyItems = sessionTurns.map((turn) => (
		<div key={turn.id} data-pen-ai-inline-session-prompt="">
			{turn.prompt}
		</div>
	));

	const statusLabel = statusCopy(isRunning, pendingCount);

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
				<div data-pen-ai-inline-session-status="">{statusLabel}</div>
				<div data-pen-ai-inline-session-actions="">
					{isRunning ? (
						<Button.Tooltip content="Stop" side="top">
							<Button.Icon
								label="Stop"
								kind="faded"
								onPointerDown={handleActionPointerDown}
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
								onPointerDown={handleActionPointerDown}
							>
								<Icon.ArrowUp />
							</Button.Icon>
						</Button.Tooltip>
					) : null}
					{showApprove ? (
						<>
							<Button
								size="sm"
								onPointerDown={handleActionPointerDown}
								onClick={discard}
							>
								Discard
							</Button>
							<Button
								kind="secondary"
								size="sm"
								onPointerDown={handleActionPointerDown}
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

function statusCopy(isRunning: boolean, pendingCount: number): string {
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
