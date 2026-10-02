import type {
	Extension,
	CommitEvent,
	Editor,
	DocumentState,
	DecorationSet,
	KeyBinding,
	SchemaRegistry,
} from "@input/pen-types";
import { decorationsFacet, keymapFacet } from "../facets/coreFacets";
import { EventEmitter } from "./events";
import { emptyDecorationSet, mergeDecorationSets } from "./decorations";

export class ExtensionManagerImpl {
	private readonly _extensions = new Map<string, Extension>();
	private _sorted: Extension[] = [];
	private readonly _stateMap = new Map<string, unknown>();
	private readonly _emitter: EventEmitter;

	constructor(emitter: EventEmitter) {
		this._emitter = emitter;
	}

	private _emitLifecycleDiagnostic(
		code: string,
		ext: Extension,
		phase: "activation" | "deactivation",
		error: unknown,
	): void {
		this._emitter.emit("diagnostic", {
			code,
			level: "error",
			source: "extension",
			message: `Extension "${ext.name}" ${phase} failed`,
			remediation:
				phase === "activation"
					? `Fix the "${ext.name}" activateClient() implementation so a throw or rejected startup does not leave the editor in a partial state.`
					: `Fix the "${ext.name}" deactivateClient() implementation so a throw or rejected teardown does not leave stale extension resources behind.`,
			error,
			extension: ext.name,
		});
	}

	// ── Registration ─────────────────────────────────────────

	register(ext: Extension): void {
		if (this._extensions.has(ext.name)) {
			throw new Error(`Extension "${ext.name}" is already registered`);
		}
		this._extensions.set(ext.name, ext);
		this._resortAndValidate();
	}

	unregister(name: string): void {
		const ext = this._extensions.get(name);
		if (!ext) return;

		for (const other of this._extensions.values()) {
			if (other.dependencies?.includes(name)) {
				throw new Error(
					`Cannot unregister "${name}": "${other.name}" depends on it`,
				);
			}
		}

		this._extensions.delete(name);
		this._stateMap.delete(name);
		this._resortAndValidate();
	}

	// ── Lifecycle ────────────────────────────────────────────

	async activateAll(editor: Editor): Promise<void> {
		const pending: Promise<void>[] = [];
		for (const ext of this._sorted) {
			try {
				if (ext.activateClient) {
					const activation = ext.activateClient({
						editor,
						dom:
							typeof globalThis.document !== "undefined"
								? globalThis.document
								: undefined,
						emit: (event: string, payload?: unknown) => {
							this._emitter.emit(
								`ext:${ext.name}:${event}`,
								payload,
							);
						},
						getState: <T>(name: string): T | undefined =>
							this._stateMap.get(name) as T | undefined,
					});
					if (activation && typeof activation.then === "function") {
						pending.push(
							activation.catch((error) => {
								this._emitLifecycleDiagnostic(
									"PEN_EXT_004",
									ext,
									"activation",
									error,
								);
							}),
						);
					}
				}
				if (ext.state) {
					this._stateMap.set(ext.name, ext.state.init(editor));
				}
			} catch (err) {
				this._emitLifecycleDiagnostic(
					"PEN_EXT_004",
					ext,
					"activation",
					err,
				);
			}
		}

		for (const activation of pending) {
			await activation;
		}
	}

	async deactivateAll(editor: Editor): Promise<void> {
		const reversed = [...this._sorted].reverse();
		const pending: Promise<void>[] = [];
		for (const ext of reversed) {
			try {
				if (ext.deactivateClient) {
					const deactivation = ext.deactivateClient();
					if (
						deactivation &&
						typeof deactivation.then === "function"
					) {
						pending.push(
							deactivation.catch((error) => {
								this._emitLifecycleDiagnostic(
									"PEN_EXT_005",
									ext,
									"deactivation",
									error,
								);
							}),
						);
					}
				}
			} catch (err) {
				this._emitLifecycleDiagnostic(
					"PEN_EXT_005",
					ext,
					"deactivation",
					err,
				);
			}
		}

		for (const deactivation of pending) {
			await deactivation;
		}
		this._stateMap.clear();
	}

	// ── Dispatch ─────────────────────────────────────────────

	dispatchObserve(events: readonly CommitEvent[], editor: Editor): void {
		for (const ext of this._sorted) {
			if (!ext.observe) continue;
			try {
				ext.observe(events, editor);
			} catch (err) {
				this._emitter.emit("diagnostic", {
					code: "PEN_EXT_001",
					level: "error",
					source: "extension",
					message: `Extension "${ext.name}" observe() threw`,
					remediation:
						`Inspect the "${ext.name}" observe() handler and guard any unsafe access ` +
						"so extension observation can continue after CRDT changes.",
					error: err,
				});
			}
		}

		for (const ext of this._sorted) {
			if (!ext.state?.apply) continue;
			const current = this._stateMap.get(ext.name);
			try {
				const next = ext.state.apply(current, events, editor);
				this._stateMap.set(ext.name, next);
			} catch (err) {
				this._emitter.emit("diagnostic", {
					code: "PEN_EXT_002",
					level: "error",
					source: "extension",
					message: `Extension "${ext.name}" state.apply() threw`,
					remediation:
						`Fix the "${ext.name}" state.apply() implementation so it returns the next state ` +
						"for every observed change without throwing.",
					error: err,
				});
			}
		}
	}

	// ── Key Bindings ─────────────────────────────────────────

	collectKeyBindings(
		registry: SchemaRegistry,
		extensionBindings: readonly KeyBinding[] = [],
	): readonly KeyBinding[] {
		return mergeKeyBindings(registry, extensionBindings);
	}

	// ── State ────────────────────────────────────────────────

	getExtensionState<T>(name: string): T | undefined {
		return this._stateMap.get(name) as T | undefined;
	}

	// ── Internal ─────────────────────────────────────────────

	private _resortAndValidate(): void {
		const extensions = [...this._extensions.values()];

		const inDegree = new Map<string, number>();
		const dependents = new Map<string, string[]>();

		for (const ext of extensions) {
			inDegree.set(ext.name, 0);
			dependents.set(ext.name, []);
		}

		for (const ext of extensions) {
			if (!ext.dependencies) continue;
			for (const dep of ext.dependencies) {
				if (!this._extensions.has(dep)) {
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
			sorted.push(this._extensions.get(name)!);
			for (const dependent of dependents.get(name) ?? []) {
				const newDegree = (inDegree.get(dependent) ?? 1) - 1;
				inDegree.set(dependent, newDegree);
				if (newDegree === 0) queue.push(dependent);
			}
		}

		if (sorted.length !== extensions.length) {
			const missing = extensions
				.filter((e) => !sorted.includes(e))
				.map((e) => e.name);
			throw new Error(
				`Circular dependency detected among extensions: ${missing.join(", ")}`,
			);
		}

		this._sorted = sorted;
	}
}

export function collectEditorKeyBindings(
	editor: Editor,
): readonly KeyBinding[] {
	return mergeKeyBindings(editor.schema, editor.facet(keymapFacet));
}

function mergeKeyBindings(
	registry: SchemaRegistry,
	extensionBindings: readonly KeyBinding[],
): readonly KeyBinding[] {
	const bindings: KeyBinding[] = [...extensionBindings];

	for (const schema of registry.allBlocks()) {
		if (schema.keyBindings) {
			for (const binding of schema.keyBindings) {
				bindings.push({
					...binding,
					context: {
						...binding.context,
						blockType: [schema.type],
					},
				});
			}
		}
	}

	return bindings;
}
