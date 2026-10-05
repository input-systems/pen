import { DomScheduler } from "../scheduler";
import { DATA_ATTRS } from "../utils/dataAttributes";
import {
	createGeometryReader,
	type GeometryReaderHost,
	type GeometryReaderOptions,
} from "./geometryReader";

export type RootGeometry = {
	readonly root: HTMLElement;
	readonly scheduler: DomScheduler;
	readonly reader: GeometryReaderHost;
};

const hosts = new WeakMap<HTMLElement, RootGeometry>();
const holds = new WeakMap<HTMLElement, number>();
let rootSeq = 0;

/**
 * One GeometryReader + DomScheduler per editor root (SCH3).
 * First call wins for reader options; later calls reuse the host.
 */
export function getRootGeometry(
	root: HTMLElement,
	options?: Omit<GeometryReaderOptions, "root">,
): RootGeometry {
	const existing = hosts.get(root);
	if (existing) {
		return existing;
	}

	const reader = createGeometryReader({
		root,
		observeResize: options?.observeResize ?? true,
		observeFonts: options?.observeFonts ?? true,
		observeScroll: options?.observeScroll ?? true,
		...options,
	});
	const scheduler = new DomScheduler(rootIdFor(root), { geometry: reader });
	const host = { root, scheduler, reader };
	hosts.set(root, host);
	return host;
}

/**
 * Hold the root's geometry for as long as something stays attached to it
 * (the root overlay does, per field editor attach). When the last hold is
 * released the reader is disposed — its ResizeObserver and document
 * scroll-capture listener go with it — and the root forgets the host, so a
 * root that outlives its editor pins nothing. A later hold or read on the
 * same root (React Strict Mode re-attaches) starts a fresh host.
 */
export function holdRootGeometry(root: HTMLElement): {
	readonly geometry: RootGeometry;
	release(): void;
} {
	const geometry = getRootGeometry(root);
	holds.set(root, (holds.get(root) ?? 0) + 1);
	let released = false;
	return {
		geometry,
		release() {
			if (released) {
				return;
			}
			released = true;
			const remaining = (holds.get(root) ?? 1) - 1;
			if (remaining > 0) {
				holds.set(root, remaining);
				return;
			}
			holds.delete(root);
			if (hosts.get(root) === geometry) {
				hosts.delete(root);
			}
			geometry.reader.dispose();
		},
	};
}

/**
 * Run `fn` against the per-root reader. Uses the current read phase when
 * already flushing; otherwise `measureNow` (SCH2) because the callers of
 * this helper still need a synchronous value.
 */
export function measureWithRoot<T>(
	root: HTMLElement,
	fn: (host: RootGeometry) => T,
): T {
	const host = getRootGeometry(root);
	if (host.scheduler.phase === "read") {
		return fn(host);
	}
	return host.scheduler.measureNow(() => fn(host));
}

function rootIdFor(root: HTMLElement): string {
	return root.getAttribute(DATA_ATTRS.viewId) ?? `geometry-root-${++rootSeq}`;
}
