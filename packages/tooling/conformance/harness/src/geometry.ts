import {
	createGeometryReader,
	DomScheduler,
	getRootGeometry,
	getRootOverlay,
	verticalCaretTarget,
	type GeometryReaderHost,
	type OverlayPainter,
	type OverlayPaintPlan,
	type OverlayRequest,
	type RootOverlay,
} from "@input/pen-dom";
import { fieldEditorHostFacet, getEditorSelectionRecord } from "@input/pen-core";
import type { Editor } from "@input/pen-types";
import {
	OVERLAY_ITEM_ATTR,
	OVERLAY_LAYER_ATTR,
} from "../../../../rendering/dom/src/utils/dataAttributes";
import type {
	GeometryBlockInfo,
	GeometryCaretCompare,
	GeometryCaretCompareResult,
	GeometryEightCaretBudget,
	GeometryLineBox,
	GeometryPoint,
	GeometryPointRef,
	GeometryVerticalMotion,
	OverlayAuthorityCheck,
	OverlayProbeCounts,
} from "../../src/types";
import {
	geometryBlocksFromEditor,
	normalizePoint,
	rectsEqual,
	serializeRect,
	tallyCaretCompares,
} from "./geometryCompare";

const ROOT_SELECTOR = "[data-pen-editor-root]";

type GeometryHost = {
	root: HTMLElement;
	reader: GeometryReaderHost;
	scheduler: DomScheduler;
};

/** The harness's remote-caret contributor on the production overlay (OV1, OV2). */
const REMOTE_CARET_CONTRIBUTOR = "conformance-remote-carets";

let host: GeometryHost | null = null;
let releaseRemoteCarets: (() => void) | null = null;

function editorRoot(): HTMLElement {
	const root = document.querySelector(ROOT_SELECTOR);
	if (!(root instanceof HTMLElement)) {
		throw new Error("geometry: editor root is not mounted");
	}
	return root;
}

function serializeLineBoxes(
	blockId: string,
	reader: GeometryReaderHost,
): GeometryLineBox[] {
	return reader.lineBoxes(blockId).map((line) => ({
		top: line.top,
		bottom: line.bottom,
		startOffset: line.startOffset,
		endOffset: line.endOffset,
	}));
}

function supportedEntryTypes(): string[] {
	const observer = (
		globalThis as typeof globalThis & {
			PerformanceObserver?: { supportedEntryTypes?: readonly string[] };
		}
	).PerformanceObserver;
	return observer?.supportedEntryTypes
		? [...observer.supportedEntryTypes]
		: [];
}

function observeEntries(type: string): {
	records: PerformanceEntry[];
	take(): PerformanceEntry[];
	disconnect(): void;
} | null {
	if (typeof PerformanceObserver === "undefined") {
		return null;
	}
	if (!supportedEntryTypes().includes(type)) {
		return null;
	}
	const records: PerformanceEntry[] = [];
	const observer = new PerformanceObserver((list) => {
		records.push(...list.getEntries());
	});
	observer.observe({ type, buffered: false });
	return {
		records,
		take() {
			records.push(...observer.takeRecords());
			return records;
		},
		disconnect() {
			observer.disconnect();
		},
	};
}

function attachHost(): GeometryHost {
	const root = editorRoot();
	// Measure the reader and scheduler the mounted editor actually drives
	// (FE4), not a private copy of them. The field editor feeds every commit
	// to this scheduler, and its flush invalidates this reader, so there is
	// nothing for the harness to replay.
	const { reader, scheduler } = getRootGeometry(root);
	return { root, reader, scheduler };
}

/**
 * The production overlay the field editor attached to the root (OV2). The
 * harness paints through it and owns no layer of its own.
 */
function rootOverlay(root: HTMLElement): RootOverlay {
	const overlay = getRootOverlay(root);
	if (!overlay) {
		throw new Error(
			"geometry: the editor root has no overlay; no field editor attached it",
		);
	}
	return overlay;
}

export function disposeGeometry(): void {
	// The reader, scheduler and overlay belong to the editor root, so the
	// mount that created them disposes them; the harness only owns its
	// contributor.
	releaseRemoteCarets?.();
	releaseRemoteCarets = null;
	host = null;
}

export function ensureGeometry(): GeometryHost {
	if (host && host.root === editorRoot()) {
		return host;
	}
	host = attachHost();
	return host;
}

export function geometryGeneration(): number {
	return host?.reader.generation ?? 0;
}

export function invalidateGeometry(): void {
	ensureGeometry().reader.invalidateAll();
}

export function geometryBlocks(editor: Editor): GeometryBlockInfo[] {
	return geometryBlocksFromEditor(editor);
}

export function geometryLineBoxes(blockId: string): GeometryLineBox[] {
	const current = ensureGeometry();
	return serializeLineBoxes(blockId, current.reader);
}

export function warmCaretCache(points: readonly GeometryPointRef[]): void {
	const current = ensureGeometry();
	for (const ref of points) {
		const { point, affinity } = normalizePoint(ref);
		current.reader.caretRect(point, affinity);
	}
}

export async function compareCaretCache(
	points: readonly GeometryPointRef[],
): Promise<GeometryCaretCompareResult> {
	const current = ensureGeometry();
	const root = editorRoot();

	return current.scheduler.read(() => {
		const fresh = createGeometryReader({
			root,
			observeResize: false,
			observeFonts: false,
		});
		try {
			const compares: GeometryCaretCompare[] = points.map((ref) => {
				const { point, affinity } = normalizePoint(ref);
				const cached = serializeRect(
					current.reader.caretRect(point, affinity),
				);
				const fromScratch = serializeRect(
					fresh.caretRect(point, affinity),
				);
				return {
					point,
					affinity,
					cached,
					fromScratch,
					stale: !rectsEqual(cached, fromScratch),
				};
			});
			return {
				generation: current.reader.generation,
				rootHeight: root.getBoundingClientRect().height,
				compares,
				...tallyCaretCompares(compares),
			};
		} finally {
			fresh.dispose();
		}
	});
}

export function runVerticalMotion(args: {
		situation: string;
		from: GeometryPoint;
		direction: "up" | "down";
		goalX?: number | null;
}): GeometryVerticalMotion {
	const current = ensureGeometry();
	const first = verticalCaretTarget(
		current.reader,
		args.from,
		args.direction,
		args.goalX,
	);
	const second = verticalCaretTarget(
		current.reader,
		args.from,
		args.direction,
		args.goalX,
	);
	const fresh = createGeometryReader({
		root: editorRoot(),
		observeResize: false,
		observeFonts: false,
	});
	try {
		const fromFresh = verticalCaretTarget(
			fresh,
			args.from,
			args.direction,
			args.goalX,
		);
		return {
			situation: args.situation,
			direction: args.direction,
			from: args.from,
			goalX: args.goalX ?? null,
			first: first
				? { point: { ...first.point }, goalX: first.goalX }
				: null,
			second: second
				? { point: { ...second.point }, goalX: second.goalX }
				: null,
			fresh: fromFresh
				? { point: { ...fromFresh.point }, goalX: fromFresh.goalX }
				: null,
			lineBoxes: serializeLineBoxes(args.from.blockId, current.reader),
		};
	} finally {
		fresh.dispose();
	}
}

function remoteCaretRequests(
	points: readonly GeometryPoint[],
): OverlayRequest[] {
	return points.map((point, index) => ({
		kind: "caret",
		key: `remote-caret:${index}`,
		role: "remote",
		point,
		// Remote cursors carry no affinity; downstream is the stated default.
		affinity: "downstream",
	}));
}

function countLayoutReads(
	scheduler: DomScheduler,
	onRead: (phase: DomScheduler["phase"]) => void,
): () => void {
	const restorers: Array<() => void> = [];
	const wrap = (target: object, key: string): void => {
		const original = (target as Record<string, unknown>)[key];
		if (typeof original !== "function") {
			return;
		}
		const method = original as (
			this: unknown,
			...args: unknown[]
		) => unknown;
		(target as Record<string, unknown>)[key] = function (
			this: unknown,
			...args: unknown[]
		) {
			onRead(scheduler.phase);
			return method.apply(this, args);
		};
		restorers.push(() => {
			(target as Record<string, unknown>)[key] = original;
		});
	};
	wrap(Element.prototype, "getBoundingClientRect");
	wrap(Element.prototype, "getClientRects");
	wrap(Range.prototype, "getBoundingClientRect");
	wrap(Range.prototype, "getClientRects");
	return () => {
		for (const restore of restorers) {
			restore();
		}
	};
}

export async function flushEightRemoteCarets(
	points: readonly GeometryPoint[],
): Promise<GeometryEightCaretBudget> {
	const current = ensureGeometry();
	const overlay = rootOverlay(current.root);

	const types = supportedEntryTypes();
	const missingObserverTypes = ["layout-shift", "longtask"].filter(
		(type) => !types.includes(type),
	);
	const layoutShift = observeEntries("layout-shift");
	const longTask = observeEntries("longtask");

	let readPhase = current.scheduler.phase;
	let writePhase = current.scheduler.phase;
	let plan: OverlayPaintPlan | null = null;
	let readPhaseMeasureCount = 0;
	let writePhaseMeasureCount = 0;
	const restoreReads = countLayoutReads(current.scheduler, (phase) => {
		if (phase === "read") {
			readPhaseMeasureCount += 1;
		} else if (phase === "write") {
			writePhaseMeasureCount += 1;
		}
	});
	const stopPlan = overlay.onPaintPlan((next) => {
		writePhase = current.scheduler.phase;
		plan = next;
	});

	try {
		// The production overlay resolves these requests in its read phase
		// and paints them in the write phase of the same flush; the queued
		// read resolves once that flush has finished.
		releaseRemoteCarets?.();
		const requests = remoteCaretRequests(points);
		releaseRemoteCarets = overlay.registerContributor({
			id: REMOTE_CARET_CONTRIBUTOR,
			requests: () => {
				readPhase = current.scheduler.phase;
				return requests;
			},
		});
		overlay.requestPaint();
		await current.scheduler.read(() => {});
	} finally {
		restoreReads();
		stopPlan();
	}

	// Assigned in the onPaintPlan callback, which control-flow analysis cannot see.
	const painted = plan as OverlayPaintPlan | null;
	const items = (painted?.items ?? []).filter(
		(item) => item.contributor === REMOTE_CARET_CONTRIBUTOR,
	);
	// Items are layer-relative (OV2); the origin turns them back into the
	// viewport boxes the scenario compares against.
	const origin = overlay.layer.getBoundingClientRect();

	// layout-shift / longtask entries are delivered after the current task
	// and the next presented frame. same-turn takeRecords() always returns [].
	await new Promise<void>((resolve) => {
		requestAnimationFrame(() => resolve());
	});

	const layoutShiftEntries = layoutShift?.take() ?? [];
	const longTaskEntries = longTask?.take() ?? [];
	layoutShift?.disconnect();
	longTask?.disconnect();

	return {
		caretCount: points.length,
		paintedCount: overlay.layer.querySelectorAll(
			`[${OVERLAY_ITEM_ATTR}="caret"]`,
		).length,
		overlayConnected: overlay.layer.isConnected,
		overlayAttr: overlay.layer.getAttribute(OVERLAY_LAYER_ATTR),
		layerOrigin: { x: origin.x, y: origin.y },
		readPhase,
		writePhase,
		items: items.map((item) => ({
			id: item.key,
			kind: item.kind,
			x: item.x,
			y: item.y,
			width: item.width,
			height: item.height,
		})),
		readPhaseMeasureCount,
		writePhaseMeasureCount,
		supportedEntryTypes: types,
		layoutShiftSupported: layoutShift != null,
		longTaskSupported: longTask != null,
		layoutShiftCount: layoutShiftEntries.length,
		longTaskCount: longTaskEntries.length,
		layoutShiftValues: layoutShiftEntries.map((entry) =>
			"value" in entry && typeof entry.value === "number"
				? entry.value
				: 0,
		),
		missingObserverTypes,
	};
}

/** OV4 retries at most this many flushes while the record moves under the paint. */
const OVERLAY_SETTLE_FLUSHES = 3;

/**
 * OV4: wait for a scheduler flush (an empty queued read; its continuation runs
 * after the whole flush, overlay paint included, and unlike a queued write it
 * does not trigger the stale-after-write follow-up paint), then compare the layer's painted selection
 * version and local caret with the authority record. A record that moved
 * during the flush gets up to three more flushes; no clock is involved.
 */
export async function overlayMatchesAuthority(
	editor: Editor,
): Promise<OverlayAuthorityCheck> {
	const root = document.querySelector(ROOT_SELECTOR);
	const overlay = root instanceof HTMLElement ? getRootOverlay(root) : null;
	if (!(root instanceof HTMLElement) || !overlay) {
		const hasFieldEditor = editor.facet(fieldEditorHostFacet) != null;
		return {
			kind: hasFieldEditor ? "failed" : "no-overlay",
			reason: hasFieldEditor
				? "a field editor is attached but the root has no overlay layer"
				: "no field editor attached; nothing paints an overlay",
			layerVersion: null,
			recordVersion: null,
			caret: null,
			expectedCaret: null,
		};
	}
	const { scheduler } = getRootGeometry(root);
	let check: OverlayAuthorityCheck | null = null;
	for (let attempt = 0; attempt < OVERLAY_SETTLE_FLUSHES; attempt += 1) {
		await scheduler.read(() => {});
		check = compareOverlay(overlay.layer, editor);
		if (check.kind === "held") {
			return check;
		}
	}
	return check!;
}

function compareOverlay(layer: HTMLElement, editor: Editor): OverlayAuthorityCheck {
	const record = getEditorSelectionRecord(editor);
	const versionAttr = layer.getAttribute("data-pen-overlay-selection-version");
	const layerVersion = versionAttr === null ? null : Number(versionAttr);
	const recordVersion = record?.version ?? null;
	const caretNode = layer.querySelector("[data-pen-editor-caret]");
	const caret =
		caretNode instanceof HTMLElement
			? {
					blockId: caretNode.getAttribute("data-block-id") ?? "",
					offset: Number(caretNode.getAttribute("data-offset")),
					affinity: caretNode.getAttribute("data-affinity") ?? "",
				}
			: null;
	const state = record?.state ?? null;
	const expectedCaret =
		state?.type === "text"
			? {
					blockId: state.focus.blockId,
					offset: state.focus.offset,
					affinity: state.affinity,
				}
			: null;
	const base = { layerVersion, recordVersion, caret, expectedCaret };
	if (layerVersion !== recordVersion) {
		return {
			kind: "failed",
			reason: `layer painted version ${String(layerVersion)}, authority is at ${String(recordVersion)}`,
			...base,
		};
	}
	if (
		caret &&
		(!expectedCaret ||
			caret.blockId !== expectedCaret.blockId ||
			caret.offset !== expectedCaret.offset ||
			caret.affinity !== expectedCaret.affinity)
	) {
		return {
			kind: "failed",
			reason: "the local caret does not name the record's focus point and affinity",
			...base,
		};
	}
	return { kind: "held", reason: "layer version and local caret match the record", ...base };
}

type OverlayProbe = {
	readonly flushesAtStart: number;
	readonly paintsAtStart: number;
	readonly counts: {
		caretRectReads: number;
		blockRectReads: number;
		layerMutations: number;
		layerAttributeWrites: number;
	};
	readonly perFlush: Map<number, { caret: number; block: number }>;
	readonly observer: MutationObserver;
	readonly layer: HTMLElement;
	readonly restore: () => void;
	readonly scheduler: DomScheduler;
};

let overlayProbe: OverlayProbe | null = null;

/**
 * OV1 counters: the root scheduler's flush and paint counts, calls to the
 * root reader's `caretRect` and `blockRect` (wrapped on the instance), and
 * mutation records under the overlay layer.
 */
export function startOverlayProbe(): void {
	stopOverlayProbe();
	const root = editorRoot();
	const overlay = rootOverlay(root);
	const { reader, scheduler } = getRootGeometry(root);
	const counts = {
		caretRectReads: 0,
		blockRectReads: 0,
		layerMutations: 0,
		layerAttributeWrites: 0,
	};
	const perFlush = new Map<number, { caret: number; block: number }>();
	const flushTally = () => {
		const flush = scheduler.diagnostics.flushCount;
		const tally = perFlush.get(flush) ?? { caret: 0, block: 0 };
		perFlush.set(flush, tally);
		return tally;
	};
	// Only reads made by the overlay's own read step count: the projector
	// and scroll jobs share this reader. The root overlay is the scheduler's
	// painter, so its `read` brackets them.
	const painter = overlay as unknown as OverlayPainter;
	const overlayRead = painter.read;
	let inOverlayRead = false;
	painter.read = (input) => {
		inOverlayRead = true;
		try {
			overlayRead.call(painter, input);
		} finally {
			inOverlayRead = false;
		}
	};
	const caretRect = reader.caretRect;
	const blockRect = reader.blockRect;
	reader.caretRect = (point, affinity) => {
		if (inOverlayRead) {
			counts.caretRectReads += 1;
			flushTally().caret += 1;
		}
		return caretRect.call(reader, point, affinity);
	};
	reader.blockRect = (blockId) => {
		if (inOverlayRead) {
			counts.blockRectReads += 1;
			flushTally().block += 1;
		}
		return blockRect.call(reader, blockId);
	};
	// Item mutations: the layer's own OV4 bookkeeping attributes
	// (`data-pen-overlay-selection-version`, `data-caret-visible`) are
	// counted apart, since every selection change writes the version.
	const observer = new MutationObserver((records) => {
		for (const record of records) {
			if (record.type === "attributes" && record.target === overlay.layer) {
				counts.layerAttributeWrites += 1;
			} else {
				counts.layerMutations += 1;
			}
		}
	});
	observer.observe(overlay.layer, {
		attributes: true,
		childList: true,
		characterData: true,
		subtree: true,
	});
	overlayProbe = {
		flushesAtStart: scheduler.diagnostics.flushCount,
		paintsAtStart: scheduler.diagnostics.paintCount,
		counts,
		perFlush,
		observer,
		layer: overlay.layer,
		scheduler,
		restore: () => {
			delete (reader as Partial<typeof reader>).caretRect;
			delete (reader as Partial<typeof reader>).blockRect;
			delete (painter as Partial<OverlayPainter>).read;
		},
	};
}

export function stopOverlayProbe(): OverlayProbeCounts {
	const probe = overlayProbe;
	overlayProbe = null;
	if (!probe) {
		return {
			flushes: 0,
			paints: 0,
			caretRectReads: 0,
			blockRectReads: 0,
			maxCaretRectReadsPerFlush: 0,
			maxBlockRectReadsPerFlush: 0,
			layerMutations: 0,
			layerAttributeWrites: 0,
		};
	}
	for (const record of probe.observer.takeRecords()) {
		if (record.type === "attributes" && record.target === probe.layer) {
			probe.counts.layerAttributeWrites += 1;
		} else {
			probe.counts.layerMutations += 1;
		}
	}
	probe.observer.disconnect();
	probe.restore();
	return {
		flushes: probe.scheduler.diagnostics.flushCount - probe.flushesAtStart,
		paints: probe.scheduler.diagnostics.paintCount - probe.paintsAtStart,
		...probe.counts,
		maxCaretRectReadsPerFlush: Math.max(
			0,
			...[...probe.perFlush.values()].map((tally) => tally.caret),
		),
		maxBlockRectReadsPerFlush: Math.max(
			0,
			...[...probe.perFlush.values()].map((tally) => tally.block),
		),
	};
}
