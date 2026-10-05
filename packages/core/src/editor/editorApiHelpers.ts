import type {
	EditorInternals,
	CRDTDocument,
	DocumentOp,
	ApplyOptions,
	OpOrigin,
	MutationGroupMetadata,
	BlockHandle,
	UndoManager,
	CRDTMap,
	CRDTArray,
} from "@input/pen-types";
import {
	AI_AUTOCOMPLETE_CONTROLLER_SLOT,
	AI_CONTROLLER_SLOT,
	AI_INLINE_HISTORY_SLOT,
	AI_REVIEW_CONTROLLER_SLOT,
	AI_SUGGESTIONS_CONTROLLER_SLOT,
	ANNOUNCER_SLOT_KEY,
	FIELD_EDITOR_SLOT_KEY,
	SNAPSHOTS_CONTROLLER_SLOT,
	INLINE_COMPLETION_SLOT,
	INPUT_RULES_ENGINE_SLOT_KEY,
	MULTIPLAYER_CONTROLLER_SLOT,
	MUTATION_GROUP_METADATA_KEY,
	SEARCH_CONTROLLER_SLOT,
	UNDO_HISTORY_METADATA_CONTROLLER_SLOT_KEY,
	UNDO_HISTORY_RESTORE_SLOT_KEY,
	type Facet,
} from "@input/pen-types";
import { createMutationGroupMetadata, getApplyOptionsGroupId } from "./origin";
import { clipboardFacet } from "../facets/coreFacets";
import {
	aiAutocompleteControllerFacet,
	aiControllerFacet,
	aiInlineCompletionFacet,
	aiInlineHistoryFacet,
	aiReviewControllerFacet,
	aiSuggestionsControllerFacet,
	announcerFacet,
	assetProviderFacet,
	toolRuntimeFacet,
	fieldEditorHostFacet,
	snapshotsControllerFacet,
	inputRulesEngineFacet,
	multiplayerControllerFacet,
	searchControllerFacet,
	smoothStreamControllerFacet,
	streamingTargetFacet,
	undoManagerFacet,
	undoMetadataControllerFacet,
	undoRestoreControllerFacet,
} from "../facets/controllerFacets";
import { a11yLabelFacet } from "../facets/a11yFacets";
import { localeFacet, messagesFacet } from "../facets/i18nFacets";
import { getDocumentLoadReport } from "@input/pen-yjs";
import { createBlockHandle } from "../schema/handles";
import type { CRDTUnknownMap } from "./crdtShapes";
import {
	getTextProp,
	getTableContent,
	getCellText as getCellTextFromRow,
	isCRDTMap,
} from "./crdtShapes";
import { createEmptyBlockIndex } from "../changes/blockIndex";
import { emptyDecorationSet } from "./decorations";
import { createDocumentSession } from "./documentSession";

import type { Editor } from "@input/pen-types";
import type { EditorImplInternal } from "./editorImplContext";

type EditorImplRuntime = EditorImplInternal;
type CRDTBlockMap = CRDTMap<CRDTMap<unknown>>;

const FACET_BY_SLOT_KEY: Record<string, Facet<unknown, unknown>> = {
	[FIELD_EDITOR_SLOT_KEY]: fieldEditorHostFacet,
	[INPUT_RULES_ENGINE_SLOT_KEY]: inputRulesEngineFacet,
	[UNDO_HISTORY_RESTORE_SLOT_KEY]: undoRestoreControllerFacet,
	[UNDO_HISTORY_METADATA_CONTROLLER_SLOT_KEY]: undoMetadataControllerFacet,
	[INLINE_COMPLETION_SLOT]: aiInlineCompletionFacet,
	[AI_CONTROLLER_SLOT]: aiControllerFacet,
	[AI_INLINE_HISTORY_SLOT]: aiInlineHistoryFacet,
	[AI_REVIEW_CONTROLLER_SLOT]: aiReviewControllerFacet,
	[AI_AUTOCOMPLETE_CONTROLLER_SLOT]: aiAutocompleteControllerFacet,
	[AI_SUGGESTIONS_CONTROLLER_SLOT]: aiSuggestionsControllerFacet,
	[SEARCH_CONTROLLER_SLOT]: searchControllerFacet,
	[MULTIPLAYER_CONTROLLER_SLOT]: multiplayerControllerFacet,
	[SNAPSHOTS_CONTROLLER_SLOT]: snapshotsControllerFacet,
	"paste:importers": clipboardFacet,
	"paste:assetProvider": assetProviderFacet,
	"undo:manager": undoManagerFacet,
	"tools:runtime": toolRuntimeFacet,
	"pen.locale": localeFacet,
	"pen.messages": messagesFacet,
	"pen.a11yLabel": a11yLabelFacet,
	"delta-stream:target": streamingTargetFacet,
	"smooth-stream:controller": smoothStreamControllerFacet,
	[ANNOUNCER_SLOT_KEY]: announcerFacet,
};

function writeAssignedSlot(
	self: EditorImplRuntime,
	key: string,
	value: unknown,
): void {
	self._slots.set(key, value);
	if (key === "undo:manager") {
		self._refreshUndoManager();
	}
	const facet = FACET_BY_SLOT_KEY[key];
	if (facet) {
		self._facetRegistry.override(facet, value);
	}
}

export function getRawBlockMap(
	editor: EditorImplRuntime,
	blockId: string,
): CRDTUnknownMap | null {
	const self = editor as EditorImplRuntime;
	const blockMap = (self._doc.blocks as CRDTBlockMap).get(blockId);
	return (blockMap as unknown as CRDTUnknownMap) ?? null;
}

export function getEditorInternals(editor: EditorImplRuntime): EditorInternals {
	const self = editor as EditorImplRuntime;
	return {
		adapter: self._adapter,
		crdtDoc: self._crdtDoc,
		doc: self._doc,
		engine: self._engine,
		// Read live: an extension may ensure the scope's awareness after bind.
		awareness:
			self._documentSession?.getAwareness(self._documentScope.id) ??
			self._awareness,
		documentSession: self._documentSession,
		documentScope: self._documentScope,
		viewId: self._viewId,
		emit: (event, ...args) => {
			self._emitter.emit(event, ...args);
		},
		hasListeners: (event) => self._emitter.has(event),
		onApplyBoundary: (hook) => self._pipeline.addApplyBoundaryHook(hook),
		onPipelinePhase: (listener) => self._onPipelinePhase(listener),
		assignSlot: (key: string, value: unknown): void => {
			writeAssignedSlot(self, key, value);
		},
		getBlockText: (blockId: string): unknown => {
			const blockMap = self._getRawBlockMap(blockId);
			if (!blockMap) return null;
			return getTextProp(blockMap, "content");
		},
		getCellText: (blockId: string, row: number, col: number): unknown => {
			const blockMap = self._getRawBlockMap(blockId);
			if (!blockMap) return null;
			const tableContent = getTableContent(blockMap);
			if (!tableContent || row < 0 || row >= tableContent.length)
				return null;
			const rowMap = tableContent.get(row);
			if (!rowMap || !isCRDTMap(rowMap)) return null;
			return getCellTextFromRow(rowMap, col);
		},
		selectionAnchors: () => self._selection.heldAnchors,
	};
}

export function applyEditorOps(
	editor: EditorImplRuntime,
	ops: DocumentOp[],
	options?: ApplyOptions,
): void {
	const self = editor as EditorImplRuntime;
	const origin = options?.origin ?? "user";
	const groupId = getApplyOptionsGroupId(origin, options);
	const undo = self._slots.get("undo:manager") as UndoManager | undefined;

	if (options?.undoGroup && !groupId) {
		undo?.stopCapturing();
	}

	// AIB4: writes join the undo step of their group id (or of their origin
	// type when ungrouped); an ungrouped write never closes an open group. The
	// capture key travels with the apply: one issued from inside another apply
	// is queued and runs after this call returns, under its own key.
	const capture = (run: () => void) => {
		if (undo) {
			undo.withCapture(origin, groupId ?? null, run);
		} else {
			run();
		}
		self._recordMutationGroupMetadata(origin, groupId);
	};
	self._pipeline.apply(ops, origin, options?.structural, capture);
}

export function recordMutationGroupMetadata(
	editor: EditorImplRuntime,
	origin: OpOrigin,
	groupId: string | undefined,
): void {
	const self = editor as EditorImplRuntime;
	if (!groupId) {
		return;
	}
	const controller = self._slots.get(
		UNDO_HISTORY_METADATA_CONTROLLER_SLOT_KEY,
	) as
		| {
				setCurrentEntryMetadata<T>(
					key: string,
					value: { before: T | null; after: T | null },
				): boolean;
		  }
		| undefined;
	controller?.setCurrentEntryMetadata<MutationGroupMetadata>(
		MUTATION_GROUP_METADATA_KEY,
		{
			before: null,
			after: createMutationGroupMetadata(origin, groupId),
		},
	);
}

export function loadEditorDocument(
	editor: EditorImplRuntime,
	doc: CRDTDocument,
): void {
	const self = editor as EditorImplRuntime;
	self._queueExtensionLifecycle(async () => {
		await self._extensions.deactivateAll(self as unknown as Editor);
		if (self._isDestroyed) {
			return;
		}
		self._teardownObservation();
		self._releaseSession?.();
		self._releaseSession = null;
		self._bindSession(
			createDocumentSession({
				adapter: self._adapter,
				document: doc,
				destroyWhenIdle: true,
				ownsDocuments: false,
			}),
		);
		await self._rebindActiveScope();
		const report = getDocumentLoadReport(doc);
		if (report?.state === "repaired") {
			self._emitter.emit("crdt:recovered", "repair");
		}
	});
}

export function* iterateBlocks(
	editor: EditorImplRuntime,
	type?: string,
): Iterable<BlockHandle> {
	const self = editor as EditorImplRuntime;
	const seen = new Set<string>();

	function* walk(id: string): Iterable<BlockHandle> {
		if (seen.has(id)) return;
		seen.add(id);
		const blockMap = (self._doc.blocks as CRDTBlockMap).get(id);
		// A dangling entry names no block (COL4): skip it until the
		// structural pass removes it.
		if (!blockMap) return;
		if (!type || blockMap.get("type") === type) {
			yield createBlockHandle(
				id,
				self._doc,
				self._crdtDoc,
				self._registry,
			);
		}
		const children = blockMap.get("children") as
			CRDTArray<string> | undefined;
		if (!children) return;
		for (let i = 0; i < children.length; i++) {
			yield* walk(children.get(i));
		}
	}

	for (let i = 0; i < self._doc.blockOrder.length; i++) {
		yield* walk(
			(self._doc.blockOrder as CRDTArray<string>).get(i) as string,
		);
	}
}

export function getEditorBlock(
	editor: EditorImplRuntime,
	blockId: string,
): BlockHandle | null {
	const self = editor as EditorImplRuntime;
	if (!(self._doc.blocks as CRDTBlockMap).has(blockId)) return null;
	return createBlockHandle(blockId, self._doc, self._crdtDoc, self._registry);
}

/** The first root entry with a block map; a dangling entry (COL4) is skipped. */
export function getFirstBlock(editor: EditorImplRuntime): BlockHandle | null {
	const self = editor as EditorImplRuntime;
	const order = self._doc.blockOrder as CRDTArray<string>;
	for (let i = 0; i < order.length; i++) {
		const handle = getEditorBlock(self, order.get(i));
		if (handle) return handle;
	}
	return null;
}

/** The last root entry with a block map; a dangling entry (COL4) is skipped. */
export function getLastBlock(editor: EditorImplRuntime): BlockHandle | null {
	const self = editor as EditorImplRuntime;
	const order = self._doc.blockOrder as CRDTArray<string>;
	for (let i = order.length - 1; i >= 0; i--) {
		const handle = getEditorBlock(self, order.get(i));
		if (handle) return handle;
	}
	return null;
}

export function getBlockCount(editor: EditorImplRuntime): number {
	let count = 0;
	for (const _block of iterateBlocks(editor)) {
		count += 1;
	}
	return count;
}

export function getEditorBlockRevision(
	editor: EditorImplRuntime,
	blockId: string,
): number {
	const self = editor as EditorImplRuntime;
	return self._blockRevisions.get(blockId) ?? 0;
}

export function destroyEditor(editor: EditorImplRuntime): Promise<void> {
	const self = editor as EditorImplRuntime;
	if (self._isDestroyed) {
		return self._extensionLifecycle;
	}
	self._isDestroyed = true;
	self._blockRevisions.clear();
	return self._queueExtensionLifecycle(async () => {
		await self._extensions.deactivateAll(self as unknown as Editor);
		self._teardownObservation();
		self._releaseSession?.();
		self._releaseSession = null;
		self._emitter.removeAllListeners();
		releaseDestroyedEditorCaches(self);
	});
}

function releaseDestroyedEditorCaches(self: EditorImplRuntime): void {
	self._decorations = emptyDecorationSet();
	self._decorationCollector.clear();
	self._pendingSummary = null;
	self._deferredCRDTEvent = null;
	self._lastChangeSummary = null;
	self._blockIndex = createEmptyBlockIndex();
	self._documentState.clear();
	self._slots.delete("undo:manager");
	self._facetRegistry.override(undoManagerFacet, null);
	self._refreshUndoManager();
}
