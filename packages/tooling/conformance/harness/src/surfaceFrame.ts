import { getHarnessSession, subscribeHarness } from "./session";

/**
 * The fixture marker every surface renders, so `s.load(name)` waits on the
 * same `[data-fixture]` element whichever renderer mounted the editor.
 */
export function createSurfaceFrame(root: HTMLElement): HTMLElement {
	const frame = document.createElement("div");
	frame.setAttribute("data-pen-conformance-harness", "");
	const session = getHarnessSession();
	frame.setAttribute("data-fixture", session.fixtureName);
	frame.setAttribute("data-generation", String(session.generation));
	root.textContent = "";
	root.append(frame);
	return frame;
}

/** Remounts the surface whenever the harness loads a new session. */
export function mountOnEachSession(mount: () => () => void): void {
	let generation = getHarnessSession().generation;
	let unmount = mount();
	subscribeHarness(() => {
		const next = getHarnessSession().generation;
		if (next === generation) return;
		generation = next;
		unmount();
		unmount = mount();
	});
}
