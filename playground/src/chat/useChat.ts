import { useState } from "react";
import type { GenerationState } from "@input/pen-ai";
import { useAI, useAIActions } from "@input/pen-react";
import { generateId, type Editor } from "@input/pen-types";
import { describeTurnOutcome } from "./turnOutcome";

export interface ChatTurn {
	id: string;
	prompt: string;
	/** What the agent did, once the turn is finished. */
	outcome: string | null;
	/** The lane Pen routed the prompt to, for the curious. */
	route: string | null;
	isFailed: boolean;
}

export interface Chat {
	turns: ChatTurn[];
	/** What the agent is doing right now, or `null` when idle. */
	activity: string | null;
	isBusy: boolean;
	send: (prompt: string) => void;
	stop: () => void;
	reset: () => void;
}

const ACTIVITY_LABELS: Record<string, string> = {
	reading: "Reading the document",
	thinking: "Thinking",
	writing: "Writing",
	"tool-calling": "Editing the document",
};

/**
 * The agent transcript.
 *
 * Worth knowing before reading this: Pen's agent is not a chatbot that
 * happens to sit next to a document. A prompt goes in, Pen decides how to
 * handle it, and the answer arrives *as document content* — either streamed
 * into a block or applied through document tools. Nothing comes back for the
 * sidebar to print.
 *
 * So each turn here is a prompt plus a receipt of what changed. Watch the
 * document and the inspector for the actual answer.
 */
export function useChat(editor: Editor): Chat {
	const [turns, setTurns] = useState<ChatTurn[]>([]);
	const aiState = useAI(editor);
	const aiActions = useAIActions(editor);

	const isBusy = aiState.status !== "idle";

	const finishTurn = (
		turnId: string,
		update: Omit<ChatTurn, "id" | "prompt">,
	) => {
		setTurns((current) =>
			current.map((turn) =>
				turn.id === turnId ? { ...turn, ...update } : turn,
			),
		);
	};

	const send = (prompt: string) => {
		const trimmedPrompt = prompt.trim();
		if (trimmedPrompt.length === 0 || isBusy) {
			return;
		}

		const turnId = generateId();
		setTurns((current) => [
			...current,
			{
				id: turnId,
				prompt: trimmedPrompt,
				outcome: null,
				route: null,
				isFailed: false,
			},
		]);

		// `target: "document"` lets the agent work anywhere in the document.
		// Pass "selection" to scope it to what the user highlighted instead.
		void aiActions
			.runPrompt(trimmedPrompt, { target: "document" })
			.then((result) => {
				const generation = result as GenerationState | null;
				finishTurn(turnId, {
					outcome: describeTurnOutcome(generation),
					route: generation?.route ?? null,
					isFailed: generation?.status === "error",
				});
			})
			.catch((error: unknown) => {
				finishTurn(turnId, {
					outcome:
						error instanceof Error ? error.message : String(error),
					route: null,
					isFailed: true,
				});
			});
	};

	const stop = () => {
		const sessionId = aiState.activeSessionId;
		if (sessionId) {
			aiActions.cancelSession(sessionId);
		}
	};

	const reset = () => {
		stop();
		setTurns([]);
	};

	return {
		turns,
		activity: isBusy
			? (ACTIVITY_LABELS[aiState.status] ?? "Working")
			: null,
		isBusy,
		send,
		stop,
		reset,
	};
}
