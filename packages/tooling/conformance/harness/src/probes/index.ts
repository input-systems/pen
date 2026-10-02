import { createScanProbe, type ScanProbe } from "@input/pen-test";
import type { Editor } from "@input/pen-types";
import {
	PROBE_ENABLED,
	bump,
	readDistinct,
	readMetrics,
	resetDistinct,
	resetMetrics,
} from "./counters";
import { startMutationProbe, stopMutationProbe } from "./domMutations";
import { installEditorListenerProbe, readLiveEditorListeners } from "./editorListeners";
import { installGeometryProbe } from "./geometry";
import { beginSchedulerProbe, endSchedulerProbe } from "./scheduler";
import { installStoreListenerProbe, readLiveStoreListeners } from "./storeListeners";

/**
 * `?probe=render` instruments for the scale-render record spec (W1, SCALE6).
 * Nothing installs without the flag, so every other scenario is unaffected.
 */
interface ScaleProbeApi {
	begin(): void;
	end(): Promise<Record<string, number>>;
	live(): Record<string, number>;
}

let scan: ScanProbe | null = null;

function nextFrame(): Promise<void> {
	return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function recordScan(): void {
	if (!scan) return;
	for (const [key, value] of Object.entries(scan.snapshot())) bump(`scan.${key}`, value);
}

const api: ScaleProbeApi = {
	begin() {
		resetMetrics();
		resetDistinct();
		scan?.reset();
		beginSchedulerProbe();
		startMutationProbe();
	},
	async end() {
		await nextFrame();
		await nextFrame();
		stopMutationProbe();
		endSchedulerProbe();
		recordScan();
		return { ...readMetrics(), ...readDistinct() };
	},
	live() {
		const editorListeners = readLiveEditorListeners();
		const store = readLiveStoreListeners();
		const total = Object.values(editorListeners).reduce((sum, n) => sum + n, store);
		return { ...editorListeners, "listeners.live.store": store, "listeners.live.total": total };
	},
};

/** Called by the harness for each new session editor, before anything subscribes. */
export function instrumentSessionEditor(editor: Editor): void {
	if (!PROBE_ENABLED) return;
	installEditorListenerProbe(editor);
	scan?.dispose();
	scan = createScanProbe(editor);
	scan.selfTest();
}

if (PROBE_ENABLED) {
	installStoreListenerProbe();
	installGeometryProbe();
	(window as unknown as { __penScaleProbe: ScaleProbeApi }).__penScaleProbe = api;
}
