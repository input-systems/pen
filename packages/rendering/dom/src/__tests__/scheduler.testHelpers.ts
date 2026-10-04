import type { SelectionRecord } from "@input/pen-types";

export function record(version: number): SelectionRecord {
	return {
		state: null,
		version,
		origin: "programmatic",
		commitId: version,
	};
}
