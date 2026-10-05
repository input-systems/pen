import { mountEditor } from "@input/pen-dom";
import { getHarnessSession, readQueryFlag } from "./session";
import { createSurfaceFrame, mountOnEachSession } from "./surfaceFrame";

/** `?surface=vanilla`: `mountEditor` from the framework-free DOM engine. */
export function mountVanillaHost(root: HTMLElement): void {
	mountOnEachSession(() => {
		const frame = createSurfaceFrame(root);
		const mounted = mountEditor(getHarnessSession().editor, frame, {
			chrome: !readQueryFlag("unstyled"),
		});
		return () => mounted.destroy();
	});
}
