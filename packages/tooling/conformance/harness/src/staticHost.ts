import { getHarnessSession } from "./session";
import { createSurfaceFrame, mountOnEachSession } from "./surfaceFrame";

/**
 * `?surface=static`: Pen removed — one `<p>` per block in one contenteditable
 * div. The CH8 harness floor for renderer clocks; never used for counts.
 */
export function mountStaticHost(root: HTMLElement): void {
	mountOnEachSession(() => {
		const frame = createSurfaceFrame(root);
		const editor = getHarnessSession().editor;
		const host = document.createElement("div");
		host.contentEditable = "true";
		const paragraphs = editor.documentState.blockOrder.map((id) => {
			const paragraph = document.createElement("p");
			paragraph.textContent = editor.getBlock(id)?.textContent() ?? "";
			return paragraph;
		});
		host.append(...paragraphs);
		frame.append(host);
		return () => frame.remove();
	});
}
