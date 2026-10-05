import { PenEditor } from "@input/pen-vue";
import { createApp } from "vue";
import { PROBE_ENABLED } from "./probes/counters";
import { installVueComponentProbe } from "./probes/vueComponents";
import { getHarnessSession, readQueryFlag } from "./session";
import { createSurfaceFrame, mountOnEachSession } from "./surfaceFrame";

/** `?surface=vue`: the Vue binding's `PenEditor`, which renders `PenContent`. */
export function mountVueHost(root: HTMLElement): void {
	mountOnEachSession(() => {
		const frame = createSurfaceFrame(root);
		const app = createApp(PenEditor, {
			editor: getHarnessSession().editor,
			chrome: !readQueryFlag("unstyled"),
		});
		if (PROBE_ENABLED) installVueComponentProbe(app);
		app.mount(frame);
		return () => app.unmount();
	});
}
