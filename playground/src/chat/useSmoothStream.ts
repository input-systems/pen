import { useEffect, useState } from "react";
import {
	getSmoothStreamController,
	type SmoothStreamController,
	type SmoothStreamStatus,
} from "@input/pen-ai/stream";
import type { Editor } from "@input/pen-types";

const IDLE: SmoothStreamStatus = {
	isRevealing: false,
	hiddenCharCount: 0,
	enabled: false,
};

/** Live paced-reveal status: is text still being painted, and how much. */
export function useSmoothStream(editor: Editor): SmoothStreamStatus {
	const controller = getSmoothStreamController(editor);
	const [status, setStatus] = useState(() => readStatus(controller));

	useEffect(() => {
		if (!controller) {
			return;
		}
		setStatus(readStatus(controller));
		return controller.subscribe(setStatus);
	}, [controller]);

	return status;
}

function readStatus(
	controller: SmoothStreamController | null,
): SmoothStreamStatus {
	if (!controller) {
		return IDLE;
	}
	return {
		isRevealing: controller.isRevealing(),
		hiddenCharCount: controller.hiddenCharCount(),
		enabled: controller.isEnabled(),
	};
}
