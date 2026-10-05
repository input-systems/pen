import { bump } from "./counters";
import { isInFlush } from "./scheduler";

/** P6: layout reads, split by whether a scheduler flush was running. */
type Measured = { prototype: object; key: "getBoundingClientRect" | "getClientRects"; metric: string };

const MEASURED: Measured[] = [
	{ prototype: Element.prototype, key: "getBoundingClientRect", metric: "boundingClientRect" },
	{ prototype: Element.prototype, key: "getClientRects", metric: "clientRects" },
	{ prototype: Range.prototype, key: "getBoundingClientRect", metric: "boundingClientRect" },
	{ prototype: Range.prototype, key: "getClientRects", metric: "clientRects" },
];

export function installGeometryProbe(): void {
	for (const { prototype, key, metric } of MEASURED) {
		const target = prototype as Record<string, (...args: unknown[]) => unknown>;
		const original = target[key];
		target[key] = function (this: unknown, ...args: unknown[]) {
			bump(`geometry.${metric}.${isInFlush() ? "inFlush" : "outOfFlush"}`);
			bump(`geometry.${metric}.total`);
			return original.apply(this, args);
		};
	}
}
