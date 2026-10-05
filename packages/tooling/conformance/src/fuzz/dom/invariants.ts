import {
	standingAuthorityHolds,
	unexpectedStandingDiagnostics,
} from "../../standingFilter.js";
import type { FuzzCheckReport } from "../../types";

/**
 * The DOM fuzzer's per-step verdict (W3.R19 §3.15). The page collects
 * (`window.__penConformance.fuzzCheck()`, `harness/src/fuzzCheck.ts`); this
 * decides, so the rules stay readable without a browser.
 */
export type FuzzCheckName =
	"action" | "page-error" | "S2" | "S5" | "S6" | "diagnostics" | "document";

export type FuzzVerdict = { check: FuzzCheckName; details: unknown } | null;

const NO_EXPECTED_DIAGNOSTICS: ReadonlySet<string> = new Set();

function checkS6(
	report: FuzzCheckReport,
	previous: FuzzCheckReport | null,
): FuzzVerdict {
	const before = previous?.record;
	const after = report.record;
	if (!before) {
		return null;
	}
	if (
		!after ||
		after.version < before.version ||
		after.commitId < before.commitId
	) {
		return { check: "S6", details: { before, after } };
	}
	return null;
}

function checkDocuments(report: FuzzCheckReport): FuzzVerdict {
	const { localErrors, remoteErrors, stateVectorsEqual } = report.documents;
	if (
		localErrors.length > 0 ||
		remoteErrors.length > 0 ||
		!stateVectorsEqual
	) {
		return { check: "document", details: report.documents };
	}
	return null;
}

/** First failing invariant, in the order a reader would want it named. */
export function evaluateFuzzReport(
	report: FuzzCheckReport,
	previous: FuzzCheckReport | null,
): FuzzVerdict {
	if (!standingAuthorityHolds(report.s2)) {
		return { check: "S2", details: report.s2 };
	}
	if (!report.s5.ok) {
		return { check: "S5", details: report.s5 };
	}
	const s6 = checkS6(report, previous);
	if (s6) {
		return s6;
	}
	const unexpected = unexpectedStandingDiagnostics(
		report.diagnostics,
		NO_EXPECTED_DIAGNOSTICS,
	);
	if (unexpected.length > 0) {
		return { check: "diagnostics", details: unexpected };
	}
	return checkDocuments(report);
}
