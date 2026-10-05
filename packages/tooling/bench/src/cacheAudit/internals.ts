import type {
	Editor,
	PenDocument,
	SelectionRecord,
	Unsubscribe,
} from "@input/pen-types";

/**
 * Package internals the cache audit drives that no package exports: the
 * pen-dom block notifier and selection overlay contributor, and core's
 * from-document block index builder (the naive B recompute). They are loaded
 * from source with a computed specifier, which is the documented exception to
 * top-of-module imports: a static import would put another package's `src`
 * under this package's `rootDir`, and exporting them would change production
 * entry points. tsx and vitest both transpile the source on load.
 */

export interface AuditBlockNotifier {
	subscribeBlock(blockId: string, onChange: () => void): Unsubscribe;
	subscribeDocument(onChange: () => void): Unsubscribe;
	subscribeListSegments(parentId: string | null, onChange: () => void): Unsubscribe;
	getListSegments(parentId: string | null): readonly unknown[];
	destroy(): void;
}

export interface AuditOverlayFieldState {
	readonly isEditing: boolean;
	readonly isFocused: boolean;
	readonly isComposing: boolean;
	readonly readonly: boolean;
	readonly mode: string;
	readonly editingCell: boolean;
	readonly substitute: "block-surface-range" | "engine-confined-range" | null;
}

export interface AuditOverlayReadContext {
	readonly editor: Editor;
	readonly commits: readonly never[];
	readonly selection: SelectionRecord;
	readonly field: AuditOverlayFieldState;
	readonly caretMode: "auto" | "all";
}

export interface AuditOverlayContributor {
	requests(context: AuditOverlayReadContext): readonly unknown[];
}

export interface AuditInternals {
	createBlockNotifier(editor: Editor): AuditBlockNotifier;
	createSelectionOverlayContributor(): AuditOverlayContributor;
	createBlockIndexSnapshotFromDocument(doc: PenDocument): unknown;
}

const PACKAGES = new URL("../../../../", import.meta.url);

function sourceUrl(path: string): string {
	return new URL(path, PACKAGES).href;
}

let loaded: Promise<AuditInternals> | null = null;

export function loadAuditInternals(): Promise<AuditInternals> {
	loaded ??= (async () => {
		const [notifier, overlay, fromDocument] = await Promise.all([
			import(sourceUrl("rendering/dom/src/field-editor/blockNotifier.ts")),
			import(sourceUrl("rendering/dom/src/overlay/selectionOverlay.ts")),
			import(sourceUrl("core/src/changes/fromDocument.ts")),
		]);
		return {
			createBlockNotifier: notifier.createBlockNotifier,
			createSelectionOverlayContributor: overlay.createSelectionOverlayContributor,
			createBlockIndexSnapshotFromDocument: fromDocument.createBlockIndexSnapshotFromDocument,
		} as AuditInternals;
	})();
	return loaded;
}
