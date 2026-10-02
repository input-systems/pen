import { PenEditor } from "@input/pen-vue";
import { createApp } from "vue";
import { getHarnessSession } from "./session";
import { createSurfaceFrame, mountOnEachSession, readQueryFlag } from "./surfaceFrame";

/** `?surface=vue`: the Vue binding's `PenEditor`, which renders `PenContent`. */
export function mountVueHost(root: HTMLElement): void {
	mountOnEachSession(() => {
		const frame = createSurfaceFrame(root);
		const app = createApp(PenEditor, {
			editor: getHarnessSession().editor,
			chrome: !readQueryFlag("unstyled"),
		});
		app.mount(frame);
		return () => app.unmount();
	});
}
