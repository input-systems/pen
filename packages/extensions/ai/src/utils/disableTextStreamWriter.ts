import type { TextStreamWriter } from "@input/pen-types";

import { layerMethod } from "./methodLayers";

/**
 * Refuses `writer`'s writes, reporting each to `onRefused`, until the returned
 * release runs. Each caller holds its own layer, so overlapping read-only calls
 * can release in any order (AIB3).
 */
export function disableTextStreamWriter(
	writer: TextStreamWriter,
	onRefused: () => void,
): () => void {
	const restoreAppend = layerMethod(writer, "append", () => () => {
		onRefused();
	});
	const restoreSplice = layerMethod(writer, "splice", () => () => {
		onRefused();
	});
	return () => {
		restoreSplice();
		restoreAppend();
	};
}
