import type {
	Editor,
	Extension,
	Facet,
	FacetOutput,
	FacetProvider,
	Precedence,
} from "@input/pen-types";

import {
	type FacetComputeState,
	type FacetSettleInput,
	type FacetSlot,
	type OrderedFacetProvider,
	facetDepName,
	resolveAllFacets,
	settleFacets,
} from "./compute";
import {
	assertCompatibleFacetSpec,
	defineFacet,
	getFacetSpec,
	getProviderRecord,
} from "./defineFacet";

export { defineFacet };
export type { FacetSettleInput };

const PRECEDENCE_RANK: Record<Precedence, number> = {
	highest: 0,
	high: 1,
	default: 2,
	low: 3,
	lowest: 4,
};

const CORE_SOURCE_ORDER = -1;

export interface CreateFacetRegistryOptions {
	extensions?: readonly Extension[];
	providers?: readonly FacetProvider[];
	editor?: Editor;
}

export interface FacetRegistry {
	markReady(): void;
	read<F extends Facet<unknown, unknown>>(facet: F): FacetOutput<F>;
	override<F extends Facet<unknown, unknown>>(
		facet: F,
		value: FacetOutput<F>,
	): void;
	settle(input: FacetSettleInput): void;
}

export function createFacetRegistry(
	options: CreateFacetRegistryOptions = {},
): FacetRegistry {
	return new FacetRegistryImpl(options);
}

class FacetRegistryImpl implements FacetRegistry {
	private ready = false;
	private readonly state: FacetComputeState;
	private readonly emptyOutputs = new WeakMap<
		Facet<unknown, unknown>,
		unknown
	>();
	private readonly overrides = new Map<string, unknown>();

	constructor(options: CreateFacetRegistryOptions) {
		const extensions = sortExtensions(options.extensions ?? []);
		const slots = new Map<string, FacetSlot>();

		collectProviders(slots, options.providers ?? [], CORE_SOURCE_ORDER);
		for (const [extensionOrder, ext] of extensions.entries()) {
			collectProviders(slots, ext.facets ?? [], extensionOrder);
		}

		for (const slot of slots.values()) {
			slot.providers.sort(compareProviders);
			assertStaticSlot(slot);
		}

		const { computedOrder, dependents } = orderComputedFacets(slots);

		this.state = {
			editor: options.editor,
			slots,
			computedOrder,
			dependents,
			lastCommitId: undefined,
			lastSelectionVersion: undefined,
		};
	}

	markReady(): void {
		if (this.ready) return;
		this.ready = true;
		resolveAllFacets(this.state);
	}

	read<F extends Facet<unknown, unknown>>(facet: F): FacetOutput<F> {
		if (!this.ready) {
			throw new Error("Facet read before registry is ready");
		}
		if (this.overrides.has(facet.name)) {
			return this.overrides.get(facet.name) as FacetOutput<F>;
		}
		const slot = this.state.slots.get(facet.name);
		if (!slot) {
			return this.readUnregistered(facet);
		}
		return slot.output as FacetOutput<F>;
	}

	override<F extends Facet<unknown, unknown>>(
		facet: F,
		value: FacetOutput<F>,
	): void {
		this.overrides.set(facet.name, value);
	}

	settle(input: FacetSettleInput): void {
		if (!this.ready) {
			throw new Error("Facet settle before registry is ready");
		}
		settleFacets(this.state, input);
	}

	private readUnregistered<F extends Facet<unknown, unknown>>(
		facet: F,
	): FacetOutput<F> {
		if (this.emptyOutputs.has(facet)) {
			return this.emptyOutputs.get(facet) as FacetOutput<F>;
		}
		const spec = getFacetSpec(facet);
		const output = spec.combine([]);
		this.emptyOutputs.set(facet, output);
		return output as FacetOutput<F>;
	}
}

function collectProviders(
	slots: Map<string, FacetSlot>,
	providers: readonly FacetProvider[],
	extensionOrder: number,
): void {
	for (const [arrayIndex, provider] of providers.entries()) {
		const record = getProviderRecord(provider);
		const slot = ensureSlot(slots, provider.facetName, record.spec);
		slot.providers.push({
			record,
			input: undefined,
			hasInput: false,
			extensionOrder,
			arrayIndex,
			precedence: provider.precedence,
		});
		if (record.kind === "computed") {
			for (const dep of record.deps) {
				if (dep === "document" || dep === "selection") continue;
				ensureSlot(slots, dep.name, getFacetSpec(dep));
			}
		}
	}
}

function ensureSlot(
	slots: Map<string, FacetSlot>,
	name: string,
	spec: FacetSlot["spec"],
): FacetSlot {
	const existing = slots.get(name);
	if (existing) {
		assertCompatibleFacetSpec(name, existing.spec, spec);
		return existing;
	}
	const slot: FacetSlot = {
		spec,
		providers: [],
		output: undefined,
		hasOutput: false,
	};
	slots.set(name, slot);
	return slot;
}

function assertStaticSlot(slot: FacetSlot): void {
	if (!slot.spec.static) return;
	for (const provider of slot.providers) {
		if (provider.record.kind === "computed") {
			throw new Error(
				`Computed provider registered for static facet "${slot.spec.name}"`,
			);
		}
	}
}

function orderComputedFacets(slots: Map<string, FacetSlot>): {
	computedOrder: string[];
	dependents: Map<string, string[]>;
} {
	const inDegree = new Map<string, number>();
	const dependents = new Map<string, string[]>();

	for (const name of slots.keys()) {
		inDegree.set(name, 0);
		dependents.set(name, []);
	}

	for (const [name, slot] of slots) {
		const seen = new Set<string>();
		for (const provider of slot.providers) {
			if (provider.record.kind !== "computed") continue;
			for (const dep of provider.record.deps) {
				const depName = facetDepName(dep);
				if (!depName || seen.has(depName)) continue;
				seen.add(depName);
				inDegree.set(name, (inDegree.get(name) ?? 0) + 1);
				dependents.get(depName)!.push(name);
			}
		}
	}

	const queue: string[] = [];
	for (const [name, degree] of inDegree) {
		if (degree === 0) queue.push(name);
	}

	const computedOrder: string[] = [];
	while (queue.length > 0) {
		const name = queue.shift()!;
		const slot = slots.get(name);
		if (slot && !slot.spec.static) {
			computedOrder.push(name);
		}
		for (const dependent of dependents.get(name) ?? []) {
			const next = (inDegree.get(dependent) ?? 1) - 1;
			inDegree.set(dependent, next);
			if (next === 0) queue.push(dependent);
		}
	}

	if (computedOrder.length !== countComputedSlots(slots)) {
		const cyclic = [...slots.keys()].filter(
			(name) => (inDegree.get(name) ?? 0) > 0,
		);
		throw new Error(`Facet dependency cycle: ${cyclic.join(", ")}`);
	}

	return { computedOrder, dependents };
}

function countComputedSlots(slots: Map<string, FacetSlot>): number {
	let count = 0;
	for (const slot of slots.values()) {
		if (!slot.spec.static) count += 1;
	}
	return count;
}

function compareProviders(
	a: OrderedFacetProvider,
	b: OrderedFacetProvider,
): number {
	const byPrecedence =
		PRECEDENCE_RANK[a.precedence] - PRECEDENCE_RANK[b.precedence];
	if (byPrecedence !== 0) return byPrecedence;
	const byExtension = a.extensionOrder - b.extensionOrder;
	if (byExtension !== 0) return byExtension;
	return a.arrayIndex - b.arrayIndex;
}

/**
 * Orders extensions so each follows its dependencies. Throws on a duplicate
 * name, a dependency that is not registered, or a cycle.
 */
export function sortExtensions(extensions: readonly Extension[]): Extension[] {
	const byName = new Map<string, Extension>();
	for (const ext of extensions) {
		if (byName.has(ext.name)) {
			throw new Error(`Extension "${ext.name}" is already registered`);
		}
		byName.set(ext.name, ext);
	}

	const inDegree = new Map<string, number>();
	const dependents = new Map<string, string[]>();
	for (const ext of extensions) {
		inDegree.set(ext.name, 0);
		dependents.set(ext.name, []);
	}

	for (const ext of extensions) {
		if (!ext.dependencies) continue;
		for (const dep of ext.dependencies) {
			if (!byName.has(dep)) {
				throw new Error(
					`Extension "${ext.name}" depends on "${dep}", which is not registered`,
				);
			}
			inDegree.set(ext.name, (inDegree.get(ext.name) ?? 0) + 1);
			dependents.get(dep)!.push(ext.name);
		}
	}

	const queue: string[] = [];
	for (const [name, degree] of inDegree) {
		if (degree === 0) queue.push(name);
	}

	const sorted: Extension[] = [];
	while (queue.length > 0) {
		const name = queue.shift()!;
		sorted.push(byName.get(name)!);
		for (const dependent of dependents.get(name) ?? []) {
			const next = (inDegree.get(dependent) ?? 1) - 1;
			inDegree.set(dependent, next);
			if (next === 0) queue.push(dependent);
		}
	}

	if (sorted.length !== extensions.length) {
		const cyclic = extensions
			.filter((ext) => !sorted.includes(ext))
			.map((ext) => ext.name);
		throw new Error(
			`Circular dependency detected among extensions: ${cyclic.join(", ")}`,
		);
	}

	return sorted;
}
