# Field-editor teardown

What `FieldEditor.destroy()` releases, how the spine makes backend teardown total, and what is still open. This is not a completeness claim.

There is no `dispose()` on the field editor. The public method is `destroy()` (`packages/types/src/types/fieldEditor.ts`). Adjacent modules use `destroy` (announcer) or `dispose` (geometry, reduced-motion).

## The spine (FE1)

A backend used to register listeners with `addEventListener` and undo them with a mirrored block of `removeEventListener` calls in `deactivate()`. Three backends carried three such mirrors, kept in sync by eye, and a listener added without its removal was a leak nobody could see.

The mirrors are gone. `BackendAttachment` (`src/field-editor/backendAttachment.ts`) is the bookkeeping half of the lifecycle spine: a backend binds everything it holds while attached — DOM listeners, the EditContext's own listeners, mutation observers, Y.Text observers, editor subscriptions — through one attachment, and `release()` undoes them in the order they were bound. Teardown is total by construction, because there is no way to bind without recording the undo.

What stays in a backend's `deactivate()` is what is not bookkeeping: releasing the editing host (`removeAttribute("contenteditable")`), nulling `element.editContext`, and resetting the backend's own state flags.

`src/field-editor/__tests__/fe1.spineTeardown.test.ts` is the claim. It counts every listener and observer the process holds, attaches each of the three backends in turn, exercises it, detaches it, and asserts the count returns to zero — the same assertions against all three, naming the leaked listener when one survives.

## Ownership

Core `editor.destroy()` does not tear down an attached field editor (F21). Hosts own that call.

Shipped hosts already do it on unmount:

- React `EditorRoot` — `packages/rendering/react/src/primitives/editor/root.tsx`
- Vue `PenEditor` — `packages/rendering/vue/src/components/PenEditor.ts`

`destroy()` is not terminal: `FieldEditorImpl.connect()` re-attaches the editor subscriptions it released (P1, the commit feed, the history listener, the session reconciler). React `EditorRoot` calls it in the same effect whose cleanup calls `destroy()`, because StrictMode runs that cleanup and the effect again on one instance.

Those hosts also clear the field-editor slots and their own `focusin` / `focusout` / document `keydown` listeners. `FieldEditorImpl.destroy()` does not clear slots or host listeners. A headless or custom host that constructs `FieldEditorImpl` and never calls `destroy()` leaks the editor subscriptions below.

## `destroy()` sequence today

`FieldEditorImpl.destroy()`:

1. Detach the selection reader (the root's one `selectionchange` listener), then unbind the overlay, focus sink, announcer, and root pointer gesture.
2. Unsubscribe editor `onSelectionChange`, `commit`, and `onHistoryApplied`.
3. `SessionReconciler.destroy()`.
4. `_deactivate({ restoreFocus: false })` — backend `deactivate()` (which releases its attachment), cell coord clear, session flags, `SelectionProjector.reset()` (drops a projection withheld for composition), `SelectionReader.resetGestures()` (closes every gesture window), pending-mark reset, deactivate listeners, store notify. There is no selection write depth, stamp store or deferred history projection to reset: the projector is synchronous and writes only the authority's record (W3.R10).
5. Clear activate / deactivate / store listener sets.
6. `FocusController.destroy()`.

`_deactivate` is what tears down the live input backend. `destroy()` is what tears down the long-lived editor subscriptions that outlive a single session.

## Must-release inventory

Status:

- **Released** — `destroy()` / backend `deactivate()` drops it.
- **Guarded leftover** — a scheduled callback can still fire after `destroy()`, but the live path no-ops. Not cancelled.
- **Open** — still held, or a later callback can re-enter a destroyed editor.
- **Not owned** — field editor never constructs it. Whoever creates it must release it.

### Editor subscriptions

| Resource | Status |
| --- | --- |
| `editor.onSelectionChange` (`_unsubscribeSelection`) | Released |
| `editor.on("commit")` (`_unsubscribeCommit`, the FE4 scheduler feed) | Released |
| `editor.onHistoryApplied` (`_unsubscribeHistoryApplied`) | Released |
| `SessionReconciler` `onDocumentCommit` | Released |
| `SessionReconciler` `decorationsChange` | Released |
| Activate / deactivate / store listener sets | Released |
| Focus-lifecycle listeners (`FocusController`) | Released |
| Selection reader `selectionchange` listener (root document) | Released (`detach`) |
| Field-editor slots (`FIELD_EDITOR_SLOT_KEY` / core slot) | Open — host must clear. React and Vue do. |
| `_rootElement` | Open — left pointing at the last root. |
| `_editor` reference | Open — retained after destroy. |

### Observers

Every entry here is bound through the backend's attachment, so `release()` is what drops it.

| Resource | Status |
| --- | --- |
| ContentEditable `MutationObserver` on the attached element | Released (`disconnect`) |
| ContentEditable `ytext.observe` | Released (`unobserve`) |
| EditContext `ytext.observe` | Released (`unobserve`) |
| ContentEditable / EditContext `decorationsChange` | Released |
| Expanded backend Y.Text / mutation observers | Not used — that backend has neither |
| Geometry `ResizeObserver` on the content root | Not owned — see Geometry |
| `document.fonts.ready` bump | Not owned — see Geometry |

### Listeners (input backends)

Released by the attachment's `release()`, which `deactivate()` calls and `destroy()` reaches through `_deactivate`.

ContentEditable (`contenteditableBackend.ts`): `beforeinput`, `compositionstart`, `compositionend`, `keydown`, `pointerdown`, the shared transfer set. The `contenteditable` attribute is **removed**, never set to `"false"` — an explicit `false` would leave a read-only island inside a wider editing host, and WebKit clamps a selection at such a boundary.

EditContext (`editContextBackend.ts`): element `keydown`, `paste`, `pointerdown`, `compositionstart`, `compositionend`, the shared transfer set; EditContext `textupdate`, `textformatupdate`, `characterboundsupdate`. `element.editContext` is nulled after those listeners are released, so the browser cannot deliver a `textupdate` against a context the backend no longer owns. The `EditContext` object is dropped; it has no separate destroy API.

Expanded (`expandedContentEditableBackend.ts`): `beforeinput`, `keydown`, the shared transfer set.

No backend listens for `selectionchange` or `contextmenu`: the selection reader owns the one `selectionchange` listener per root and the field editor binds the root `contextmenu` and capture `pointerdown` gesture inputs (S1, W3.R4). `contenteditable` and `tabindex` removed.

The shared transfer set is `copy`, `cut`, `dragstart`, `drop`, bound for all three by `bindBackendTransferEvents` (`backendTransferEvents.ts`, FE2).

Host `focusin` / `focusout` / document `keydown` (React root, Vue `PenEditor`): not owned. Those hosts remove them on unmount. A custom host must do the same.

### Scheduled frames (selection, IME, geometry-adjacent)

`DomScheduler` is the only owner of `requestAnimationFrame` in production DOM code (FE3), held by a `no-restricted-syntax` rule in `eslint.config.mjs` that excepts `scheduler.ts` and bans the member forms (`window.` / `globalThis.`) as well as the bare call. The frames below are the scheduler's own, reached through `read` / `write`.

The field editor does not construct the scheduler: `_ensureScheduler()` resolves the one that belongs to the editor root through `getRootGeometry(root)` and feeds it every commit (FE4). The root owns the scheduler and geometry reader; `destroy()` releases the field editor's hold on them (commit feed unsubscribed) but does not dispose them, because a second field editor on the same root still needs them.

| Resource | Status |
| --- | --- |
| Session reconciler flush | Released — queued on `scheduler.write`; `destroy()` unsubscribes the reconciler |
| `FocusController.waitForAttachment` | Same-turn — answers whether the field is attached now; no waiter, no frame. |
| Selection projection | Same-turn — `SelectionProjector.project` writes and reads back synchronously. Only its scroll (one `scheduler.read` + one `scheduler.write`, keyed by record version) and the parked-target check (one `scheduler.write`) are queued; each no-ops once superseded. |
| `CellEditingController.trySyncBackend` | Same-turn — no retries; a cell not mounted yet attaches on its mount ack. |
| `DomScheduler` pending frame | Not owned — the scheduler has no `destroy()`; a pending frame is never cancelled. |

`_deactivate({ restoreFocus: false })` skips restore focus. Destroy does not leave a programmatic focus call queued.

### Announcer

`createAnnouncer` (`src/a11y/announcer.ts`) is the AX2 live region: one `role="status"` node, rate-limit timers (500ms), `announce` / `destroy`.

`Announcer.destroy()` releases pending `setTimeout` keys, the pending / last-written maps, and the live-region node. The field editor binds one per root (`_unbindAnnouncer`) and releases it in `destroy()`. React still has ad-hoc `aria-live` nodes in `selectionRect.tsx`; those unmount with the primitive, not via `FieldEditor.destroy()`.

### Geometry

`createGeometryReader` (`src/geometry/geometryReader.ts`) must release, on `dispose()`:

- `ResizeObserver` on the content root (`disconnect`)
- the capture-phase `scroll` listener on the root's document (G2)
- per-block measure cache
- the disposed flag so a late `fonts.ready` callback does not bump generations

`dispose()` exists. It does **not** cancel `document.fonts.ready` (the promise has no abort; the callback is only guarded). `blockCommitIds` is not cleared (harmless once disposed).

Because nothing in production calls `dispose()`, the `scroll` listener also removes itself the first time it fires with a disconnected root. The document outlives the root, so a listener that only waited for `dispose()` would keep an unmounted root and its cache alive.

The reader belongs to the editor root, not to the field editor: `getRootGeometry(root)` creates one reader and one scheduler per root and caches them against the root element. Whoever owns the root disposes them. The field editor's commit feed keeps the reader's caches honest while it is attached (FE4) and stops feeding on `destroy()`.

### Adjacent modules (not field-editor owned)

Listed so this file does not imply they ride along:

| Module | Release API | Wired to field editor? |
| --- | --- | --- |
| `createGeometryReader` | `dispose()` | Through `getRootGeometry`; the root owns it |
| `DomScheduler` | none — pending `requestAnimationFrame` is never cancelled | Through `getRootGeometry`; fed and projected while attached |
| `createReducedMotionSignal` | `dispose()` (removes `matchMedia` `change`) | No |
| Overlay layer (conformance harness `harness/src/overlays/`) | host unmount of the layer node | No |

## Still open

- Core `editor.destroy()` still does not call field-editor `destroy()` (F21). Hosts must.
- Slots, `_rootElement`, and the editor reference survive field-editor `destroy()`.
- Queued scheduler work is not cancelled on teardown. The projection scroll and parked-target jobs above are guarded but still run.
- The root's geometry reader and scheduler have no owner that disposes them when the root goes away.
- `destroy()` is not documented as idempotent. A second call runs `SessionReconciler.destroy()` again.
