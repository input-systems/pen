import { describe, expect, it } from "vitest";

import {
	CLOSED_GESTURE_WINDOWS,
	originForTransfer,
	type GestureWindowState,
} from "../selectionReader";

function source(windows: Partial<GestureWindowState>) {
	return {
		reader: { windows: { ...CLOSED_GESTURE_WINDOWS, ...windows } },
	};
}

describe("originForTransfer", () => {
	it("S3: paste writes keyboard unless the context-menu or drag window is open; drop writes pointer", () => {
		expect(originForTransfer(source({}))).toBe("keyboard");
		expect(originForTransfer(source({ contextMenu: true }))).toBe("pointer");
		expect(originForTransfer(source({ drag: true }))).toBe("pointer");
		expect(originForTransfer(source({}), true)).toBe("pointer");
		expect(originForTransfer(null)).toBe("keyboard");
		expect(originForTransfer({})).toBe("keyboard");
	});
});
