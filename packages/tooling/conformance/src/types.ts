import type { DocumentOp } from "@input/pen-types";
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
	focusText(block?: number): void;
	selectText(block: number, offset?: number): void;
	/** Plain text of one block, by id. */
	blockText(blockId: string): string;
	/** Select by block id; scale fixtures address blocks by id, not index. */
	selectTextById(blockId: string, anchorOffset: number, focusOffset?: number): void;
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
	forceUnwindowedDomDivergence(): ForcedDomDivergence;
	domMatchesAuthority(): DomAuthorityCheck;
	/** CS10: call `domSelectionToEditor` on a page-owned root. */
	mapDomSelection(root: HTMLElement): {
		anchor: LogicalPoint;
		focus: LogicalPoint;
	} | null;
	/** CS10: call `editorSelectionToDOM` on a page-owned root. */
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
	redo(): void;
	stopCapturing(): void;
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
	begin(): void;
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
