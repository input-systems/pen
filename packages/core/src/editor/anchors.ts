import type {
	Anchor,
	AnchorRange,
	AnchorTarget,
	Assoc,
	CRDTAdapter,
	CRDTDocument,
	DiagnosticEvent,
	EditorAnchors,
	ResolvedAnchorRange,
} from "@input/pen-types";

const ANCHOR_TARGET_MISSING_CODE = "anchor-target-missing";
const ANCHOR_DECODE_CODE = "anchor-decode";
const ANCHOR_BUDGET_CODE = "anchor-budget";

const ANCHOR_BUDGET = 4096;
const MAX_POSITION_BYTES = 256;
const MAX_BASE64_CHARS = 344;
const WIRE_VERSION = 1;
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

export interface EditorAnchorsHost {
	adapter: CRDTAdapter;
	emit(event: DiagnosticEvent): void;
	commitId(): number;
}

interface CachedResolve {
	commitId: number;
	target: AnchorTarget | null;
}

interface ObservedTarget {
	commitId: number;
	target: AnchorTarget | null;
}

/**
 * The two most recent observations of an anchor, from distinct commits.
 * `previous` is kept so a resolve made after a commit landed does not erase
 * the pre-commit target that AN14 repair has to read.
 */
interface TargetHistory {
	latest: ObservedTarget;
	previous: ObservedTarget | null;
}

interface WirePayload {
	v: unknown;
	b: unknown;
	a: unknown;
	c?: unknown;
	p: unknown;
}

function clampAssoc(assoc: Assoc | undefined): Assoc {
	return assoc === -1 ? -1 : 1;
}

function copyBytes(bytes: Uint8Array): Uint8Array {
	return new Uint8Array(bytes);
}

function freezeCell(
	cell: { readonly row: number; readonly col: number } | undefined,
): { readonly row: number; readonly col: number } | undefined {
	return cell ? Object.freeze({ row: cell.row, col: cell.col }) : undefined;
}

function freezeAnchor(anchor: Anchor): Anchor {
	const frozen: Anchor = {
		kind: "anchor",
		blockId: anchor.blockId,
		assoc: anchor.assoc,
		position: copyBytes(anchor.position),
		provenance: anchor.provenance,
		...(anchor.cell ? { cell: freezeCell(anchor.cell) } : {}),
	};
	if (frozen.cell) {
		Object.freeze(frozen.cell);
	}
	return Object.freeze(frozen);
}

function freezeRange(range: AnchorRange): AnchorRange {
	return Object.freeze({
		kind: "anchor-range" as const,
		from: range.from,
		to: range.to,
	});
}

function encodeBase64(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

function decodeBase64(input: string): Uint8Array | null {
	if (!BASE64_RE.test(input) || input.length > MAX_BASE64_CHARS) {
		return null;
	}
	try {
		const binary = atob(input);
		const out = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) {
			out[i] = binary.charCodeAt(i);
		}
		return out;
	} catch {
		return null;
	}
}

function targetsEqual(left: AnchorTarget, right: AnchorTarget): boolean {
	return (
		left.blockId === right.blockId &&
		left.offset === right.offset &&
		left.cell?.row === right.cell?.row &&
		left.cell?.col === right.cell?.col
	);
}

function mintingSite(): string | undefined {
	const stack = new Error().stack;
	if (!stack) {
		return undefined;
	}
	for (const line of stack.split("\n").slice(1)) {
		if (line.includes("anchors.ts") || line.includes("EditorAnchorsImpl")) {
			continue;
		}
		const trimmed = line.trim();
		if (trimmed.length > 0) {
			return trimmed;
		}
	}
	return undefined;
}

export class EditorAnchorsImpl implements EditorAnchors {
	private _doc: CRDTDocument;
	private readonly _host: EditorAnchorsHost;
	private readonly _cache = new WeakMap<Anchor, CachedResolve>();
	private readonly _observed = new WeakMap<Anchor, TargetHistory>();
	private _liveCount = 0;
	private _budgetWarned = false;

	constructor(doc: CRDTDocument, host: EditorAnchorsHost) {
		this._doc = doc;
		this._host = host;
	}

	get liveCount(): number {
		return this._liveCount;
	}

	updateDocument(doc: CRDTDocument): void {
		this._doc = doc;
	}

	/**
	 * The anchor's target as last observed before the current commit (AN14).
	 *
	 * A mint or resolve made at the current `commitId` already sees the
	 * post-commit document, so it is skipped in favor of the observation it
	 * replaced. A `null` observation is kept: an anchor that last resolved to
	 * nothing has no pre-commit target to repair from.
	 */
	peekPreCommitTarget(anchor: Anchor): AnchorTarget | null {
		const history = this._observed.get(anchor);
		if (!history) {
			return null;
		}
		if (history.latest.commitId < this._host.commitId()) {
			return history.latest.target;
		}
		return history.previous?.target ?? null;
	}

	private _observe(anchor: Anchor, target: AnchorTarget | null): void {
		const commitId = this._host.commitId();
		const observation: ObservedTarget = { commitId, target };
		const history = this._observed.get(anchor);
		if (history && history.latest.commitId === commitId) {
			history.latest = observation;
			return;
		}
		this._observed.set(anchor, {
			latest: observation,
			previous: history?.latest ?? null,
		});
	}

	remint(
		target: AnchorTarget,
		assoc: Assoc,
		provenance: Anchor["provenance"],
	): Anchor | null {
		const adapter = this._host.adapter;
		if (typeof adapter.createRelativePosition !== "function") {
			return null;
		}
		const encoded = adapter.createRelativePosition(
			this._doc,
			target,
			assoc,
		);
		if (!encoded) {
			return null;
		}
		const anchor = freezeAnchor({
			kind: "anchor",
			blockId: target.blockId,
			assoc,
			position: encoded,
			provenance,
			...(target.cell ? { cell: target.cell } : {}),
		});
		this._observe(anchor, {
			blockId: target.blockId,
			offset: target.offset,
			...(target.cell ? { cell: target.cell } : {}),
		});
		this._noteMint();
		return anchor;
	}

	create(target: AnchorTarget, assoc: Assoc = 1): Anchor | null {
		const next = this.remint(target, clampAssoc(assoc), "local");
		if (!next) {
			this._host.emit({
				code: ANCHOR_TARGET_MISSING_CODE,
				level: "warn",
				source: "core",
				message: `anchor target "${target.blockId}" does not exist`,
				remediation:
					"Mint against a block or cell that is in the document.",
				blockId: target.blockId,
			});
			return null;
		}
		return next;
	}

	range(range: {
		anchor: AnchorTarget;
		focus: AnchorTarget;
	}): AnchorRange | null {
		const from = this.create(range.anchor, -1);
		const to = this.create(range.focus, 1);
		if (!from || !to) {
			return null;
		}
		return freezeRange({ kind: "anchor-range", from, to });
	}

	resolve(anchor: Anchor): AnchorTarget | null {
		const commitId = this._host.commitId();
		const cached = this._cache.get(anchor);
		if (cached && cached.commitId === commitId) {
			return cached.target;
		}
		const adapter = this._host.adapter;
		if (typeof adapter.resolveRelativePosition !== "function") {
			this._cache.set(anchor, { commitId, target: null });
			this._observe(anchor, null);
			return null;
		}
		const target = adapter.resolveRelativePosition(
			this._doc,
			anchor.position,
			{
				followUndoneDeletions: anchor.provenance === "local",
			},
		);
		this._cache.set(anchor, { commitId, target });
		this._observe(anchor, target);
		return target;
	}

	resolveRange(range: AnchorRange): ResolvedAnchorRange | null {
		const from = this.resolve(range.from);
		const to = this.resolve(range.to);
		if (!from || !to) {
			return null;
		}
		return {
			from,
			to,
			collapsed: targetsEqual(from, to),
		};
	}

	serialize(anchor: Anchor): string {
		const payload: Record<string, unknown> = {
			v: WIRE_VERSION,
			b: anchor.blockId,
			a: anchor.assoc,
			p: encodeBase64(anchor.position),
		};
		if (anchor.cell) {
			payload.c = [anchor.cell.row, anchor.cell.col];
		}
		return JSON.stringify(payload);
	}

	deserialize(input: string): Anchor | null {
		try {
			const parsed = JSON.parse(input) as WirePayload;
			if (parsed.v !== WIRE_VERSION) {
				return this._rejectDecode("unknown or missing wire version");
			}
			if (typeof parsed.b !== "string" || parsed.b.length === 0) {
				return this._rejectDecode("missing block id");
			}
			if (parsed.a !== -1 && parsed.a !== 1) {
				return this._rejectDecode("assoc must be -1 or 1");
			}
			if (typeof parsed.p !== "string") {
				return this._rejectDecode("missing encoded position");
			}
			if (parsed.p.length > MAX_BASE64_CHARS) {
				return this._rejectDecode(
					"encoded position exceeds the 256-byte cap",
				);
			}
			const position = decodeBase64(parsed.p);
			if (!position || position.byteLength === 0) {
				return this._rejectDecode("malformed base64 position");
			}
			if (position.byteLength > MAX_POSITION_BYTES) {
				return this._rejectDecode(
					"encoded position exceeds the 256-byte cap",
				);
			}
			let cell: Anchor["cell"];
			if (parsed.c !== undefined) {
				if (
					!Array.isArray(parsed.c) ||
					parsed.c.length !== 2 ||
					typeof parsed.c[0] !== "number" ||
					typeof parsed.c[1] !== "number"
				) {
					return this._rejectDecode("cell must be [row, col]");
				}
				cell = { row: parsed.c[0], col: parsed.c[1] };
			}
			const anchor = freezeAnchor({
				kind: "anchor",
				blockId: parsed.b,
				assoc: parsed.a,
				position,
				provenance: "wire",
				...(cell ? { cell } : {}),
			});
			this._noteMint();
			return anchor;
		} catch {
			return this._rejectDecode("malformed JSON");
		}
	}

	private _noteMint(): void {
		this._liveCount += 1;
		if (this._liveCount > ANCHOR_BUDGET && !this._budgetWarned) {
			this._budgetWarned = true;
			this._host.emit({
				code: ANCHOR_BUDGET_CODE,
				level: "warn",
				source: "core",
				message: `more than ${ANCHOR_BUDGET} live anchors on this editor`,
				remediation:
					"Keep the live set O(features). Derived highlights must not mint per match.",
				liveCount: this._liveCount,
				site: mintingSite(),
			});
		}
	}

	private _rejectDecode(reason: string): null {
		this._host.emit({
			code: ANCHOR_DECODE_CODE,
			level: "warn",
			source: "core",
			message: `anchor deserialize failed: ${reason}`,
			remediation: "Treat the payload as hostile and drop it.",
		});
		return null;
	}
}

export function peekPreCommitTarget(
	anchors: EditorAnchors,
	anchor: Anchor,
): AnchorTarget | null {
	if (anchors instanceof EditorAnchorsImpl) {
		return anchors.peekPreCommitTarget(anchor);
	}
	return null;
}

export function remintAnchor(
	anchors: EditorAnchors,
	target: AnchorTarget,
	assoc: Assoc,
	provenance: Anchor["provenance"],
): Anchor | null {
	if (anchors instanceof EditorAnchorsImpl) {
		return anchors.remint(target, assoc, provenance);
	}
	return anchors.create(target, assoc);
}
