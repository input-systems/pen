# Field-editor input backends

HOST4 (`spec/rules/host.md`): `EditContext` is newer than the HOST3 browser floor. The field editor detects it and falls back; it does not require it. Browser floors live in the root `README.md` support table.

Selection of the backend is `_resolveBackendClass` in `src/field-editor/fieldEditorImpl.ts`; its doc comment states the split. Detection and fallback are unchanged by this document.

## One spine, three input technologies

There are not three parallel implementations. The lifecycle is shared and a backend owns only the input technology it speaks (FE1/FE2):

- `BackendLifecycleController` (`backendLifecycleController.ts`) owns which backend exists: create, replace on a surface-mode or element change, deactivate.
- `InputBackendBase` (`inputBackendBase.ts`) owns what every backend holds while attached — element, attachment, editor, field editor — and the contenteditable host and input-event bindings; its `FieldInputBackendBase` adds the single-field state (`Y.Text`, observer, decoration signature), the field rebuild, the delta patch, and the decoration-change rebuild. A backend class extends one of them and adds its input technology (CS5).
- `BackendAttachment` (`backendAttachment.ts`) owns what a backend holds while attached. Listeners, observers, and subscriptions are bound through it, and one `release()` undoes them — so teardown is total by construction rather than by a mirrored block of `removeEventListener` calls per backend. See `FIELD-EDITOR-TEARDOWN.md`.
- `bindBackendTransferEvents` (`backendTransferEvents.ts`) owns clipboard and drag, which are identical in every backend: copy and cut go through the transfer path, drag is refused at both ends.
- `inlineDecorationsForBlock` (`utils/inlineDecorations.ts`) owns which inline decorations a block renders.
- `DomScheduler` owns frames. No backend calls `requestAnimationFrame` (FE3), and the field editor feeds every commit to the root's scheduler so geometry caches follow the document (FE4).
- The selection reader (`selectionReader.ts`) owns reading the DOM selection and the projector (`selectionProjector.ts`) owns writing it (S1). A backend's `updateSelection()` is the one place it writes the authority's record into its own input technology (a native range, or the EditContext selection), and the projector calls it. Backends keep no selection state of their own besides the FE9 typing caret: no stamp store, write depth, echo predicate or stale-caret guard (W3.R10).
- A passive or `domFocus: false` attach passes its focus options to the backend's `activate()`, so the backend's own focus request leaves focus where it is. There is no suppression flag.

What is left in each backend is its delta:

| Backend                             | Owns                                                                                                                                                                                                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `editContextBackend.ts`             | The `EditContext` object and its `textupdate` / `textformatupdate` / `characterboundsupdate` plumbing, the C4 composition phase (`compositionPhase`), the FE9 trusted typing caret, composition-cancel on Escape, clipboard paste as a `paste` event |
| `contenteditableBackend.ts`         | `beforeinput` dispatch through `DIRECT_HANDLERS`, the composition-event path, the B1 mutation watchdog that restores foreign DOM rewrites (`ignoreBrowserMutations`, `lastWatchdogMismatch`), table-cell branches                                    |
| `expandedContentEditableBackend.ts` | The multi-block editing host: one `contenteditable` on the blocks host, cross-block replace and delete, and the handoff back to a single-block backend when a split or a collapse ends expanded mode                                                 |

## Detection

On a single-block field that is not a table cell, the runtime uses EditContext when `globalThis.EditContext` is a constructor (`"EditContext" in globalThis` and `typeof EditContext === "function"`). That is Chromium 121+ today. Firefox and Safari have no constructor, so they never take this branch.

## Fallback

Missing EditContext selects `ContentEditableBackend`. That path is real: the element gets `contentEditable = "true"` and input goes through `beforeinput`, `compositionstart` / `compositionend`, and a mutation observer.

Two surfaces always use contenteditable, even when EditContext exists:

- expanded (multi-block) editing → `ExpandedContentEditableBackend`
- table-cell editing → `ContentEditableBackend`

## User-visible degradation

The field stays editable. Typing, paste, and undo still apply.

Without EditContext, IME is the contenteditable composition-event path instead of EditContext `textupdate`:

- A commit is recognised from the event sequence, not from a clock. If the live DOM already differs from the recorded start text, or `compositionend.data` is already in the field, the fallback reconciles in the same turn.
- Safari may fire `compositionend` before the last DOM mutation. The start text stays recorded, and the sequence completes on the following mutation — or, for a GBoard fast cycle where a second `compositionstart` arrives first, on that `compositionstart`, which flushes the leftover so the earlier commit is not dropped.
- Composition underline and IME candidate-window bounds follow the native contenteditable caret. EditContext paints underline from `textformatupdate` and reports character bounds via `characterboundsupdate`.

This replaced a 50ms `Date.now()` window plus a `requestAnimationFrame` retry, which stood in for "the field already has the committed text" and got it wrong twice: a multi-character commit missed the same-turn path, and a second `compositionstart` arriving before the rAF made it bail and drop the first commit (conformance C3).

## Teardown

`FieldEditorImpl.destroy()` deactivates the current backend — its attachment releases every listener, observer, and subscription it bound — and then drops the long-lived editor subscriptions. Core `editor.destroy()` does not. What that call actually releases, and what is still open, is in `FIELD-EDITOR-TEARDOWN.md`.
