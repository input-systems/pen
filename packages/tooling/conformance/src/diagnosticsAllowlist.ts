/**
 * Standing-assertion allowlist for diagnostics-zero.
 *
 * Only the codes in `STANDING_DIAGNOSTIC_CODES` are gated after every step.
 * If a v1 baseline scenario still emits one of those, add it here with a
 * reason. The target state is an empty list.
 */
export const STANDING_DIAGNOSTIC_CODES = [
	"selection-projection-mismatch",
	"dom-divergence",
	"unhandled-input-type",
	"read-after-write",
	"normalize-cap",
	"apply-storm",
] as const;

export type StandingDiagnosticCode = (typeof STANDING_DIAGNOSTIC_CODES)[number];

export type DiagnosticsAllowlistEntry = {
	code: StandingDiagnosticCode;
	/** Why v1 still emits this code, and what has to change to remove it. */
	reason: string;
};

export const DIAGNOSTICS_ALLOWLIST: readonly DiagnosticsAllowlistEntry[] = [];
