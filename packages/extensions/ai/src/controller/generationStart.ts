import type {
	AIRequestedOperation,
	AISession,
	GenerationState,
} from "../types";
import type { AIControllerImpl } from "./aiController";
import {
	beginGenerationSession,
	createAIStreamEvent,
	type GenerationTarget,
} from "../helpers";

/** The session a request continues, or null when it names none. */
export function findRequestSession(
	controller: AIControllerImpl,
	sessionId: string | undefined,
): AISession | null {
	return sessionId != null
		? (controller._state.sessions.find((session) => session.id === sessionId) ??
				null)
		: null;
}

/**
 * Publishes a seeded generation: opens its session turn when the request
 * names a session, moves the controller to `thinking`, and resets the stream
 * events to `generation-start` and the thinking status.
 */
export function startSeededGeneration(
	controller: AIControllerImpl,
	input: {
		seedGeneration: GenerationState;
		sessionId: string | undefined;
		prompt: string;
		target: GenerationTarget;
		operation: AIRequestedOperation | null;
		sessionTurnId: string | undefined;
		existingSession: AISession | null;
	},
): void {
	const { seedGeneration, sessionId, prompt, target } = input;
	if (sessionId) {
		beginGenerationSession(controller, {
			sessionId,
			seedGeneration,
			prompt,
			target,
			operation: input.operation,
			sessionTurnId: input.sessionTurnId,
			existingSession: input.existingSession,
		});
	}
	controller._setState({
		status: "thinking",
		activeGeneration: seedGeneration,
		commandMenuOpen: false,
		lastRoute: seedGeneration.route,
		activeSessionId: sessionId ?? controller._state.activeSessionId,
	});
	controller._setStreamEvents([
		createAIStreamEvent(seedGeneration, {
			type: "generation-start",
			prompt,
			target: target.type,
		}),
		createAIStreamEvent(seedGeneration, {
			type: "status",
			status: "thinking",
		}),
	]);
}
