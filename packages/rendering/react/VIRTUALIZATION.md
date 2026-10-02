# SCALE5 host virtualization

Pen does not window blocks. Windowing is a host concern (`spec/rules/scale.md` SCALE5, `spec/rules/dom.md`). `EditorContent` and `PenEditor` have no `virtualize` prop.

## Contract

- **Unmount is allowed.** A host may omit any block that does not hold the active field editor or an active selection endpoint. Document state is untouched. Decorations are still computed; they are not rendered.
- **Remount does nothing.** The host must not rehydrate, replay, or patch the remounted block. Reconciliation is idempotent.
- **An unmounted selection target parks.** When selection targets an unmounted block, projection parks without a diagnostic and runs when the scheduler next projects or a renderer acknowledges the block's mount. `selection-target-unmounted` (level `warn`, `spec/rules/selection.md` P) is emitted once per record version only when the target's element is present and projection into it fails.

`packages/tooling/conformance/scenarios/scale5-virtualization.spec.ts` exercises the contract on a windowed fixture (40 blocks, window of 8).
