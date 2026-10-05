type AnyMethod = (...args: never[]) => unknown;

type MethodKey<T> = {
	[K in keyof T]-?: NonNullable<T[K]> extends AnyMethod ? K : never;
}[keyof T];

interface MethodLayer {
	readonly method: AnyMethod;
}

interface MethodLayerSlot {
	readonly hadOwnValue: boolean;
	readonly ownValue: unknown;
	readonly original: AnyMethod;
	readonly dispatcher: AnyMethod;
	readonly layers: MethodLayer[];
}

const methodLayerSlots = new WeakMap<
	object,
	Map<PropertyKey, MethodLayerSlot>
>();

function createSlot(target: object, key: PropertyKey): MethodLayerSlot {
	const record = target as Record<PropertyKey, unknown>;
	const value = record[key] as AnyMethod;
	const hadOwnValue = Object.prototype.hasOwnProperty.call(target, key);
	const original = value.bind(target) as AnyMethod;
	const layers: MethodLayer[] = [];
	const dispatcher = ((...args: never[]) =>
		(layers.at(-1)?.method ?? original)(...args)) as AnyMethod;
	record[key] = dispatcher;
	return {
		hadOwnValue,
		ownValue: value,
		original,
		dispatcher,
		layers,
	};
}

/**
 * Layers a replacement over `target[key]` until the returned release runs.
 *
 * Overlapping owners (tool calls of overlapping generations, AIB3) each hold
 * their own layer and the most recent live layer decides. Releasing removes
 * only that layer, so an out-of-order unwind cannot restore over a layer
 * installed after it the way a single save-and-restore slot would. The
 * original method comes back once the last layer is released. Releasing is
 * idempotent.
 *
 * `createLayer` receives the unlayered original, bound to `target`.
 */
export function layerMethod<T extends object, K extends MethodKey<T>>(
	target: T,
	key: K,
	createLayer: (original: NonNullable<T[K]>) => NonNullable<T[K]>,
): () => void {
	let slots = methodLayerSlots.get(target);
	if (!slots) {
		slots = new Map();
		methodLayerSlots.set(target, slots);
	}
	let slot = slots.get(key);
	if (!slot) {
		slot = createSlot(target, key);
		slots.set(key, slot);
	}
	const activeSlot = slot;
	const activeSlots = slots;
	const layer: MethodLayer = {
		method: createLayer(
			activeSlot.original as NonNullable<T[K]>,
		) as AnyMethod,
	};
	activeSlot.layers.push(layer);
	return () => {
		const index = activeSlot.layers.indexOf(layer);
		if (index < 0) {
			return;
		}
		activeSlot.layers.splice(index, 1);
		if (activeSlot.layers.length > 0) {
			return;
		}
		activeSlots.delete(key);
		const record = target as Record<PropertyKey, unknown>;
		// Something layered over the dispatcher outside this helper: leave it in
		// the chain, where it now passes straight through to the original.
		if (record[key] !== activeSlot.dispatcher) {
			return;
		}
		if (activeSlot.hadOwnValue) {
			record[key] = activeSlot.ownValue;
		} else {
			delete record[key];
		}
	};
}
