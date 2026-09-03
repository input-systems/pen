# `@input/pen-yjs`

Yjs integration for Pen.

This package provides:

- the Pen Yjs CRDT adapter via `yjsAdapter()`
- Yjs awareness helpers
- a thin provider wrapper for multiplayer sessions
- Yjs state-vector helpers for sync/workflow barriers
- generic Yjs text and array field adapters for host-owned CRDT fields
- generic extension-root helpers for app-owned Yjs maps under `apps`

It does **not** implement WebSocket transport or a custom Yjs sync provider.

## Install

```bash
pnpm add @input/pen-yjs yjs y-protocols
```

Required peers are `yjs` (`^13.6`) and `y-protocols` (`^1.0.7`). `engines.node` is `>=22`.

## State barriers

```ts
import * as Y from "yjs";
import {
  encodeYjsStateVectorBase64,
  isYjsStateVectorBase64Satisfied,
} from "@input/pen-yjs";

const ydoc = new Y.Doc();
const required = encodeYjsStateVectorBase64(ydoc);
const currentStateVector = encodeYjsStateVectorBase64(ydoc);
const ready = isYjsStateVectorBase64Satisfied(currentStateVector, required);
```

Use state-vector helpers when a host workflow needs to wait until a synced document includes a known local edit.

## Field adapters

```ts
import * as Y from "yjs";
import {
  createYArrayFieldAdapter,
  createYTextFieldAdapter,
} from "@input/pen-yjs";

const ydoc = new Y.Doc();

const title = createYTextFieldAdapter({
  doc: ydoc,
  root: ydoc.getMap("app"),
  key: "title",
  normalize: (value) => value.trim(),
});

const tags = createYArrayFieldAdapter<{ id: string }>({
  doc: ydoc,
  root: ydoc.getMap("app"),
  key: "tags",
  getId: (tag) => tag.id,
});
```

Adapters are storage helpers only. Product validation, labels, contacts, auth, and delivery semantics belong in the host app.

## Extension roots

```ts
import * as Y from "yjs";
import { ensureExtensionRoot, readExtensionRoot } from "@input/pen-yjs";

const ydoc = new Y.Doc();

const root = ensureExtensionRoot({
  doc: ydoc,
  namespace: "com.example.workflow",
  version: 1,
  shape: {
    title: "text",
    requests: "array",
  },
});

const existing = readExtensionRoot({
  doc: ydoc,
  namespace: "com.example.workflow",
});
```

Extension roots give host apps a predictable place for CRDT-backed data that travels with the Pen document while staying outside Pen's core block model.

## Collaboration boundary

What Pen guarantees versus what the host owns is stated in [COLLABORATION.md](./COLLABORATION.md). `pen.ariaReadOnly` the facet only sets `aria-readonly`. It does not decline typing or stop `editor.apply`. The renderer `readonly` prop is what declines typing. Neither stops the wire.

When using multiplayer with Yjs, Pen expects the application to choose the provider and hand Pen a `MultiplayerSession`.

`@input/pen-yjs` exposes the minimal helpers needed for that:

```ts
import {
  createYjsProviderSession,
  getYjsAwareness,
  getYjsDoc,
} from "@input/pen-yjs";
```

## Canonical `y-websocket` setup

This is the recommended setup when using [`y-websocket`](https://docs.yjs.dev/ecosystem/connection-provider/y-websocket):

```ts
import { createEditor } from "@input/pen-core";
import {
  createYjsProviderSession,
  getYjsAwareness,
  getYjsDoc,
} from "@input/pen-yjs";
import { multiplayerExtension } from "@input/pen-multiplayer";
import { WebsocketProvider } from "y-websocket";

const editor = createEditor({
  extensions: [
    multiplayerExtension({
      user: { id: "u1", name: "Ada" },
      sessionFactory: ({ editor, awareness }) => {
        const provider = new WebsocketProvider(
          "ws://localhost:1234",
          "room-a",
          getYjsDoc(editor),
          {
            awareness: getYjsAwareness(awareness),
            connect: false,
          },
        );

        return createYjsProviderSession({
          connect: () => provider.connect(),
          disconnect: () => provider.disconnect(),
          destroy: () => provider.destroy(),
          getStatus: () => {
            if (provider.wsconnected) {
              return "connected";
            }

            if (provider.wsconnecting) {
              return "connecting";
            }

            return "disconnected";
          },
          getIsSynced: () => provider.synced,
          onStatusChange: (listener) => {
            const handleStatus = (event: {
              status: "disconnected" | "connecting" | "connected";
            }) => {
              listener(event.status);
            };

            provider.on("status", handleStatus);
            return () => {
              provider.off("status", handleStatus);
            };
          },
          onSync: (listener) => {
            provider.on("sync", listener);
            return () => {
              provider.off("sync", listener);
            };
          },
        });
      },
    }),
  ],
});
```

For a concrete repository reference, see
`playground/src/collaboration/session.ts`, whose `createCollaborationExtension()`
wraps a `y-websocket` provider with `createYjsProviderSession()`.

## Why `getYjsAwareness()` exists

Pen exposes a generic awareness interface through `@input/pen-types`, but Yjs providers such as `y-websocket` expect the underlying native Yjs `Awareness` instance.

Use:

- `getYjsDoc(editor)` to access the raw `Y.Doc`
- `getYjsAwareness(awareness)` to access the raw Yjs awareness object

## Provider adapter notes

`createYjsProviderSession()` works best when the provider adapter supplies:

- `onStatusChange()`
- `onSync()` when the provider distinguishes connected from fully synced
- `getStatus()` and `getIsSynced()` when the provider may already be active before Pen wraps it

If `onSync()` is omitted, a connected provider is treated as fully connected rather than `syncing`.

## Compaction

Pen reports document growth and does not compact documents. On load, a document whose encoded size meets a stated byte threshold emits a `document-size` diagnostic carrying encoded byte size, block count, and whether GC is enabled. That measurement is not taken per commit.

`PenPersistence.compact()` is host-implemented: Pen never calls it. Three mechanisms exist, and they do different things:

- **`mergeUpdates` / `mergeYjsUpdates`.** `Y.mergeUpdates` folds a sequence of Yjs updates into one update that encodes the same document state. That shrinks an _update log_ a host has been appending. It does not remove tombstones — deleted blocks and characters stay in the CRDT until GC collects them.
- **Snapshot retention.** `@input/pen-snapshots` writes version snapshots through `PenPersistence.saveVersionSnapshot` and restores them with `loadVersion`. Pen does not delete snapshots. A host that drops older snapshot rows reclaims that snapshot storage and cannot restore those versions.
- **`gc: true`.** `yjsAdapter()` defaults to `gc: false` so deleted Yjs content stays restorable for undo and history. Passing `yjsAdapter({ gc: true })` lets Yjs collect deleted items and gives up restore of those old deletions.

Which combination a host uses depends on whether it ships version history. Pen does not pick one.

## Options

`yjsAdapter(options?)` accepts:

| Option         | Default | Effect                                                                          |
| -------------- | ------- | ------------------------------------------------------------------------------- |
| `gc`           | `false` | Y.Doc GC. `false` keeps deleted content restorable for undo and history         |
| `onDiagnostic` | no-op   | Receives CRDT diagnostics (malformed updates, document-size, unlabeled origins) |
| `onRecovered`  | unset   | Called with `"repair"` when `loadDocument` recovers a document                  |

`createYjsProviderSession()` takes a `YjsProviderAdapter` (`connect`, `disconnect`, `destroy`, `onStatusChange`; optional `getStatus`, `getIsSynced`, `onSync`). That is a required adapter object, not a defaults table.

## Documentation

The docs site (the `@input/pen-docs` package) covers this area on the Collaboration page (`#/collaboration`).

The public signatures of record are in `api-report.md` next to this package's source in the Pen repository. The docs site does not host a generated browsable reference.

## License

MIT © Input B.V. See [`LICENSE.md`](./LICENSE.md).
