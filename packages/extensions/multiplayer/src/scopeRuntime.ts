import { isYjsCRDTDocument, type YjsCRDTDocument } from "@input/pen-yjs";
import { createYjsAwareness } from "@input/pen-yjs/awareness";
import type {
	Awareness,
	Editor,
	MultiplayerSession,
	SelectionRecord,
	SelectionState,
	Unsubscribe,
} from "@input/pen-types";
import { MultiplayerControllerImpl } from "./controller";
import { AuthorLedger } from "./presence/authorLedger";
import { ClientIdentityMap } from "./presence/identityMap";
import { LocalPresenceWriter } from "./presence/localPresenceWriter";
import type {
	MultiplayerAwarenessState,
	MultiplayerConfig,
	MultiplayerUser,
} from "./types";

const runtimesByOwner = new WeakMap<
	object,
	Map<string, MultiplayerScopeRuntime>
>();

export interface MultiplayerScopeRuntimeHandle {
	readonly controller: MultiplayerControllerImpl;
	dispose(): void;
}

/**
 * API2: the adapter creates no awareness unless the host asks for one, so
 * multiplayer ensures its scope's awareness on activation when the scope is
 * a Yjs document. A scope that already has one (the host passed
 * `yjsAdapter({ awareness })`) keeps it.
 */
function ensureScopeAwareness(editor: Editor): void {
	const { awareness, crdtDoc, documentSession, documentScope } =
		editor.internals;
	if (awareness || !isYjsCRDTDocument(crdtDoc)) {
		return;
	}
	documentSession?.ensureAwareness?.(documentScope.id, (doc) =>
		createYjsAwareness(doc as YjsCRDTDocument),
	);
}

export function attachMultiplayerScopeRuntime(
	editor: Editor,
	config: MultiplayerConfig,
	user: MultiplayerUser,
	buildLocalAwarenessState: (
		editor: Editor,
		user: MultiplayerAwarenessState["user"],
		selection: SelectionState | SelectionRecord["state"],
	) => MultiplayerAwarenessState,
): MultiplayerScopeRuntimeHandle {
	const scopeOwner = resolveScopeOwner(editor);
	const scopeId = editor.internals.documentScope.id;
	let runtimeMap = runtimesByOwner.get(scopeOwner);
	if (!runtimeMap) {
		runtimeMap = new Map<string, MultiplayerScopeRuntime>();
		runtimesByOwner.set(scopeOwner, runtimeMap);
	}

	let runtime = runtimeMap.get(scopeId);
	if (!runtime) {
		ensureScopeAwareness(editor);
		runtime = new MultiplayerScopeRuntime({
			editor,
			config,
			user,
			buildLocalAwarenessState,
		});
		runtimeMap.set(scopeId, runtime);
	}

	runtime.attachEditor(editor);

	return {
		controller: runtime.controller,
		dispose() {
			runtime?.detachEditor(editor);
			if (runtime?.isIdle()) {
				runtime.destroy();
				runtimeMap?.delete(scopeId);
			}
			runtime = undefined;
		},
	};
}

type BuildLocalAwarenessState = (
	editor: Editor,
	user: MultiplayerAwarenessState["user"],
	selection: SelectionState | SelectionRecord["state"],
) => MultiplayerAwarenessState;

interface MultiplayerScopeRuntimeOptions {
	editor: Editor;
	config: MultiplayerConfig;
	user: MultiplayerUser;
	buildLocalAwarenessState: BuildLocalAwarenessState;
}

class MultiplayerScopeRuntime {
	readonly controller: MultiplayerControllerImpl;

	private readonly awareness: Awareness;
	private readonly buildLocalAwarenessState: BuildLocalAwarenessState;
	private readonly editors = new Set<Editor>();
	private readonly selectionUnsubscribers = new Map<Editor, Unsubscribe>();
	private readonly commitUnsubscribers = new Map<Editor, Unsubscribe>();
	private readonly presenceWriter: LocalPresenceWriter;
	private readonly session: MultiplayerSession | null;
	private readonly unsubscribeSessionState: Unsubscribe | null;
	private readonly user: MultiplayerUser;

	/** The editor whose selection local presence currently describes. */
	private presenceTarget: Editor | null;

	constructor(options: MultiplayerScopeRuntimeOptions) {
		const { editor, config, user, buildLocalAwarenessState } = options;
		const awareness = editor.internals.awareness;
		if (!awareness) {
			throw new Error(
				"Multiplayer extension requires CRDT awareness: pass an adapter that creates awareness, for Yjs yjsAdapter({ awareness: createYjsAwareness }) from @input/pen-yjs/awareness",
			);
		}

		this.awareness = awareness;
		this.user = user;
		this.buildLocalAwarenessState = buildLocalAwarenessState;
		this.presenceTarget = editor;
		this.presenceWriter = new LocalPresenceWriter({
			publish: () => {
				this.writeLocalPresence();
			},
		});
		this.controller = new MultiplayerControllerImpl({
			editor,
			config: {
				...config,
				user,
			},
			authorLedger: new AuthorLedger(),
			identityMap: new ClientIdentityMap({
				resolvePeerIdentity: config.resolvePeerIdentity,
			}),
		});
		this.writeLocalPresence();
		this.controller.handleAwarenessChange(
			this.awareness.getStates() as Map<
				number,
				MultiplayerAwarenessState
			>,
		);

		this.awareness.on("change", this.handleAwarenessChange);

		this.session =
			config.session ??
			config.sessionFactory?.({
				editor,
				awareness: this.awareness,
			}) ??
			null;
		this.unsubscribeSessionState = this.session
			? this.session.onStateChange((state) => {
					this.controller.setConnectionState(state);
				})
			: null;

		if (this.session) {
			this.controller.setConnectionLifecycleHandlers({
				connect: () => this.session?.connect(),
				disconnect: () => this.session?.disconnect(),
			});
			this.controller.setConnectionState(this.session.connectionState);
			if (config.autoConnect !== false) {
				this.controller.connect();
			}
		}
	}

	attachEditor(editor: Editor): void {
		if (this.editors.has(editor)) {
			return;
		}

		this.editors.add(editor);
		this.selectionUnsubscribers.set(
			editor,
			editor.onSelectionChange(() => {
				this.presenceTarget = editor;
				this.presenceWriter.request();
			}),
		);
		this.commitUnsubscribers.set(
			editor,
			editor.on("commit", (event) => {
				if (event.summary.structural.length === 0) {
					return;
				}
				this.presenceTarget = editor;
				this.presenceWriter.request();
			}),
		);
		editor.requestDecorationUpdate();
	}

	detachEditor(editor: Editor): void {
		this.selectionUnsubscribers.get(editor)?.();
		this.selectionUnsubscribers.delete(editor);
		this.commitUnsubscribers.get(editor)?.();
		this.commitUnsubscribers.delete(editor);
		this.editors.delete(editor);
		this.presenceWriter.cancel();

		const remainingEditor = this.editors.values().next().value as
			| Editor
			| undefined;
		if (!remainingEditor) {
			this.presenceTarget = null;
			this.awareness.setLocalState(null);
			return;
		}
		this.presenceTarget = remainingEditor;
		this.writeLocalPresence();
	}

	isIdle(): boolean {
		return this.editors.size === 0;
	}

	destroy(): void {
		this.presenceWriter.cancel();
		this.presenceTarget = null;
		this.awareness.setLocalState(null);
		for (const unsubscribe of this.selectionUnsubscribers.values()) {
			unsubscribe();
		}
		this.selectionUnsubscribers.clear();
		for (const unsubscribe of this.commitUnsubscribers.values()) {
			unsubscribe();
		}
		this.commitUnsubscribers.clear();
		this.editors.clear();
		this.unsubscribeSessionState?.();
		this.session?.destroy();
		this.awareness.off("change", this.handleAwarenessChange);
		this.controller.destroy();
	}

	private writeLocalPresence(): void {
		const target = this.presenceTarget;
		if (!target) {
			return;
		}
		// merge rather than replace: this runtime owns identity, cursor, and
		// selection, while other extensions and the host own the rest of the
		// payload (COL2). A wholesale write drops their keys — which is what
		// silently unpublished an AI run's `streaming` presence on every
		// selection change.
		this.awareness.setLocalState({
			...(this.awareness.getLocalState() ?? {}),
			...this.buildLocalAwarenessState(target, this.user, target.selection),
		});
	}

	private readonly handleAwarenessChange = (): void => {
		this.controller.handleAwarenessChange(
			this.awareness.getStates() as Map<
				number,
				MultiplayerAwarenessState
			>,
		);
		for (const editor of this.editors) {
			editor.requestDecorationUpdate();
		}
	};
}

function resolveScopeOwner(editor: Editor): object {
	return editor.internals.documentSession ?? editor;
}
