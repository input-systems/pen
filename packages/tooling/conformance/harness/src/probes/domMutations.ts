import { addDistinct, bump } from "./counters";

/** P5: mutation records under the editor content and the blocks they touch. */
let observer: MutationObserver | null = null;

function record(mutations: MutationRecord[]): void {
	bump("dom.mutationRecords", mutations.length);
	for (const mutation of mutations) {
		const node = mutation.target;
		const element = node instanceof Element ? node : node.parentElement;
		const blockId = element
			?.closest("[data-pen-editor-block]")
			?.getAttribute("data-block-id");
		if (blockId) addDistinct("dom.blocksTouched", blockId);
	}
}

export function startMutationProbe(): void {
	const target = document.querySelector("[data-pen-conformance-harness]");
	if (!target) throw new Error("scale probe: no harness frame to observe");
	observer = new MutationObserver(record);
	observer.observe(target, {
		attributes: true,
		childList: true,
		characterData: true,
		subtree: true,
	});
}

export function stopMutationProbe(): void {
	if (!observer) return;
	record(observer.takeRecords());
	observer.disconnect();
	observer = null;
}
