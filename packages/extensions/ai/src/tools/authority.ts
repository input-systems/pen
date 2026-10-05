import type {
	ToolAuthorityContext,
	ToolDefinition,
	ToolDestructiveResolver,
} from "@input/pen-types";
import {
	AI_DESTRUCTIVE_TOOL_NAME_SET,
	AI_READ_ONLY_TOOL_NAME_SET,
	AI_TOOL_MAX_CALLS_PER_TURN,
	AI_TOOL_MAX_OPS_PER_CALL,
	AI_TOOL_MAX_TOTAL_OPS_PER_TURN,
	AI_TOOL_UNCONFIRMED_CODE,
} from "./constants";

export type AIToolConfirmationDecision = "allow" | "refuse" | "defer";

export type AIToolAuthorityReason =
	| "tool-not-allowed"
	| "tool-refused"
	| "tool-confirmation-deferred"
	| "budget-calls-exhausted"
	| "budget-ops-per-call-exhausted"
	| "budget-total-ops-exhausted";

export type AIToolCallStatus = "executed" | "blocked" | "turn-ended";

export interface AIToolConfirmationRequest {
	readonly toolName: string;
	readonly input: unknown;
	readonly destructive: boolean;
}

export type AIToolConfirmFn = (
	request: AIToolConfirmationRequest,
) => AIToolConfirmationDecision | Promise<AIToolConfirmationDecision>;

/**
 * What happens to a call classified destructive when no confirmation resolver
 * is installed (AIB3): `"allow"` runs it with `ai-tool-unconfirmed`,
 * `"refuse"` blocks it with the document unchanged.
 */
export type AIUnconfirmedDestructivePolicy = "allow" | "refuse";

export interface AIToolGrant {
	readonly allowedMutatingTools: readonly string[];
	readonly confirm?: AIToolConfirmFn;
	/** Absent resolver: `"allow"` runs with `ai-tool-unconfirmed`; `"refuse"` blocks. Default `"allow"`. */
	readonly unconfirmedDestructive?: AIUnconfirmedDestructivePolicy;
}

export interface AIToolBudgetLimits {
	readonly maxCallsPerTurn: number;
	readonly maxOpsPerCall: number;
	readonly maxTotalOpsPerTurn: number;
}

export interface AIToolTurnOptions {
	readonly allowedMutatingTools?: readonly string[];
	readonly confirm?: AIToolConfirmFn;
	readonly unconfirmedDestructive?: AIUnconfirmedDestructivePolicy;
	readonly budget?: Partial<AIToolBudgetLimits>;
	readonly groupId?: string;
}

export interface AIToolAuthorization {
	readonly allowed: boolean;
	readonly mutating: boolean;
	readonly destructive: boolean;
	readonly reason?: Extract<
		AIToolAuthorityReason,
		"tool-not-allowed" | "tool-refused" | "tool-confirmation-deferred"
	>;
	readonly diagnostic?: { code: string; message: string };
}

export interface AIToolCallDenied {
	readonly ok: false;
	readonly status: "blocked" | "turn-ended";
	readonly reason: AIToolAuthorityReason;
}

export interface AIToolTurn {
	readonly grant: AIToolGrant;
	readonly limits: AIToolBudgetLimits;
	readonly groupId: string | null;
	readonly calls: number;
	readonly ops: number;
	readonly ended: boolean;
	readonly reason: AIToolAuthorityReason | null;
	readonly lastStatus: AIToolCallStatus | null;
	tryRecordCall(): boolean;
	/**
	 * Records an op batch atomically. Returns `null` when the whole batch fits;
	 * otherwise records nothing and returns the exhausted-budget reason.
	 * Exceeding the turn total also ends the turn; exceeding only the per-call
	 * limit fails the call but leaves the turn open.
	 */
	tryRecordOps(count: number): AIToolAuthorityReason | null;
	closeCall(): void;
	markStatus(status: AIToolCallStatus, reason?: AIToolAuthorityReason): void;
}

/**
 * The classification `authorizeAIToolCall` uses when its caller states no
 * context: a call that cannot say whether it stages is read as landing, the
 * conservative direction.
 */
const UNSTAGED_AUTHORITY_CONTEXT: ToolAuthorityContext = { staged: false };

export function isMutatingAITool(
	name: string,
	definition?: ToolDefinition | null,
): boolean {
	const explicit = readOptionalBoolean(definition, "mutating");
	if (explicit !== undefined) {
		return explicit;
	}
	return !AI_READ_ONLY_TOOL_NAME_SET.has(name);
}

/**
 * AIB3. With `context`, classifies this call: a `destructive` resolver is
 * evaluated on `input`. Without it, answers "can a call to this tool be
 * destructive", which is `true` for a resolver.
 */
export function isDestructiveAITool(
	name: string,
	definition?: ToolDefinition | null,
	input?: unknown,
	context?: ToolAuthorityContext,
): boolean {
	const declared = readDestructiveDeclaration(definition);
	if (typeof declared === "function") {
		return context == null
			? true
			: evaluateDestructiveResolver(declared, input, context);
	}
	if (declared !== undefined) {
		return declared;
	}
	return AI_DESTRUCTIVE_TOOL_NAME_SET.has(name);
}

/**
 * Authorizes one call (AIB3). `context` defaults to `{ staged: false }`, the
 * conservative classification. A resolver is evaluated once, on the
 * complete input.
 */
export async function authorizeAIToolCall(
	name: string,
	input: unknown,
	definition: ToolDefinition | null,
	grant: AIToolGrant,
	context: ToolAuthorityContext = UNSTAGED_AUTHORITY_CONTEXT,
): Promise<AIToolAuthorization> {
	const mutating = isMutatingAITool(name, definition);
	const destructive = isDestructiveAITool(name, definition, input, context);
	if (mutating && !grant.allowedMutatingTools.includes(name)) {
		return {
			allowed: false,
			mutating,
			destructive,
			reason: "tool-not-allowed",
		};
	}
	if (!destructive) {
		return { allowed: true, mutating, destructive };
	}
	if (!grant.confirm) {
		return authorizeUnconfirmed(name, mutating, grant);
	}

	const decision = await grant.confirm({
		toolName: name,
		input,
		destructive,
	});
	switch (decision) {
		case "allow":
			return { allowed: true, mutating, destructive };
		case "refuse":
			return {
				allowed: false,
				mutating,
				destructive,
				reason: "tool-refused",
			};
		case "defer":
			return {
				allowed: false,
				mutating,
				destructive,
				reason: "tool-confirmation-deferred",
			};
		default: {
			const _exhaustive: never = decision;
			return _exhaustive;
		}
	}
}

/** A destructive call with no confirmation resolver: the grant's policy decides. */
function authorizeUnconfirmed(
	name: string,
	mutating: boolean,
	grant: AIToolGrant,
): AIToolAuthorization {
	const policy = grant.unconfirmedDestructive ?? "allow";
	switch (policy) {
		case "allow":
			return {
				allowed: true,
				mutating,
				destructive: true,
				diagnostic: {
					code: AI_TOOL_UNCONFIRMED_CODE,
					message: `Destructive tool "${name}" ran without a confirmation resolver.`,
				},
			};
		case "refuse":
			return {
				allowed: false,
				mutating,
				destructive: true,
				reason: "tool-refused",
				diagnostic: {
					code: AI_TOOL_UNCONFIRMED_CODE,
					message: `Destructive tool "${name}" was refused: no confirmation resolver and unconfirmedDestructive is "refuse".`,
				},
			};
		default: {
			const _exhaustive: never = policy;
			return _exhaustive;
		}
	}
}

/**
 * Runs a `destructive` resolver. One that throws or answers with anything but
 * a boolean classifies the call as destructive: a classifier that cannot
 * answer must not wave a call past the confirmation seam.
 */
function evaluateDestructiveResolver(
	resolver: ToolDestructiveResolver,
	input: unknown,
	context: ToolAuthorityContext,
): boolean {
	try {
		const classified: unknown = resolver(input, context);
		return typeof classified === "boolean" ? classified : true;
	} catch {
		return true;
	}
}

export function createAIToolTurn(options: AIToolTurnOptions = {}): AIToolTurn {
	return new AIToolTurnState(options);
}

/**
 * Thrown when a tool call's op batch exceeds an op budget. The whole batch is
 * rejected — nothing was applied — and the message tells the model how to
 * proceed.
 */
export class AIToolBudgetError extends Error {
	readonly reason: Extract<
		AIToolAuthorityReason,
		"budget-ops-per-call-exhausted" | "budget-total-ops-exhausted"
	>;

	constructor(
		reason: AIToolBudgetError["reason"],
		opCount: number,
		limits: AIToolBudgetLimits,
	) {
		super(
			reason === "budget-ops-per-call-exhausted"
				? `This batch of ${opCount} document operations is over the per-call limit of ${limits.maxOpsPerCall}. None of it was applied. Split the change into smaller tool calls.`
				: `This batch of ${opCount} document operations exceeds the remaining op budget for this turn (max ${limits.maxTotalOpsPerTurn} total). None of it was applied and the turn has ended.`,
		);
		this.name = "AIToolBudgetError";
		this.reason = reason;
	}
}

export function isAIToolCallDenied(value: unknown): value is AIToolCallDenied {
	if (value == null || typeof value !== "object") {
		return false;
	}
	const candidate = value as Partial<AIToolCallDenied>;
	return (
		candidate.ok === false &&
		(candidate.status === "blocked" || candidate.status === "turn-ended") &&
		typeof candidate.reason === "string"
	);
}

/**
 * A returned tool result that asks the model to retry. Handlers signal that
 * with the generic `{ ok: false }` convention (authority denials, semantic
 * refusals). Handler-specific fields stay out of this predicate so the loop
 * cannot learn one tool's payload shape.
 */
export function isAIToolResultAskingRetry(value: unknown): boolean {
	if (value == null || typeof value !== "object") {
		return false;
	}
	return (value as { ok?: unknown }).ok === false;
}

export function denyAIToolCall(
	status: "blocked" | "turn-ended",
	reason: AIToolAuthorityReason,
): AIToolCallDenied {
	return { ok: false, status, reason };
}

class AIToolTurnState implements AIToolTurn {
	readonly grant: AIToolGrant;
	readonly limits: AIToolBudgetLimits;
	readonly groupId: string | null;
	private _calls = 0;
	private _ops = 0;
	private _opsThisCall = 0;
	private _ended = false;
	private _reason: AIToolAuthorityReason | null = null;
	private _lastStatus: AIToolCallStatus | null = null;

	constructor(options: AIToolTurnOptions) {
		this.grant = {
			allowedMutatingTools: options.allowedMutatingTools ?? [],
			confirm: options.confirm,
			unconfirmedDestructive: options.unconfirmedDestructive,
		};
		this.limits = {
			maxCallsPerTurn:
				options.budget?.maxCallsPerTurn ?? AI_TOOL_MAX_CALLS_PER_TURN,
			maxOpsPerCall:
				options.budget?.maxOpsPerCall ?? AI_TOOL_MAX_OPS_PER_CALL,
			maxTotalOpsPerTurn:
				options.budget?.maxTotalOpsPerTurn ??
				AI_TOOL_MAX_TOTAL_OPS_PER_TURN,
		};
		this.groupId = options.groupId ?? null;
	}

	get calls(): number {
		return this._calls;
	}

	get ops(): number {
		return this._ops;
	}

	get ended(): boolean {
		return this._ended;
	}

	get reason(): AIToolAuthorityReason | null {
		return this._reason;
	}

	get lastStatus(): AIToolCallStatus | null {
		return this._lastStatus;
	}

	tryRecordCall(): boolean {
		this._opsThisCall = 0;
		if (this._ended) {
			return false;
		}
		if (this._calls >= this.limits.maxCallsPerTurn) {
			this.end("budget-calls-exhausted");
			return false;
		}
		this._calls += 1;
		return true;
	}

	tryRecordOps(count: number): AIToolAuthorityReason | null {
		if (count <= 0) {
			return null;
		}
		const turnRoom = this.limits.maxTotalOpsPerTurn - this._ops;
		if (count > turnRoom) {
			this.end("budget-total-ops-exhausted");
			return "budget-total-ops-exhausted";
		}
		const callRoom = this.limits.maxOpsPerCall - this._opsThisCall;
		if (count > callRoom) {
			return "budget-ops-per-call-exhausted";
		}
		this._opsThisCall += count;
		this._ops += count;
		return null;
	}

	closeCall(): void {
		if (this._ended) {
			return;
		}
		if (this._calls >= this.limits.maxCallsPerTurn) {
			this.end("budget-calls-exhausted");
		}
	}

	markStatus(status: AIToolCallStatus, reason?: AIToolAuthorityReason): void {
		this._lastStatus = status;
		if (reason && this._ended && !this._reason) {
			this._reason = reason;
		}
		if (status === "turn-ended" && reason) {
			this.end(reason);
		}
	}

	private end(reason: AIToolAuthorityReason): void {
		this._ended = true;
		this._reason = reason;
	}
}

function readOptionalBoolean(
	definition: ToolDefinition | null | undefined,
	key: "mutating",
): boolean | undefined {
	if (definition == null || !(key in definition)) {
		return undefined;
	}
	const value: unknown = definition[key];
	return typeof value === "boolean" ? value : undefined;
}

/** `destructive` as declared: a fixed flag, a per-call resolver, or nothing. */
function readDestructiveDeclaration(
	definition: ToolDefinition | null | undefined,
): boolean | ToolDestructiveResolver | undefined {
	if (definition == null || !("destructive" in definition)) {
		return undefined;
	}
	const value: unknown = definition.destructive;
	if (typeof value === "boolean") {
		return value;
	}
	return typeof value === "function"
		? (value as ToolDestructiveResolver)
		: undefined;
}
