import type { BlockScrollAlign, DocumentOp } from "@input/pen-types";
import type { StandingDiagnosticCode } from "./diagnosticsAllowlist";

export type LogicalPoint = {
	blockId: string;
	offset: number;
};

export type PointRef =
	| { block: number; offset: number }
	| { blockId: string; offset: number };

export type SerializedTextSelection = {
	type: "text";
	anchor: LogicalPoint;
	focus: LogicalPoint;
	/**
	 * Serialize-time snapshot from `@input/pen-core`'s `isCollapsed()`.
	 * Not a live `TextSelection` field.
	 */
	isCollapsed: boolean;
};

export type SerializedBlockSelection = {
	type: "block";
	blockIds: string[];
};

export type SerializedAppSelection = {
	type: "app";
	appId: string;
};

export type SerializedCellSelection = {
	type: "cell";
	blockId: string;
	anchor: { row: number; col: number };
	head: { row: number; col: number };
	/** The edited cell's caret (W3.R18). */
	text?: { anchor: number; focus: number };
};

export type SerializedSelection =
	| SerializedTextSelection
	| SerializedBlockSelection
	| SerializedAppSelection
	| SerializedCellSelection
	| null;

export type SerializedSelectionRecord = {
	version: number;
	origin: string;
	commitId: number;
	state: SerializedSelection;
};

export type SerializedDiagnostic = {
	code: string;
	level: string;
	source: string;
	message: string;
	reason?: string;
	/** Primitive payload fields the diagnostic carries (version, blockId, …). */
	details?: Readonly<Record<string, string | number | boolean>>;
};

export type ConformanceEventRecord = {
	type: string;
	payload: unknown;
};

export type DomAuthorityCheck = {
	/** Checked and equal. Never true when `skipped` is set. */
	ok: boolean;
	/** Could not check (unfocused or non-text). Distinct from a match. */
	skipped?: boolean;
	reason?: string;
	authority?: SerializedSelection;
	dom?: { anchor: LogicalPoint; focus: LogicalPoint } | null;
};

/**
 * Result of forcing a native selection off the authority with no
 * gesture window. `created` is true only when a capture-phase
 * `selectionchange` observed a mapped point that differed.
 */
export type ForcedDomDivergence = {
	created: boolean;
	focused: boolean;
	reason?: string;
	version: number | null;
	authority: SerializedSelection;
	observed: { anchor: LogicalPoint; focus: LogicalPoint } | null;
};

export type HostileDomScan = {
	urlAttributes: string[];
	javascriptUrls: string[];
	blockedUrlCount: number;
	probeTripped: boolean;
};

export type RemoteYInjectArgs = {
	link?: { blockId: string; href: string };
	image?: { blockId: string; src: string };
};

export type RemoteSpliceArgs = {
	block: number;
	from: number;
	to: number;
	insert: string;
};

export type PresencePeerInject = {
	clientId: number;
	state: Record<string, unknown>;
};

export type PresenceCursorSnapshot = {
	clientId: number;
	userId: string;
	userName: string;
	avatar?: string;
	blockId: string;
	offset: number;
};

export type PresencePeerSnapshot = {
	clientId: number;
	userId: string;
	userName: string;
	avatar?: string;
};

export type PresenceSnapshot = {
	cursors: PresenceCursorSnapshot[];
	peers: PresencePeerSnapshot[];
};

export type GeometryAffinity = "upstream" | "downstream";

export type GeometryPoint = {
	blockId: string;
	offset: number;
};

export type GeometryPointRef = GeometryPoint & {
	affinity?: GeometryAffinity;
};

export type GeometryRect = {
	x: number;
	y: number;
	width: number;
	height: number;
	top: number;
	left: number;
	right: number;
	bottom: number;
};

export type GeometryCaretCompare = {
	point: GeometryPoint;
	affinity: GeometryAffinity;
	cached: GeometryRect | null;
	fromScratch: GeometryRect | null;
	stale: boolean;
};

export type GeometryCaretCompareResult = {
	generation: number;
	rootHeight: number;
	compares: GeometryCaretCompare[];
	staleCount: number;
	/** Both-null caretRects are equal, so staleCount stays 0. This is the other axis. */
	missingCount: number;
};

export type GeometryLineBox = {
	top: number;
	bottom: number;
	startOffset: number;
	endOffset: number;
};

export type GeometryBlockInfo = {
	id: string;
	length: number;
};

export type GeometryVerticalTarget = {
	point: GeometryPoint;
	goalX: number;
};

export type GeometryVerticalMotion = {
	situation: string;
	direction: "up" | "down";
	from: GeometryPoint;
	goalX: number | null;
	first: GeometryVerticalTarget | null;
	second: GeometryVerticalTarget | null;
	fresh: GeometryVerticalTarget | null;
	lineBoxes: GeometryLineBox[];
};

/** OV4: what the overlay layer painted against the authority record after a flush. */
export type OverlayAuthorityCheck = {
	/** `held`: versions match and any local caret names the record's focus and affinity. */
	kind: "held" | "failed" | "no-overlay";
	reason: string;
	layerVersion: number | null;
	recordVersion: number | null;
	caret: { blockId: string; offset: number; affinity: string } | null;
	expectedCaret: { blockId: string; offset: number; affinity: string } | null;
};

/** OV1 counters over a window: flushes, paints, reader calls, layer mutations. */
export type OverlayProbeCounts = {
	flushes: number;
	paints: number;
	caretRectReads: number;
	blockRectReads: number;
	/** The most `caretRect` / `blockRect` calls any single flush made. */
	maxCaretRectReadsPerFlush: number;
	maxBlockRectReadsPerFlush: number;
	/** Mutation records on the layer's items and children. */
	layerMutations: number;
	/** Attribute writes on the layer element itself (OV4 version, caret-visible). */
	layerAttributeWrites: number;
};

export type GeometryEightCaretItem = {
	id: string;
	kind: string;
	x: number;
	y: number;
	width: number;
	height: number;
};

export type GeometryEightCaretBudget = {
	caretCount: number;
	paintedCount: number;
	overlayConnected: boolean;
	overlayAttr: string | null;
	/** The overlay layer's viewport origin; item x/y are relative to it (OV2). */
	layerOrigin: { x: number; y: number };
	readPhase: string;
	writePhase: string;
	items: GeometryEightCaretItem[];
	readPhaseMeasureCount: number;
	writePhaseMeasureCount: number;
	supportedEntryTypes: string[];
	layoutShiftSupported: boolean;
	longTaskSupported: boolean;
	layoutShiftCount: number;
	longTaskCount: number;
	layoutShiftValues: number[];
	missingObserverTypes: string[];
};

export type SerializedBeforeInputCommandMapping = {
	readonly commandName: string;
	readonly preventDefault: true;
	readonly param?: Readonly<Record<string, unknown>>;
};

export type SerializedBeforeInputAllowPolicy = {
	readonly policy: "allow";
};

export type SerializedBeforeInputBlockPolicy = {
	readonly policy: "block";
	readonly code: "unhandled-input-type";
};

export type SerializedBeforeInputMapping =
	| SerializedBeforeInputCommandMapping
	| SerializedBeforeInputAllowPolicy
	| SerializedBeforeInputBlockPolicy;

export type DocumentContentSnapshot = {
	readonly blockOrder: readonly string[];
	readonly blocks: readonly {
		readonly id: string;
		readonly type: string;
		readonly text: string;
		readonly props: Readonly<Record<string, unknown>>;
		readonly deltas: readonly {
			readonly insert:
				| string
				| { type: string; props: Record<string, unknown> };
			readonly attributes?: Record<string, unknown>;
		}[];
	}[];
};

export type BeforeInputDispatchResult = {
	readonly defaultPrevented: boolean;
	readonly inputType: string;
	readonly threw: string | null;
};

export type DragTextArgs = {
	from: PointRef;
	to: PointRef;
};

export type SelectionEqualsArgs = {
	anchor: PointRef;
	focus: PointRef;
};

/** One block as the DOM fuzzer's generator sees it (W3.R19). */
export type FuzzBlockView = {
	id: string;
	type: string;
	/** Logical length (an inline atom is one offset). */
	length: number;
	/** `"text"` when a caret can sit in it (N2), else `"structural"`. */
	kind: "text" | "structural";
};

/** S5 over every text endpoint of the current record. */
export type FuzzNormalPositionCheck = {
	ok: boolean;
	reason?: string;
};

/** `validateDocument` errors on both peers, and whether they converged. */
export type FuzzDocumentCheck = {
	localErrors: string[];
	remoteErrors: string[];
	stateVectorsEqual: boolean;
};

/**
 * `window.__penConformance.fuzzCheck()` (W3.R19 §3.15): what the page saw
 * after one fuzz step. `diagnostics` holds only what arrived since the
 * previous call; the call drains them.
 */
export type FuzzCheckReport = {
	s2: DomAuthorityCheck;
	s5: FuzzNormalPositionCheck;
	record: { version: number; commitId: number } | null;
	diagnostics: SerializedDiagnostic[];
	documents: FuzzDocumentCheck;
	blocks: FuzzBlockView[];
};

/** The page's side of the two-page relay (W5.R10). Every update is base64. */
export type RelayBridge = {
	/** Updates the local doc emitted since the last drain; relay deliveries are never re-emitted. */
	drainOutbox(): string[];
	/** Applied non-locally with the relay origin, as a real provider applies them. */
	deliver(updates: readonly string[]): void;
	stateVector(): string;
	/** Everything this page holds that `stateVector` lacks; `""` means everything. */
	encodeSince(stateVector: string): string;
	/** The local awareness state when it changed since the last drain. */
	drainAwareness(): string[];
	deliverAwareness(updates: readonly string[]): void;
};

export type PenConformanceBridge = {
	readonly selection: SerializedSelection;
	/** Official `isCollapsed` from `@input/pen-core` over the live editor selection. */
	isCollapsed(): boolean;
	/** Authority record (version / origin / commitId). Missing is unchecked, not a match. */
	readonly selectionRecord: SerializedSelectionRecord | null;
	readonly lastEvents: readonly ConformanceEventRecord[];
	readonly diagnostics: readonly SerializedDiagnostic[];
	readonly documentText: string;
	readonly blockIds: readonly string[];
	/** Root ids as the renderer sees them (`getRootBlockIds`). */
	readonly rootBlockIds: readonly string[];
	readonly hasFocus: boolean;
	readonly fixtureName: string;
	readonly generation: number;
	readonly hasFieldEditor: boolean;
	readonly reducedMotion: boolean;
	readonly windowRange: { start: number; size: number };
	readonly hasMultiplayer: boolean;
	readonly presence: PresenceSnapshot;
	load(name: string): void;
	/** `?relay=1` (W5.R10): fork this page from another page's encoded state with its own client id. */
	loadSeeded(fixture: string, seedBase64: string, clientId: number): void;
	/** `?relay=1` only: the page's side of the two-page relay. Updates are base64. */
	readonly relay?: RelayBridge;
	focusText(block?: number): void;
	selectText(block: number, offset?: number): void;
	/** Plain text of one block, by id. */
	blockText(blockId: string): string;
	/** Select by block id; scale fixtures address blocks by id, not index. */
	selectTextById(blockId: string, anchorOffset: number, focusOffset?: number): void;
	/** A programmatic text range between two blocks, origin `programmatic`. */
	selectTextRangeById(anchor: LogicalPoint, focus: LogicalPoint): void;
	/** D5: the field editor's `getSubstituteState()`, or null. */
	readonly substituteState:
		"block-surface-range" | "engine-confined-range" | null;
	/** G3: a collapsed caret with an explicit affinity, origin `keyboard`. */
	selectCaretWithAffinity(
		blockId: string,
		offset: number,
		affinity: "upstream" | "downstream",
	): void;
	/** O3: a block selection over these ids, origin `keyboard`. */
	selectBlocksById(blockIds: readonly string[]): void;
	/** Every block id, nested ones included, in document preorder. */
	readonly preorderBlockIds: readonly string[];

	/** Disconnect or reconnect the in-page remote peer (`connectPeers`). */
	setPeersConnected(connected: boolean): void;
	setWindow(start: number): void;
	apply(ops: readonly DocumentOp[]): void;
	remoteApply(ops: readonly DocumentOp[]): void;
	applyToolPayloads(payloads: readonly unknown[]): {
		ok: boolean;
		message?: string;
	};
	importHtml(html: string): Promise<void>;
	pasteHtml(html: string): Promise<void>;
	scanHostileDom(): HostileDomScan;
	resetXssProbe(): void;
	remoteSplice(args: RemoteSpliceArgs): void;
	remoteInjectY(args: RemoteYInjectArgs): void;
	injectPresence(
		peers: readonly PresencePeerInject[],
	): Promise<PresenceSnapshot>;
	serializePresenceAnchor(blockId: string, offset: number): string;
	installBrokenProjector(): void;
	/** W3.R1: drop the next native selection write and count writes from here. */
	installSelectionWriteFault(): void;
	readonly selectionWriteFault: { dropped: number; writes: number };
	/** W3.R17: confine the next multi-block selection write to the anchor field. */
	installConfiningWriteFault(): void;
	/** Clamped writes, the lone clears that task ended with, and writes after it. */
	readonly confiningWriteFault: {
		confined: number;
		clears: number;
		laterWrites: number;
	};
	forceUnwindowedDomDivergence(): ForcedDomDivergence;
	domMatchesAuthority(): DomAuthorityCheck;
	/** CS10: call `domSelectionToEditor` on a page-owned root. */
	mapDomSelection(root: HTMLElement): {
		anchor: LogicalPoint;
		focus: LogicalPoint;
	} | null;
	/** CS10: write the native range for `anchor`..`focus` on a page-owned root. */
	projectSelectionToDom(
		root: HTMLElement,
		anchor: LogicalPoint,
		focus: LogicalPoint,
	): void;
	/** CS10: mount the same one-paragraph probe the jsdom tests used. */
	mountSelectionProbe(text: string, blockId: string): HTMLElement;
	applyAiRangeReplacement(args: {
		start: { blockId: string; offset: number };
		end: { blockId: string; offset: number };
		replacementText: string;
	}): void;
	parseClipboardPayload(raw: unknown): { status: string };
	exerciseInlineAtomDragPreview(): {
		filled: string;
		emptied: boolean;
	};
	readonly geometryGeneration: number;
	geometryBlocks(): GeometryBlockInfo[];
	geometryLineBoxes(blockId: string): GeometryLineBox[];
	invalidateGeometry(): void;
	warmCaretCache(points: readonly GeometryPointRef[]): void;
	compareCaretCache(
		points: readonly GeometryPointRef[],
	): Promise<GeometryCaretCompareResult>;
	verticalMotion(args: {
		situation: string;
		from: GeometryPoint;
		direction: "up" | "down";
		goalX?: number | null;
	}): GeometryVerticalMotion;
	flushEightRemoteCarets(
		points: readonly GeometryPoint[],
	): Promise<GeometryEightCaretBudget>;
	/** OV4: run a flush, then compare the overlay layer with the authority record. */
	overlayMatchesAuthority(): Promise<OverlayAuthorityCheck>;
	/** OV1: start counting overlay flushes, paints, reader calls and layer mutations. */
	startOverlayProbe(): void;
	/** OV1: stop counting and return the counts since `startOverlayProbe`. */
	stopOverlayProbe(): OverlayProbeCounts;
	readonly beforeinputMap: Readonly<
		Record<string, SerializedBeforeInputMapping>
	>;
	mapBeforeInput(inputType: string): SerializedBeforeInputMapping;
	documentSnapshot(): DocumentContentSnapshot;
	dispatchBeforeInput(args: {
		inputType: string;
		data?: string;
	}): BeforeInputDispatchResult;
	clearDiagnostics(): void;
	mutateActiveSurfaceText(text: string): void;
	undo(): void;
	/** W3.R15: `scrollIntoView({ blockId }, { align })` on the field editor. */
	scrollBlockIntoView(blockId: string, align: BlockScrollAlign): void;
	redo(): void;
	stopCapturing(): void;
	/** W3.R19: invariants after one fuzz step; drains diagnostics. */
	fuzzCheck(): FuzzCheckReport;
	/** Resolves after a scheduler flush that leaves no work queued. Test-side only. */
	whenIdle(): Promise<void>;
};

export type LoadOptions = {
	pointer?: boolean;
};

export type ScenarioApi = {
	load(name: string, options?: LoadOptions): Promise<void>;
	apply(ops: readonly DocumentOp[]): Promise<void>;
	applyAiRangeReplacement(args: {
		start: { blockId: string; offset: number };
		end: { blockId: string; offset: number };
		replacementText: string;
	}): Promise<void>;
	applyToolPayloads(
		payloadsJson: string,
	): Promise<{ ok: boolean; message?: string }>;
	importHtml(html: string): Promise<void>;
	pasteHtml(html: string): Promise<void>;
	selectText(block: number, offset?: number): Promise<void>;
	keyboard: {
		type(text: string): Promise<void>;
		press(key: string): Promise<void>;
	};
	mouse: {
		dragText(args: DragTextArgs): Promise<void>;
	};
	remote: {
		splice(args: RemoteSpliceArgs): Promise<void>;
		apply(ops: readonly DocumentOp[]): Promise<void>;
		injectY(args: RemoteYInjectArgs): Promise<void>;
		injectPresence(
			peers: readonly PresencePeerInject[],
		): Promise<PresenceSnapshot>;
	};
	expectDiagnostic(code: StandingDiagnosticCode | string): void;
	installBrokenProjector(): Promise<void>;
	forceUnwindowedDomDivergence(): Promise<ForcedDomDivergence>;
	geometry: {
		blocks(): Promise<GeometryBlockInfo[]>;
		lineBoxes(blockId: string): Promise<GeometryLineBox[]>;
		invalidate(): Promise<void>;
		warm(points: readonly GeometryPointRef[]): Promise<void>;
		compare(
			points: readonly GeometryPointRef[],
		): Promise<GeometryCaretCompareResult>;
		verticalMotion(args: {
			situation: string;
			from: GeometryPoint;
			direction: "up" | "down";
			goalX?: number | null;
		}): Promise<GeometryVerticalMotion>;
		flushEightRemoteCarets(
			points: readonly GeometryPoint[],
		): Promise<GeometryEightCaretBudget>;
	};
	assert: {
		selectionEquals(expected: SelectionEqualsArgs): Promise<void>;
		domMatchesAuthority(): Promise<void>;
		textContains(text: string): Promise<void>;
		corpusSafe(options?: { requireBlockedUrl?: boolean }): Promise<void>;
		xssProbeNotTripped(): Promise<void>;
		focusInsideEditor(): Promise<void>;
	};
};

/** The `?probe=render` window API (W1 scale-render counts). */
interface ScaleProbeBridge {
	/** Resolves after one frame has settled the setup, with the window open. */
	begin(): Promise<void>;
	end(): Promise<Record<string, number>>;
	live(): Record<string, number>;
}

declare global {
	interface Window {
		__penConformance: PenConformanceBridge;
		/** `?probe=render` instruments (harness/src/probes); absent otherwise. */
		__penScaleProbe: ScaleProbeBridge;
		__xssProbe: () => void;
		__xssProbeTripped: boolean;
	}
}
