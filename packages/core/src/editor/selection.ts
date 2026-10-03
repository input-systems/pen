import type {
	Anchor,
	BlockHandle,
	CellSelection,
	ChangeSummary,
	CRDTDocument,
	CRDTMap,
	DiagnosticEvent,
	DocumentState,
	Editor,
	PenDocument,
	SchemaRegistry,
	SelectionOrigin,
	SelectionRecord,
	SelectionState,
} from "@input/pen-types";
import { usesInlineTextSelection } from "../schema/fieldEditorCapabilities";
import { createBlockHandle } from "../schema/handles";
import { getSelectionBlockRange, selectionToRange } from "../selection/helpers";
import { deriveContentMoves, repairAnchor } from "./anchorRepair";
import type { EditorAnchorsImpl } from "./anchors";
import { resolveCellSelectionMatrix } from "./cellSelection";
import { EventEmitter } from "./events";
import {
	mapSelectionState,
	mintTextAnchors,
	resolveHeldText,
} from "./selectionCommit";
import {
	clampNonTextPseudoOffset,
	clampOffsetToLength,
	selectionEquals,
	toRecordState,
	validateSelection,
} from "./selectionValidation";

type CRDTBlockMap = CRDTMap<CRDTMap<unknown>>;

const INVALID_BLOCK_CODE = "selection-invalid-block";
const RESERVED_ORIGIN_CODE = "selection-reserved-origin";

export interface SelectionAuthority {
	readonly record: SelectionRecord;
	set(
		state: SelectionState,
		options: { origin: SelectionOrigin },
	): SelectionRecord;
	onCommit(summary: ChangeSummary): void;
}

export class SelectionAuthorityImpl implements SelectionAuthority {
	private _state: SelectionState = null;
	private _version = 0;
	private _origin: SelectionOrigin = "programmatic";
	private _commitId = 0;
	private _doc: PenDocument;
	private _crdtDoc: CRDTDocument;
	private readonly _registry: SchemaRegistry;
	private readonly _emitter: EventEmitter;
	private readonly _anchors: EditorAnchorsImpl;
	private _editor: Editor | null = null;
	private _fromAnchor: Anchor | null = null;
	private _toAnchor: Anchor | null = null;

	constructor(
		doc: PenDocument,
		crdtDoc: CRDTDocument,
		registry: SchemaRegistry,
		emitter: EventEmitter,
		anchors: EditorAnchorsImpl,
	) {
		this._doc = doc;
		this._crdtDoc = crdtDoc;
		this._registry = registry;
		this._emitter = emitter;
		this._anchors = anchors;
	}

	bindEditor(editor: Editor): void {
		this._editor = editor;
	}

	get record(): SelectionRecord {
		return {
			state: toRecordState(this._state),
			version: this._version,
			origin: this._origin,
			commitId: this._commitId,
		};
	}

	getSelection(): SelectionState {
		return this._state;
	}

	set(
		state: SelectionState,
		options: { origin: SelectionOrigin },
	): SelectionRecord {
		if (options.origin === "gc") {
			this._emitDiagnostic({
				code: RESERVED_ORIGIN_CODE,
				level: "warn",
				source: "core",
				message:
					'origin "gc" is reserved for SelectionAuthority repair writes',
				remediation:
					'Pass a caller origin such as "programmatic", "keyboard", or "pointer".',
			});
			return this.record;
		}
		return this._accept(state, options.origin, this._commitId);
	}

	onCommit(summary: ChangeSummary): void {
		this._repairHeldAnchors(summary);
		const resolved = resolveHeldText(
			this._state,
			this._fromAnchor,
			this._toAnchor,
			this._anchors,
			this._doc,
		);
		if (resolved !== undefined && !selectionEquals(this._state, resolved)) {
			this._accept(resolved, "mapped", summary.commitId, { emit: false });
			return;
		}
		const mapped = mapSelectionState(this._state, summary, {
			blockExists: (blockId) => this._blockExists(blockId),
			logicalLength: (blockId) => this._logicalLength(blockId),
			tableGrid: (blockId) => this._tableGrid(blockId),
			doc: this._doc,
		});
		if (mapped === undefined) {
			return;
		}
		this._accept(mapped, "mapped", summary.commitId, { emit: false });
	}

	updateDocument(doc: PenDocument, crdtDoc: CRDTDocument): void {
		this._doc = doc;
		this._crdtDoc = crdtDoc;
		this._state = null;
		this._fromAnchor = null;
		this._toAnchor = null;
		this._version += 1;
		this._origin = "programmatic";
		this._emitter.emit("selectionChange", this.record);
	}

	getSelectedText(): string {
		const sel = this._state;
		if (!sel) {
			return "";
		}

		if (sel.type === "text") {
			const range = selectionToRange(this._doc, sel);
			const blockIds = getSelectionBlockRange(this._rangeSource(), sel);
			if (blockIds.length <= 1) {
				const full = this._logicalText(sel.anchor.blockId);
				const from = Math.min(sel.anchor.offset, sel.focus.offset);
				const to = Math.max(sel.anchor.offset, sel.focus.offset);
				return full.slice(from, to);
			}

			const parts = blockIds.map((blockId, index) => {
				const full = this._logicalText(blockId);
				if (blockIds.length === 1) {
					return full.slice(range.start.offset, range.end.offset);
				}
				if (index === 0) {
					return full.slice(range.start.offset);
				}
				if (index === blockIds.length - 1) {
					return full.slice(0, range.end.offset);
				}
				return full;
			});
			return parts.join("\n");
		}

		if (sel.type === "block") {
			const parts: string[] = [];
			for (const id of sel.blockIds) {
				if (!this._blockExists(id)) {
					continue;
				}
				parts.push(this._handle(id).textContent());
			}
			return parts.join("\n");
		}

		if (sel.type === "cell") {
			return this._getSelectedCellText(sel);
		}

		return "";
	}

	getSelectedBlocks(): BlockHandle[] {
		const sel = this._state;
		if (!sel) {
			return [];
		}

		if (sel.type === "block") {
			return sel.blockIds
				.filter((id) => this._blockExists(id))
				.map((id) => this._handle(id));
		}

		if (sel.type === "text") {
			return getSelectionBlockRange(this._rangeSource(), sel)
				.filter((id) => this._blockExists(id))
				.map((id) => this._handle(id));
		}

		return [];
	}

	private _accept(
		state: SelectionState,
		origin: SelectionOrigin,
		commitId: number,
		options?: { emit?: boolean },
	): SelectionRecord {
		const validated = validateSelection(state, {
			blockExists: (blockId) => this._blockExists(blockId),
			emitMissingBlock: (blockId) => this._emitMissingBlock(blockId),
			isNonTextBlock: (blockId) => this._isNonTextBlock(blockId),
			clampOffset: (blockId, offset) =>
				this._clampOffset(blockId, offset),
			tableGrid: (blockId) => this._tableGrid(blockId),
			doc: this._doc,
		});
		if (validated === undefined) {
			return this.record;
		}
		// D17: undo and redo map the selection in their own commit before the
		// history restore writes it, so the restore often equals the mapped
		// state. It still claims the record, or nothing scrolls it into view.
		if (
			selectionEquals(this._state, validated) &&
			!(origin === "restore" && this._origin !== "restore")
		) {
			return this.record;
		}
		this._state = validated;
		this._version += 1;
		this._origin = origin;
		this._commitId = commitId;
		const minted = mintTextAnchors(validated, this._anchors, (blockId) =>
			this._isNonTextBlock(blockId),
		);
		this._fromAnchor = minted.from;
		this._toAnchor = minted.to;
		if (options?.emit !== false) {
			this._emitter.emit("selectionChange", this.record);
		}
		return this.record;
	}

	private _repairHeldAnchors(summary: ChangeSummary): void {
		if (!this._editor || !this._fromAnchor || !this._toAnchor) {
			return;
		}
		const moves = deriveContentMoves(summary, undefined);
		if (moves.length === 0) {
			return;
		}
		this._fromAnchor = repairAnchor(this._editor, this._fromAnchor, moves);
		this._toAnchor = repairAnchor(this._editor, this._toAnchor, moves);
	}

	/** The bound editor's cached preorder, or the document before binding. */
	private _rangeSource(): DocumentState | PenDocument {
		return this._editor?.documentState ?? this._doc;
	}

	private _isNonTextBlock(blockId: string): boolean {
		const blockMap = (this._doc.blocks as CRDTBlockMap).get(blockId);
		const blockType = blockMap?.get("type");
		if (typeof blockType !== "string") {
			return false;
		}
		const schema = this._registry.resolve(blockType);
		return Boolean(schema && !usesInlineTextSelection(schema));
	}

	private _clampOffset(blockId: string, offset: number): number {
		if (!Number.isFinite(offset) || offset < 0) {
			return 0;
		}
		if (this._isNonTextBlock(blockId)) {
			return clampNonTextPseudoOffset(offset);
		}
		return clampOffsetToLength(offset, this._logicalLength(blockId));
	}

	private _logicalText(blockId: string): string {
		if (!this._blockExists(blockId)) {
			return "";
		}
		const stored = this._handle(blockId)
			.textDeltas()
			.map((delta) => delta.insert)
			.join("");
		return stored;
	}

	/** N1: each inline embed occupies one logical offset. */
	private _logicalLength(blockId: string): number {
		if (!this._blockExists(blockId)) {
			return 0;
		}
		let stored = "";
		let embeds = 0;
		for (const delta of this._handle(blockId).inlineDeltas()) {
			if (typeof delta.insert === "string") {
				stored += delta.insert;
			} else {
				embeds += 1;
			}
		}
		return stored.length + embeds;
	}

	private _tableGrid(blockId: string): { rows: number; cols: number } | null {
		const table = this._handle(blockId).as("table");
		const rows = table?.tableRowCount() ?? 0;
		const cols = table?.tableColumnCount() ?? 0;
		if (rows <= 0 || cols <= 0) {
			return null;
		}
		return { rows, cols };
	}

	private _blockExists(blockId: string): boolean {
		return (this._doc.blocks as CRDTBlockMap).has(blockId);
	}

	private _handle(blockId: string): BlockHandle {
		return createBlockHandle(
			blockId,
			this._doc,
			this._crdtDoc,
			this._registry,
		);
	}

	private _emitMissingBlock(blockId: string): void {
		this._emitDiagnostic({
			code: INVALID_BLOCK_CODE,
			level: "warn",
			source: "core",
			message: blockId
				? `selection references missing block "${blockId}"`
				: "selection references no blocks",
			remediation: "Pass block ids that exist in the current document.",
			blockId,
		});
	}

	private _emitDiagnostic(event: DiagnosticEvent): void {
		this._emitter.emit("diagnostic", event);
	}

	private _getSelectedCellText(sel: CellSelection): string {
		const block = this._handle(sel.blockId);
		const matrix = resolveCellSelectionMatrix(block, sel);
		const table = block.as("table");
		const rowParts: string[] = [];
		for (const rowCells of matrix) {
			const cellParts: string[] = [];
			for (const cellCoord of rowCells) {
				const cell = table?.tableCell(cellCoord.row, cellCoord.col);
				cellParts.push(cell?.textContent() ?? "");
			}
			rowParts.push(cellParts.join("\t"));
		}
		return rowParts.join("\n");
	}
}
