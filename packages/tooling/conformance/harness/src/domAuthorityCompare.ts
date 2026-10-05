import type { LogicalPoint, DomAuthorityCheck, SerializedSelection } from "../../src/types";

export function pointsEqual(left: LogicalPoint, right: LogicalPoint): boolean {
	return left.blockId === right.blockId && left.offset === right.offset;
}

/**
 * The extended S2 observations (W3.R2). When the harness supplies them, every
 * selection state is checked; without them the check is the v1 text-only one.
 */
const SINK_ROLES = new Set(["group", "grid"]);

export interface ExtendedS2Observations {
	/** The field is composing: its own range is exempt while the IME window is open. */
	readonly composing: boolean;
	/** A native range has an endpoint inside the editor root. */
	readonly nativeRangeInRoot: boolean;
	/** `role` of the focused element inside the root when it is a sink, else null. */
	readonly focusedSinkRole: string | null;
	/** Text only: the mapped DOM selection is equivalent to the authority (reader step 3). */
	readonly equivalent: boolean;
	/** D5: the field editor's substitute state (`getSubstituteState`), or null. */
	readonly substitute?: string | null;
	/** D5: what the overlay painted for the substitute, read only while one holds. */
	readonly substitutePaint?: SubstitutePaint | null;
}

/** D5: the overlay layer's endpoint carets (`data-endpoint`, sorted) and range items. */
export interface SubstitutePaint {
	readonly endpoints: readonly string[];
	readonly ranges: number;
	readonly blockSpans: number;
}

export function resolveDomAuthorityCheck(input: {
	hasRoot: boolean;
	hasFocus: boolean;
	authority: SerializedSelection;
	mapped: { anchor: LogicalPoint; focus: LogicalPoint } | null;
	extended?: ExtendedS2Observations;
}): DomAuthorityCheck {
	if (!input.hasRoot) {
		return { ok: false, reason: "editor root is not mounted" };
	}
	if (input.extended) {
		return resolveExtendedCheck(input, input.extended);
	}
	if (!input.hasFocus) {
		return {
			ok: false,
			skipped: true,
			reason: "editor is unfocused",
			authority: input.authority,
			dom: input.mapped,
		};
	}
	return compareMappedToAuthority(input.authority, input.mapped);
}

export function compareMappedToAuthority(
	authority: SerializedSelection,
	mapped: { anchor: LogicalPoint; focus: LogicalPoint } | null,
): DomAuthorityCheck {
	if (authority == null) {
		if (mapped == null) {
			return { ok: true, authority, dom: mapped };
		}
		return {
			ok: false,
			reason: "DOM has a selection while editor.selection is null",
			authority,
			dom: mapped,
		};
	}
	if (authority.type !== "text") {
		return {
			ok: false,
			skipped: true,
			reason: "authority is not a text selection",
			authority,
			dom: mapped,
		};
	}
	if (!mapped) {
		return {
			ok: false,
			reason: "DOM selection does not map to a logical text selection",
			authority,
			dom: mapped,
		};
	}
	if (
		pointsEqual(mapped.anchor, authority.anchor) &&
		pointsEqual(mapped.focus, authority.focus)
	) {
		return { ok: true, authority, dom: mapped };
	}
	return {
		ok: false,
		reason: "DOM selection does not match editor.selection (v1 authority)",
		authority,
		dom: mapped,
	};
}

export function misplacedOffset(offset: number, length: number): number {
	if (length <= 0) {
		return offset === 0 ? 1 : 0;
	}
	if (offset === 0) {
		return Math.min(1, length);
	}
	return 0;
}


type Mapped = { anchor: LogicalPoint; focus: LogicalPoint } | null;

function checked(authority: SerializedSelection, dom: Mapped, ok: boolean, reason?: string): DomAuthorityCheck {
	return { ok, ...(reason ? { reason } : {}), authority, dom };
}

/** W3.R2: S2 over every state, the composing field excepted. */
function resolveExtendedCheck(
	input: { hasFocus: boolean; authority: SerializedSelection; mapped: Mapped },
	extended: ExtendedS2Observations,
): DomAuthorityCheck {
	const { authority, mapped } = input;
	if (extended.composing) {
		return checked(authority, mapped, true, "composing field is exempt while the IME window is open");
	}
	switch (authority?.type ?? "null") {
		case "null":
		case "app":
			return checkNoNativeRange(authority, mapped, extended);
		case "block":
		case "cell":
			return checkSinkFocus(authority, mapped, extended);
		default:
			return checkTextEquivalence(input, extended);
	}
}

function checkNoNativeRange(authority: SerializedSelection, mapped: Mapped, extended: ExtendedS2Observations): DomAuthorityCheck {
	return extended.nativeRangeInRoot
		? checked(authority, mapped, false, "a native range is inside the root while the selection is null or app")
		: checked(authority, mapped, true);
}

function checkSinkFocus(authority: SerializedSelection, mapped: Mapped, extended: ExtendedS2Observations): DomAuthorityCheck {
	const kind = authority?.type ?? "null";
	if (extended.nativeRangeInRoot) {
		return checked(authority, mapped, false, `a native range is inside the root for a ${kind} selection`);
	}
	const onSink = extended.focusedSinkRole !== null && SINK_ROLES.has(extended.focusedSinkRole);
	return onSink
		? checked(authority, mapped, true)
		: checked(authority, mapped, false, `focus is not on the revealed sink (role group or grid) for a ${kind} selection`);
}

/**
 * D5 (S2 exceptions): a text range in a substitute state has no native range
 * in the root, focus on the sink revealed as a text range (`role="group"`),
 * and the overlay painting both endpoint carets plus the range items.
 */
function checkSubstitute(
	authority: SerializedSelection,
	mapped: Mapped,
	extended: ExtendedS2Observations,
): DomAuthorityCheck {
	const kind = extended.substitute ?? "substitute";
	if (extended.nativeRangeInRoot) {
		return checked(
			authority,
			mapped,
			false,
			`a native range is inside the root in the ${kind} substitute state`,
		);
	}
	if (extended.focusedSinkRole !== "group") {
		return checked(
			authority,
			mapped,
			false,
			`focus is not on the sink revealed as a text range in the ${kind} substitute state`,
		);
	}
	const paint = extended.substitutePaint;
	const endpoints = paint?.endpoints.join(",") ?? "";
	if (
		endpoints !== "anchor,focus" ||
		(paint?.ranges ?? 0) + (paint?.blockSpans ?? 0) === 0
	) {
		return checked(
			authority,
			mapped,
			false,
			`the overlay does not paint the ${kind} substitute (endpoints ${endpoints || "none"}, ranges ${paint?.ranges ?? 0}, block spans ${paint?.blockSpans ?? 0})`,
		);
	}
	return checked(authority, mapped, true, `${kind} substitute state`);
}

function checkTextEquivalence(
	input: { hasFocus: boolean; authority: SerializedSelection; mapped: Mapped },
	extended: ExtendedS2Observations,
): DomAuthorityCheck {
	const { authority, mapped } = input;
	if (!input.hasFocus) {
		return { ok: false, skipped: true, reason: "editor is unfocused", authority, dom: mapped };
	}
	if (extended.substitute) {
		return checkSubstitute(authority, mapped, extended);
	}
	return extended.equivalent
		? checked(authority, mapped, true)
		: checked(authority, mapped, false, "DOM selection is not equivalent to editor.selection");
}
