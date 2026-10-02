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

export const DIAGNOSTICS_ALLOWLIST: readonly DiagnosticsAllowlistEntry[] = [
	{
		code: "selection-projection-mismatch",
		reason:
			"W3.R1 read-back (W3 step 1) reports a projection written while an IME composition is open (F39 C2): the composing field keeps its own range. Closed by W3 step 6 (W3.R6), which withholds projection while composing; W3.G3 cannot close while this entry exists.",
	},
];
