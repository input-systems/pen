import { autocompleteExtension } from "@input/pen-ai/autocomplete";
import {
	createEditor,
	createHeadlessEditor,
	createPseudoLocaleCatalog,
	buildLazyNormalPositionSnapshot,
	fieldEditorHostFacet,
	getEditorSelectionRecord,
	isCollapsed as selectionIsCollapsed,
} from "@input/pen-core";
import { wrapYjsDocument, yjsAdapter } from "@input/pen-yjs";
import {
	applyYjsAwarenessUpdate,
	createYjsAwareness,
	encodeYjsAwarenessUpdate,
} from "@input/pen-yjs/awareness";
import {
	BEFOREINPUT_MAP,
	mapBeforeInput,
} from "@input/pen-dom/field-editor/beforeinputMap";
import { domSelectionToEditor } from "@input/pen-dom/field-editor";
import { applyValidatedOps } from "@input/pen-tools";
import { parsePenClipboardPayload } from "@input/pen-dom/utils/clipboardPayload";
import {
	clearInlineAtomDragPreview,
	createInlineAtomDragPreview,
} from "@input/pen-dom/utils/inlineAtomDragPreview";
import { htmlImporter } from "@input/pen-interop/html";
import { defaultPreset } from "@input/pen";
import { defaultSchema } from "@input/pen-schema";
import {
	createDeterministicYDocFixture,
	generateMixedBlockSpecs,
	mixedFixtureOps,
	populateYDoc,
} from "@input/pen-test";
import { getRootBlockIds } from "@input/pen-dom/utils/parentIdTree";
import {
	type CRDTAdapter,
	type CRDTDocument,
	type DiagnosticEvent,
	type DocumentOp,
	type Editor,
	type FieldEditor,
	type Unsubscribe,
} from "@input/pen-types";
import * as Y from "yjs";
import { compileRangeReplacementSuggestionOps } from "../../../../extensions/ai/src/suggestions/textDiffOperations";
import {
	getMultiplayerController,
	multiplayerExtension,
} from "../../../../extensions/multiplayer/src";
import { createReducedMotionSignal } from "../../../../rendering/dom/src/a11y/motion";
import {
	isFixtureName,
	isLocalFixtureName,
	isScaleFixtureName,
	SCALE_FIXTURE_ROOT_COUNTS,
	LOCAL_FIXTURES,
	WINDOWED_WINDOW_SIZE,
} from "../../fixtures/catalog";
import { clampWindowStart } from "../../src/windowedRange";
import type {
	BeforeInputDispatchResult,
	ConformanceEventRecord,
	DocumentContentSnapshot,
	DomAuthorityCheck,
	ForcedDomDivergence,
	HostileDomScan,
	LogicalPoint,
	PenConformanceBridge,
	PresencePeerInject,
	PresenceSnapshot,
	RemoteSpliceArgs,
	RemoteYInjectArgs,
	SerializedBeforeInputMapping,
	SerializedDiagnostic,
} from "../../src/types";
import { connectPeers } from "../../src/connectPeers";
import { instrumentSessionEditor } from "./probes/index";
import {
	misplacedOffset,
	pointsEqual,
	resolveDomAuthorityCheck,
	type ExtendedS2Observations,
} from "./domAuthorityCompare";
import {
	isLogicallyEquivalent,
	readNormalizedDomProposal,
} from "../../../../rendering/dom/src/field-editor/selectionReader";
// The public `editorSelectionToDOM` is gone (S1); the harness writes through
// the projector's native-range primitive as its test-side writer.
import { writeNativeRange } from "../../../../rendering/dom/src/field-editor/selectionProjector";
import {
	serializeDiagnostic,
	serializeSelection,
	serializeSelectionRecord,
} from "./serialize";
import {
	compareCaretCache,
	disposeGeometry,
	flushEightRemoteCarets,
	geometryBlocks,
	geometryGeneration,
	geometryLineBoxes,
	invalidateGeometry,
	runVerticalMotion,
	warmCaretCache,
} from "./geometry";

const LAST_EVENTS_CAP = 32;
const DIAGNOSTICS_CAP = 64;

export type Session = {
	editor: Editor;
	remoteEditor: Editor;
	localY: Y.Doc;
	remoteY: Y.Doc;
	fixtureName: string;
	generation: number;
	lastEvents: ConformanceEventRecord[];
	diagnostics: SerializedDiagnostic[];
	unsubscribers: Unsubscribe[];
	disconnectPeers: () => void;
	brokenProjection: DomAuthorityCheck | null;
};

let session: Session | null = null;
const listeners = new Set<() => void>();
let windowStart = 0;
let reducedMotionSignal: ReturnType<typeof createReducedMotionSignal> | null =
	null;

function notify(): void {
	for (const listener of listeners) {
		listener();
	}
}

export function subscribeHarness(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function getHarnessSession(): Session {
	if (!session) {
		session = createSession("hello-world");
		installBridge();
	}
	return session;
}

function createLocalDocument(name: string): {
	adapter: CRDTAdapter;
	ydoc: Y.Doc;
	document: CRDTDocument;
} {
	if (!isFixtureName(name)) {
		throw new Error(`Unknown conformance fixture: ${name}`);
	}
	if (name === "deterministic") {
		const fixture = createDeterministicYDocFixture();
		return {
			adapter: fixture.crdtDoc.adapter,
			ydoc: fixture.ydoc,
			document: fixture.crdtDoc,
		};
	}
	const adapter = yjsAdapter({ awareness: createYjsAwareness });
	const ydoc = new Y.Doc({ gc: false });
	if (isScaleFixtureName(name)) {
		populateYDoc(ydoc, generateMixedBlockSpecs(SCALE_FIXTURE_ROOT_COUNTS[name]));
		return { adapter, ydoc, document: wrapYjsDocument(adapter, ydoc) };
	}
	if (!isLocalFixtureName(name)) {
		throw new Error(`Unknown conformance fixture: ${name}`);
	}
	populateYDoc(ydoc, [...LOCAL_FIXTURES[name]]);
	return {
		adapter,
		ydoc,
		document: wrapYjsDocument(adapter, ydoc),
	};
}

function readQueryFlag(name: string): boolean {
	if (typeof window === "undefined") {
		return false;
	}
	return new URLSearchParams(window.location.search).get(name) === "1";
}

function readPseudoLocaleMessages() {
	if (!readQueryFlag("pseudoLocale")) {
		return undefined;
	}
	return createPseudoLocaleCatalog();
}

function ax3AutocompleteExtensions() {
	if (!readQueryFlag("ax3")) {
		return undefined;
	}
	return [
		autocompleteExtension({
			debounceMs: 0,
			prefetchAfterAccept: false,
			model: {
				async *stream() {
					yield { type: "text-delta" as const, delta: " completion" };
					yield { type: "done" as const };
				},
			},
		}),
	];
}

function col2MultiplayerExtensions() {
	if (!readQueryFlag("col2")) {
		return undefined;
	}
	return [
		multiplayerExtension({
			user: { id: "conformance-local", name: "Local" },
		}),
	];
}

function sessionExtensions() {
	const extensions = [
		...(ax3AutocompleteExtensions() ?? []),
		...(col2MultiplayerExtensions() ?? []),
	];
	return extensions.length > 0 ? extensions : undefined;
}

function createSession(fixtureName: string): Session {
	const local = createLocalDocument(fixtureName);
	const remoteAdapter = yjsAdapter({ awareness: createYjsAwareness });
	const remoteY = new Y.Doc({ gc: false });
	Y.applyUpdate(remoteY, Y.encodeStateAsUpdate(local.ydoc));
	const remoteDoc = wrapYjsDocument(remoteAdapter, remoteY);
	const disconnectPeers = connectPeers(local.ydoc, remoteY);

	const editor = createEditor({
		documentProfile: "structured",
		preset: defaultPreset(),
		crdt: local.adapter,
		document: local.document,
		messages: readPseudoLocaleMessages(),
		extensions: sessionExtensions(),
	});
	instrumentSessionEditor(editor);
	const remoteEditor = createHeadlessEditor({
		documentProfile: "structured",
		schema: defaultSchema,
		crdt: remoteAdapter,
		document: remoteDoc,
	});

	const next: Session = {
		editor,
		remoteEditor,
		localY: local.ydoc,
		remoteY,
		fixtureName,
		generation: (session?.generation ?? 0) + 1,
		lastEvents: [],
		diagnostics: [],
		unsubscribers: [],
		disconnectPeers,
		brokenProjection: null,
	};
	wireEvents(next);
	if (isScaleFixtureName(fixtureName)) {
		// Tables and marks need editor.apply (populateYDoc drops them). This runs
		// before any surface mounts, so construction is never measured.
		editor.apply(mixedFixtureOps(SCALE_FIXTURE_ROOT_COUNTS[fixtureName]), {
			origin: "system",
		});
	}
	return next;
}

function recordEvent(target: Session, type: string, payload: unknown): void {
	target.lastEvents.push({ type, payload });
	if (target.lastEvents.length > LAST_EVENTS_CAP) {
		target.lastEvents.shift();
	}
}

function wireEvents(target: Session): void {
	const editor = target.editor;
	target.unsubscribers.push(
		editor.on("commit", (event) => {
			recordEvent(target, "commit", {
				commitId: event.commitId,
				origin: event.origin,
				affectedBlockIds: [...event.summary.affectedBlockIds],
			});
		}),
		editor.on("selectionChange", () => {
			// Do not read the event argument: another lane is changing the
			// payload from SelectionState to SelectionRecord (A3).
			recordEvent(
				target,
				"selectionChange",
				serializeSelection(editor.selection),
			);
		}),
		editor.on("historyApplied", (event) => {
			recordEvent(target, "historyApplied", {
				kind: event.kind,
				requestId: event.requestId,
			});
		}),
		editor.on("diagnostic", (event: DiagnosticEvent) => {
			target.diagnostics.push(serializeDiagnostic(event));
			if (target.diagnostics.length > DIAGNOSTICS_CAP) {
				target.diagnostics.shift();
			}
			recordEvent(target, "diagnostic", serializeDiagnostic(event));
		}),
	);
}

function destroySession(target: Session): void {
	for (const unsubscribe of target.unsubscribers) {
		unsubscribe();
	}
	target.disconnectPeers();
	target.editor.destroy();
	target.remoteEditor.destroy();
	target.localY.destroy();
	target.remoteY.destroy();
}

export function getWindowStart(): number {
	return windowStart;
}

export function setWindowStart(start: number): void {
	const blockCount = getHarnessSession().editor.documentState.blockOrder.length;
	const next = clampWindowStart(start, blockCount, WINDOWED_WINDOW_SIZE);
	if (next === windowStart) {
		return;
	}
	windowStart = next;
	notify();
}

function reducedMotion(): boolean {
	if (!reducedMotionSignal) {
		reducedMotionSignal = createReducedMotionSignal();
	}
	return reducedMotionSignal.reduced;
}

export function loadFixture(name: string): void {
	disposeGeometry();
	if (session) {
		destroySession(session);
	}
	windowStart = 0;
	session = createSession(name);
	installBridge();
	notify();
}

function editorRoot(): HTMLElement | null {
	const root = document.querySelector("[data-pen-editor-root]");
	return root instanceof HTMLElement ? root : null;
}

function mountSelectionProbe(text: string, blockId: string): HTMLElement {
	const root = document.createElement("div");
	root.setAttribute("data-pen-editor-root", "");
	const block = document.createElement("div");
	block.setAttribute("data-pen-editor-block", "");
	block.setAttribute("data-block-id", blockId);
	block.setAttribute("data-block-type", "paragraph");
	const inline = document.createElement("span");
	inline.setAttribute("data-pen-inline-content", "");
	inline.textContent = text;
	block.append(inline);
	root.append(block);
	document.body.append(root);
	return root;
}

function editorHasFocus(root: HTMLElement): boolean {
	const active = document.activeElement;
	return active instanceof Node && root.contains(active);
}

function checkDomMatchesAuthority(): DomAuthorityCheck {
	const current = getHarnessSession();
	const root = editorRoot();
	if (!root) {
		return { ok: false, reason: "editor root is not mounted" };
	}
	if (current.brokenProjection) {
		return current.brokenProjection;
	}
	return resolveDomAuthorityCheck({
		hasRoot: true,
		hasFocus: editorHasFocus(root),
		authority: serializeSelection(current.editor.selection),
		mapped: domSelectionToEditor(root),
		extended: observeExtendedS2(current.editor, root),
	});
}

/** W3.R2: what the extended standing S2 check needs from the page. */
function observeExtendedS2(editor: Editor, root: HTMLElement): ExtendedS2Observations {
	return {
		composing: isFieldComposing(editor),
		nativeRangeInRoot: hasNativeRangeIn(root),
		focusedSinkRole: focusedSinkRole(root),
		equivalent: isDomEquivalentToText(editor, root),
	};
}

function isFieldComposing(editor: Editor): boolean {
	const fieldEditor = editor.facet(fieldEditorHostFacet) as { getSnapshot?: () => { isComposing: boolean } } | null;
	return fieldEditor?.getSnapshot?.().isComposing === true;
}

function hasNativeRangeIn(root: HTMLElement): boolean {
	const native = document.getSelection();
	if (!native || native.rangeCount === 0) return false;
	return [native.anchorNode, native.focusNode].some((node) => node !== null && root.contains(node));
}

function focusedSinkRole(root: HTMLElement): string | null {
	const active = document.activeElement;
	if (!(active instanceof HTMLElement) || !root.contains(active)) return null;
	const role = active.getAttribute("role");
	return role === "group" || role === "grid" ? role : null;
}

function isDomEquivalentToText(editor: Editor, root: HTMLElement): boolean {
	const record = editor.selection;
	if (record?.type !== "text") return false;
	return isLogicallyEquivalent(
		readNormalizedDomProposal(root, editor),
		{ type: "text", anchor: record.anchor, focus: record.focus },
		buildLazyNormalPositionSnapshot(editor),
	);
}

/**
 * W3.R1 fault injection: the next native selection write is dropped, as an
 * engine that rejects it would, and every write is counted from here on, so a
 * scenario can assert one report and no retry.
 */
function installSelectionWriteFault(): void {
	const counters = { dropped: 0, writes: 0 };
	(window as unknown as { __penSelectionWriteFault: typeof counters }).__penSelectionWriteFault = counters;
	const proto = Selection.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
	for (const key of ["setBaseAndExtent", "collapse", "addRange"]) {
		const original = proto[key];
		proto[key] = function (this: Selection, ...args: unknown[]) {
			counters.writes += 1;
			if (counters.dropped === 0) {
				counters.dropped = 1;
				return undefined;
			}
			return original.apply(this, args);
		};
	}
}

function selectionWriteFaultCounters(): { dropped: number; writes: number } {
	return (
		(window as unknown as { __penSelectionWriteFault?: { dropped: number; writes: number } })
			.__penSelectionWriteFault ?? { dropped: 0, writes: 0 }
	);
}

function installBrokenProjector(): void {
	const current = getHarnessSession();
	const root = editorRoot();
	if (!root) {
		throw new Error("broken projector stub: editor root is not mounted");
	}
	let authority = serializeSelection(current.editor.selection);
	if (authority == null || authority.type !== "text") {
		const firstId = current.editor.documentState.blockAt(0);
		if (!firstId) {
			throw new Error("broken projector stub: document has no blocks");
		}
		current.editor.selectText(firstId, 0, 0);
		authority = serializeSelection(current.editor.selection);
	}
	if (authority == null || authority.type !== "text") {
		throw new Error("broken projector stub: could not establish a text selection");
	}

	const block = current.editor.getBlock(authority.anchor.blockId);
	const length = block?.length() ?? 0;
	const offset = misplacedOffset(authority.anchor.offset, length);
	const wrong = { blockId: authority.anchor.blockId, offset };
	writeNativeRange(root, wrong, wrong);

	const mapped = domSelectionToEditor(root);
	const mismatch: DomAuthorityCheck = {
		ok: false,
		reason: "broken projector stub: DOM selection does not match authority",
		authority,
		dom: mapped,
	};
	if (
		mapped &&
		pointsEqual(mapped.anchor, authority.anchor) &&
		pointsEqual(mapped.focus, authority.focus)
	) {
		throw new Error("broken projector stub failed to misplace DOM selection");
	}
	current.brokenProjection = mismatch;
}

function forceUnwindowedDomDivergence(): ForcedDomDivergence {
	const current = getHarnessSession();
	const root = editorRoot();
	const record = getEditorSelectionRecord(current.editor);
	const authority = serializeSelection(current.editor.selection);
	const version = record?.version ?? null;

	if (!root) {
		return {
			created: false,
			focused: false,
			reason: "editor root is not mounted",
			version,
			authority,
			observed: null,
		};
	}

	const focused = editorHasFocus(root);
	if (!focused) {
		return {
			created: false,
			focused: false,
			reason: "editor is unfocused",
			version,
			authority,
			observed: null,
		};
	}

	if (authority == null || authority.type !== "text") {
		return {
			created: false,
			focused,
			reason: "authority is not a collapsed text caret",
			version,
			authority,
			observed: null,
		};
	}

	const block = current.editor.getBlock(authority.anchor.blockId);
	const length = block?.length() ?? 0;
	const offset = misplacedOffset(authority.anchor.offset, length);
	if (
		offset === authority.anchor.offset &&
		offset === authority.focus.offset
	) {
		return {
			created: false,
			focused,
			reason: "could not pick a different offset",
			version,
			authority,
			observed: null,
		};
	}

	const wrong = { blockId: authority.anchor.blockId, offset };
	const capture: {
		observed: { anchor: LogicalPoint; focus: LogicalPoint } | null;
	} = { observed: null };
	const onChange = (): void => {
		capture.observed = domSelectionToEditor(root);
	};
	root.ownerDocument.addEventListener("selectionchange", onChange, true);
	try {
		writeNativeRange(root, wrong, wrong);
	} finally {
		root.ownerDocument.removeEventListener(
			"selectionchange",
			onChange,
			true,
		);
	}

	const observed = capture.observed;
	if (
		observed &&
		pointsEqual(observed.anchor, authority.anchor) &&
		pointsEqual(observed.focus, authority.focus)
	) {
		return {
			created: false,
			focused,
			reason: "forced native selection never left the authority",
			version,
			authority,
			observed,
		};
	}
	if (!observed) {
		const mapped = domSelectionToEditor(root);
		if (
			mapped &&
			(!pointsEqual(mapped.anchor, authority.anchor) ||
				!pointsEqual(mapped.focus, authority.focus))
		) {
			return {
				created: true,
				focused,
				version,
				authority,
				observed: mapped,
			};
		}
		return {
			created: false,
			focused,
			reason: "no selectionchange observed after the native write",
			version,
			authority,
			observed: mapped,
		};
	}

	return {
		created: true,
		focused,
		version,
		authority,
		observed,
	};
}

function remoteSplice(args: RemoteSpliceArgs): void {
	const current = getHarnessSession();
	const blockId = current.remoteEditor.documentState.blockAt(args.block);
	if (!blockId) {
		throw new Error(`remote.splice: no block at index ${args.block}`);
	}
	const from = Math.min(args.from, args.to);
	const to = Math.max(args.from, args.to);
	const ops = [];
	if (to > from) {
		ops.push({
			type: "splice-text" as const,
			blockId,
			from: from,
				to: from + to - from,
				insert: "",
		});
	}
	if (args.insert.length > 0) {
		ops.push({
			type: "splice-text" as const,
			blockId,
			from: from,
				to: from,
				insert: args.insert,
		});
	}
	if (ops.length === 0) {
		return;
	}
	current.remoteEditor.apply(ops, { origin: "collaborator" });
}

function remoteInjectY(args: RemoteYInjectArgs): void {
	const current = getHarnessSession();
	current.remoteY.transact(() => {
		const blocks = current.remoteY.getMap("blocks") as Y.Map<Y.Map<unknown>>;
		if (args.link) {
			const block = blocks.get(args.link.blockId);
			const content = block?.get("content");
			if (!(content instanceof Y.Text)) {
				throw new Error(
					`remote.injectY: block "${args.link.blockId}" has no Y.Text content`,
				);
			}
			content.format(0, content.length, {
				link: { href: args.link.href },
			});
		}
		if (args.image) {
			const block = new Y.Map<unknown>();
			block.set("type", "image");
			const props = new Y.Map<unknown>();
			props.set("src", args.image.src);
			props.set("alt", "x");
			block.set("props", props);
			block.set("meta", new Y.Map<unknown>());
			blocks.set(args.image.blockId, block);
			current.remoteY
				.getArray<string>("blockOrder")
				.push([args.image.blockId]);
		}
	});
}

function documentText(): string {
	const current = getHarnessSession();
	const parts: string[] = [];
	for (const block of current.editor.documentState.allBlocks()) {
		parts.push(block.textContent());
	}
	return parts.join("\n");
}

function blockIds(): string[] {
	return [...getHarnessSession().editor.documentState.blockOrder];
}

const URL_ATTRIBUTE_NAMES = [
	"href",
	"src",
	"xlink:href",
	"action",
	"formaction",
	"cite",
	"style",
] as const;

function installXssProbe(): void {
	window.__xssProbeTripped = false;
	window.__xssProbe = () => {
		window.__xssProbeTripped = true;
	};
}

function resetXssProbe(): void {
	window.__xssProbeTripped = false;
}

function focusText(block = 0): void {
	const current = getHarnessSession();
	const blockId = current.editor.documentState.blockAt(block);
	if (!blockId) {
		throw new Error(`focusText: no block at index ${block}`);
	}
	const fieldEditor = current.editor.facet(fieldEditorHostFacet) as
		| FieldEditor
		| null;
	if (!fieldEditor) {
		throw new Error("focusText: field editor is not attached");
	}
	current.editor.selectText(blockId, 0, 0);
	fieldEditor.activate(blockId);
	fieldEditor.focus({ reason: "programmatic" });
}

function selectText(block: number, offset = 0): void {
	const current = getHarnessSession();
	const blockId = current.editor.documentState.blockAt(block);
	if (!blockId) {
		throw new Error(`selectText: no block at index ${block}`);
	}
	current.editor.selectText(blockId, offset, offset);
}

function applyOps(ops: readonly DocumentOp[]): void {
	getHarnessSession().editor.apply([...ops], { origin: "user" });
}

function selectTextById(
	blockId: string,
	anchorOffset: number,
	focusOffset = anchorOffset,
): void {
	getHarnessSession().editor.selectText(blockId, anchorOffset, focusOffset);
}

/** Clock runs disconnect the in-page peer so its sync is not measured. */
function setPeersConnected(connected: boolean): void {
	const current = getHarnessSession();
	current.disconnectPeers();
	current.disconnectPeers = connected
		? connectPeers(current.localY, current.remoteY)
		: () => {};
}

function remoteApply(ops: readonly DocumentOp[]): void {
	getHarnessSession().remoteEditor.apply([...ops], { origin: "collaborator" });
}

function encodePeerPresence(
	clientId: number,
	state: Record<string, unknown>,
): Uint8Array {
	const adapter = yjsAdapter({ awareness: createYjsAwareness });
	const ydoc = new Y.Doc({ gc: false });
	ydoc.clientID = clientId;
	const document = wrapYjsDocument(adapter, ydoc);
	const awareness = adapter.createAwareness?.(document);
	if (!awareness) {
		throw new Error("injectPresence: adapter has no awareness");
	}
	try {
		awareness.setLocalState(state);
		return encodeYjsAwarenessUpdate(awareness, [clientId]);
	} finally {
		awareness.destroy();
		ydoc.destroy();
	}
}

function serializePresenceAnchor(blockId: string, offset: number): string {
	const minted = getHarnessSession().editor.anchors.create(
		{ blockId, offset },
		1,
	);
	if (minted === null) {
		throw new Error(
			`serializePresenceAnchor: could not mint at ${blockId}:${offset}`,
		);
	}
	return getHarnessSession().editor.anchors.serialize(minted);
}

function presenceSnapshot(): PresenceSnapshot {
	const controller = getMultiplayerController(getHarnessSession().editor);
	if (!controller) {
		return { cursors: [], peers: [] };
	}
	return {
		cursors: controller.getRemoteCursors().map((cursor) => ({
			clientId: cursor.clientId,
			userId: cursor.user.id,
			userName: cursor.user.name,
			...(cursor.user.avatar ? { avatar: cursor.user.avatar } : {}),
			blockId: cursor.blockId,
			offset: cursor.offset,
		})),
		peers: controller.getPeers().map((peer) => ({
			clientId: peer.clientId,
			userId: peer.user.id,
			userName: peer.user.name,
			...(peer.user.avatar ? { avatar: peer.user.avatar } : {}),
		})),
	};
}

async function injectPresence(
	peers: readonly PresencePeerInject[],
): Promise<PresenceSnapshot> {
	const current = getHarnessSession();
	await current.editor.whenReady();
	const awareness = current.editor.internals.awareness;
	if (!awareness) {
		throw new Error("injectPresence: editor has no awareness");
	}
	const localClientId = current.editor.clientId;
	for (const peer of peers) {
		if (peer.clientId === localClientId) {
			throw new Error(
				`injectPresence: clientId ${peer.clientId} collides with the local editor`,
			);
		}
		applyYjsAwarenessUpdate(
			awareness,
			encodePeerPresence(peer.clientId, peer.state),
		);
	}
	current.editor.requestDecorationUpdate();
	return presenceSnapshot();
}

function applyToolPayloads(
	payloads: readonly unknown[],
): { ok: boolean; message?: string } {
	try {
		applyValidatedOps(getHarnessSession().editor, payloads);
		return { ok: true };
	} catch (error) {
		return {
			ok: false,
			message: error instanceof Error ? error.message : String(error),
		};
	}
}

async function importHtml(html: string): Promise<void> {
	await htmlImporter.import(html, getHarnessSession().editor);
}

function applyAiRangeReplacement(args: {
	start: { blockId: string; offset: number };
	end: { blockId: string; offset: number };
	replacementText: string;
}): void {
	const current = getHarnessSession();
	const blocks = current.editor.documentState.blockOrder.map((id) => ({
		id,
		text: current.editor.getBlock(id)?.textContent() ?? "",
	}));
	const ops = compileRangeReplacementSuggestionOps({
		range: { start: args.start, end: args.end },
		blocks,
		replacementText: args.replacementText,
	});
	current.editor.apply(ops, { origin: "ai" });
}

function parseClipboardPayload(raw: unknown): { status: string } {
	return { status: parsePenClipboardPayload(raw).status };
}

function exerciseInlineAtomDragPreview(): {
	filled: string;
	emptied: boolean;
} {
	const source = document.createElement("span");
	source.textContent = "Drag preview source";
	document.body.append(source);
	try {
		const preview = createInlineAtomDragPreview({
			sourceElement: source,
			clientX: 12,
			clientY: 12,
		});
		const filled =
			document.querySelector("[data-pen-inline-atom-drag-preview]")
				?.textContent ?? "";
		preview.destroy();
		clearInlineAtomDragPreview(document);
		return {
			filled,
			emptied:
				document.querySelector(
					"[data-pen-inline-atom-drag-preview-root]",
				) == null,
		};
	} finally {
		source.remove();
	}
}

function scanHostileDom(): HostileDomScan {
	const root = editorRoot();
	const urlAttributes: string[] = [];
	if (root) {
		for (const element of root.querySelectorAll("*")) {
			for (const name of URL_ATTRIBUTE_NAMES) {
				const value = element.getAttribute(name);
				if (value) {
					urlAttributes.push(value);
				}
			}
		}
	}
	return {
		urlAttributes,
		javascriptUrls: urlAttributes.filter((value) => /javascript:/i.test(value)),
		blockedUrlCount: root
			? root.querySelectorAll("[data-pen-blocked-url]").length
			: 0,
		probeTripped: Boolean(window.__xssProbeTripped),
	};
}

function beforeinputMap(): Readonly<
	Record<string, SerializedBeforeInputMapping>
> {
	return { ...BEFOREINPUT_MAP };
}

function documentSnapshot(): DocumentContentSnapshot {
	const editor = getHarnessSession().editor;
	return {
		blockOrder: [...editor.documentState.blockOrder],
		blocks: editor.documentState.blockOrder.map((id) => {
			const block = editor.getBlock(id);
			if (!block) {
				throw new Error(`documentSnapshot: missing block ${id}`);
			}
			return {
				id: block.id,
				type: block.type,
				text: block.textContent(),
				props: { ...block.props },
				deltas: block.inlineDeltas(),
			};
		}),
	};
}

function activeSurface(): HTMLElement {
	const root = editorRoot();
	const scoped = root ?? document;
	const contentEditable =
		scoped.querySelector(
			"[data-pen-inline-content][contenteditable='true']",
		) ??
		scoped.querySelector(
			"[data-pen-field-editor-active-surface][contenteditable='true']",
		) ??
		scoped.querySelector("[contenteditable='true']");
	if (contentEditable instanceof HTMLElement) {
		return contentEditable;
	}
	const fallback = scoped.querySelector(
		"[data-pen-field-editor-active-surface], [data-pen-inline-content]",
	);
	if (!(fallback instanceof HTMLElement)) {
		throw new Error("no active field-editor surface");
	}
	return fallback;
}

function dispatchBeforeInput(args: {
	inputType: string;
	data?: string;
}): BeforeInputDispatchResult {
	const surface = activeSurface();
	const event = new InputEvent("beforeinput", {
		bubbles: true,
		cancelable: true,
		inputType: args.inputType,
		data: args.data ?? null,
	});
	try {
		surface.dispatchEvent(event);
		return {
			defaultPrevented: event.defaultPrevented,
			inputType: event.inputType,
			threw: null,
		};
	} catch (error) {
		return {
			defaultPrevented: event.defaultPrevented,
			inputType: event.inputType,
			threw: error instanceof Error ? error.message : String(error),
		};
	}
}

function clearDiagnostics(): void {
	const current = getHarnessSession();
	current.diagnostics.length = 0;
}

function mutateActiveSurfaceText(text: string): void {
	activeSurface().append(text);
}

function installBridge(): void {
	installXssProbe();
	const bridge: PenConformanceBridge = {
		get selection() {
			return serializeSelection(getHarnessSession().editor.selection);
		},
		isCollapsed() {
			return selectionIsCollapsed(getHarnessSession().editor.selection);
		},
		get selectionRecord() {
			return serializeSelectionRecord(
				getEditorSelectionRecord(getHarnessSession().editor),
			);
		},
		get lastEvents() {
			return getHarnessSession().lastEvents;
		},
		get diagnostics() {
			return getHarnessSession().diagnostics;
		},
		get documentText() {
			return documentText();
		},
		get rootBlockIds() {
			return [...getRootBlockIds(getHarnessSession().editor)];
		},
		setPeersConnected,
		selectTextById,
		blockText: (blockId: string) =>
			getHarnessSession().editor.getBlock(blockId)?.textContent() ?? "",
		get blockIds() {
			return blockIds();
		},
		get hasFocus() {
			const root = editorRoot();
			return root != null && editorHasFocus(root);
		},
		get fixtureName() {
			return getHarnessSession().fixtureName;
		},
		get generation() {
			return getHarnessSession().generation;
		},
		get hasFieldEditor() {
			return getHarnessSession().editor.facet(fieldEditorHostFacet) != null;
		},
		get reducedMotion() {
			return reducedMotion();
		},
		get windowRange() {
			return { start: windowStart, size: WINDOWED_WINDOW_SIZE };
		},
		get hasMultiplayer() {
			return getMultiplayerController(getHarnessSession().editor) != null;
		},
		get presence() {
			return presenceSnapshot();
		},
		load(name: string) {
			loadFixture(name);
		},
		focusText,
		selectText,
		setWindow: setWindowStart,
		apply: applyOps,
		remoteApply,
		applyToolPayloads,
		importHtml,
		pasteHtml: importHtml,
		scanHostileDom,
		resetXssProbe,
		remoteSplice,
		remoteInjectY,
		injectPresence,
		serializePresenceAnchor,
		installBrokenProjector,
		installSelectionWriteFault,
		get selectionWriteFault() {
			return selectionWriteFaultCounters();
		},
		forceUnwindowedDomDivergence,
		domMatchesAuthority: checkDomMatchesAuthority,
		mapDomSelection: (root) => domSelectionToEditor(root),
		projectSelectionToDom: (root, anchor, focus) => {
			writeNativeRange(root, anchor, focus);
		},
		mountSelectionProbe,
		applyAiRangeReplacement,
		parseClipboardPayload,
		exerciseInlineAtomDragPreview,
		get geometryGeneration() {
			return geometryGeneration();
		},
		geometryBlocks() {
			return geometryBlocks(getHarnessSession().editor);
		},
		geometryLineBoxes(blockId: string) {
			return geometryLineBoxes(blockId);
		},
		invalidateGeometry() {
			invalidateGeometry();
		},
		warmCaretCache(points) {
			warmCaretCache(points);
		},
		compareCaretCache(points) {
			return compareCaretCache(points);
		},
		verticalMotion(args) {
			return runVerticalMotion(args);
		},
		flushEightRemoteCarets(points) {
			return flushEightRemoteCarets(points);
		},
		get beforeinputMap() {
			return beforeinputMap();
		},
		mapBeforeInput,
		documentSnapshot,
		dispatchBeforeInput,
		clearDiagnostics,
		mutateActiveSurfaceText,
		undo() {
			getHarnessSession().editor.undoManager.undo();
		},
		redo() {
			getHarnessSession().editor.undoManager.redo();
		},
		stopCapturing() {
			getHarnessSession().editor.undoManager.stopCapturing();
		},
	};
	window.__penConformance = bridge;
}