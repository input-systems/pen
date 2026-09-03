# `@input/pen-multiplayer`

Headless collaboration primitives for Pen.

This package owns editor-facing multiplayer behavior:

- local awareness publishing
- peer derivation
- remote cursor and selection state
- controller state
- multiplayer decorations

It does **not** own transport, reconnect, auth, or Yjs wire protocol behavior.

## Install

```bash
pnpm add @input/pen-multiplayer
```

This package has no peer dependencies. `engines.node` is `>=22`.

## Presence is host-provided and untrusted

`config.user` (and any other awareness fields the host publishes) is **host-provided and visible to every peer**. Do not put an email, internal id, or other secret in presence unless it is meant to be broadcast.

## COL2: Awareness is validated on read

Pen treats remote awareness as untrusted input. One validator owns the payload and runs **on receipt**, before any peer state reaches identity, decorations, or the author ledger. Local state is published as its own latest value; peers validate what they receive.

**Hostile or invalid presence is ignored.** That peer degrades to invisible. The document is unchanged. Pen emits a `presence-rejected` diagnostic (`PRESENCE_REJECTED_CODE`) with a reason. One bad peer never breaks the others.

| Reason                | When                                                                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `oversized`           | A string or the whole payload exceeds a bound                                                                                             |
| `wrong-typed`         | Invalid shape or type, a forbidden key (`__proto__`, `constructor`, `prototype`), or offset-form cursor/selection (`{ blockId, offset }`) |
| `script-bearing`      | Script/markup in a string, or a hostile avatar scheme                                                                                     |
| `nonexistent-block`   | A block or cell selection names a block that is not in the local document                                                                 |
| `out-of-range-offset` | Reserved; cursor offsets are no longer on the wire                                                                                        |
| `out-of-range-cell`   | A cell selection names a block that holds no grid, or a row/column outside it                                                             |
| `rate-limited`        | More than `MAX_PRESENCE_UPDATES_PER_SECOND` updates from that peer                                                                        |
| `peer-cap`            | Extra peers past `MAX_TRACKED_PEERS`                                                                                                      |

Awareness `cursor` / text `selection` are serialized anchors only (`{ anchor, clock }` / `{ anchor, head, clock }`). Offset-form payloads are `wrong-typed` and never reach the decoder. The shape and `MAX_PRESENCE_ANCHOR_LENGTH` checks run before decode.

### Cell selections

A peer inside a table publishes `{ kind: "cell", blockId, anchor, head, clock }` with `{ row, col }` endpoints and **no cursor**: a grid cell is the smallest region this presence names, so there is no caret to place. Coordinates rather than anchors match AS3 — cell selections are driven by the commit summary's structural data, not by in-block text identity.

The grid itself is the bound. Ingest rejects a cell on a block that holds no grid, and resolve re-reads the grid on every commit and clamps the held endpoints into it, so a peer whose rows were deleted under them lands on a live cell instead of vanishing. A deleted table drops the peer until their next awareness frame.

Cell selections emit **no decorations** — there is no cell-scoped decoration type, and a table block has no block-level text to carry an inline one. Renderers paint them from controller state: `@input/pen-react`'s table renderer marks the occupied cells (see its `STYLING.md`), and `resolveRemoteCellPresence` is exported for hosts rendering their own grid.

### AI runs

A peer whose AI is generating publishes `streaming: { blockId }`, and `getRemoteStreaming()` resolves it into the peers writing into live blocks. The block id is the entire payload: the generated text is a local decoration on the client that asked for it and never enters the document, so naming the block is all a collaborator can be shown. The extension marks that block with a `pen-multiplayer-streaming` block decoration; the run's own client publishes the key and clears it when the run ends.

A bad `user` drops the whole peer. A bad cursor, selection, or streaming payload is dropped for that field only; a valid user can still appear. A serialized anchor that does not resolve hides that caret until the next awareness frame — the peer is not treated as departed. Pen declares four top-level keys — `user`, `cursor`, `selection`, `streaming` — and ignores every other key, so hosts may carry their own presence data as long as they do not reuse one of those four; Pen never interprets it.

### Peer cap and rate limit

- **Rate limit.** After `MAX_PRESENCE_UPDATES_PER_SECOND` accepted updates from a peer in a one-second window, further updates are ignored and that peer keeps its last accepted state.
- **Send rate.** Because a rejected update leaves a peer holding a caret that has already moved, Pen coalesces its own presence writes to one per `LOCAL_PRESENCE_MIN_INTERVAL_MS`. The first move of an interval is published immediately and everything after it folds into one trailing write carrying the latest selection, which keeps a fast typist well inside what peers accept. Publishing on every selection change would not.
- **Peer cap.** After `MAX_TRACKED_PEERS` remote peers, extra peers are counted (`untrackedPeerCount` on the diagnostic) and not rendered. The document does not degrade.

| Bound                         | Constant                           | Default |
| ----------------------------- | ---------------------------------- | ------- |
| Display name                  | `MAX_PRESENCE_DISPLAY_NAME_LENGTH` | 64      |
| User id                       | `MAX_PRESENCE_USER_ID_LENGTH`      | 128     |
| Avatar URL                    | `MAX_PRESENCE_AVATAR_URL_LENGTH`   | 2048    |
| Color                         | `MAX_PRESENCE_COLOR_LENGTH`        | 64      |
| Awareness bytes per peer      | `MAX_PRESENCE_BYTES_PER_PEER`      | 4096    |
| Serialized presence anchor    | `MAX_PRESENCE_ANCHOR_LENGTH`       | 768     |
| Block ids per block selection | `MAX_PRESENCE_BLOCK_SELECTION_IDS` | 256     |
| Cursor / selection offset     | `MAX_PRESENCE_OFFSET`              | 1048576 |
| Updates per second per peer   | `MAX_PRESENCE_UPDATES_PER_SECOND`  | 30      |
| Local presence write interval | `LOCAL_PRESENCE_MIN_INTERVAL_MS`   | 50      |
| Tracked peers per document    | `MAX_TRACKED_PEERS`                | 32      |

Avatar URLs go through `pen.urlPolicy` (image context) and then a second image-scheme check: `http:`, `https:`, relative, and `data:image` for png/jpeg/gif/webp/avif. Hostile schemes are rejected as `script-bearing`. A host policy that denies a URL strips the avatar and keeps the peer.

`user.color` is admitted only when `normalizeMultiplayerColor` accepts it. A CSS-injectable string such as `red;position:absolute` is stripped at ingest. Presence decorations carry no `style` attribute at all — SEC2 drops one anyway — so style them through `data-user-id` and read the colour off `RemoteCursorState.user.color` when drawing your own caret.

Remote cursor `data-user-id` / `data-user-name` are set as attribute values; the display name is capped and rendered as text, never interpolated into markup.

## Identity is host-owned

The host owns identity. Peer-asserted `user.id` / `user.name` are unverified display hints for live carets, not authorship.

- `config.user` is what this client publishes. Every peer will see it.
- `resolvePeerIdentity` customizes live caret labels only. Identities that come from awareness or the author ledger are stamped `unverified: true` and export as `asPresenceDisplayHint`. They are never verified authorship.
- Attribution in `@input/pen-snapshots` does not treat awareness names as authors. Without a host `resolveAuthor`, blame shows an opaque client handle (`User 77`), never a peer-supplied name.

## Design

`@input/pen-multiplayer` is built around a small session interface from `@input/pen-types`:

```ts
import type { ConnectionState, Unsubscribe } from "@input/pen-types";

export interface MultiplayerSession {
  readonly connectionState: ConnectionState;
  connect(): void;
  disconnect(): void;
  destroy(): void;
  onStateChange(listener: (state: ConnectionState) => void): Unsubscribe;
}
```

The extension accepts either a ready-made session or a `sessionFactory`:

```ts
import { multiplayerExtension } from "@input/pen-multiplayer";
import type { MultiplayerSession } from "@input/pen-types";

const session: MultiplayerSession = {
  connectionState: "disconnected",
  connect() {},
  disconnect() {},
  destroy() {},
  onStateChange() {
    return () => {};
  },
};

multiplayerExtension({
  user: { id: "u1", name: "Ada" },
  session,
});
```

```ts
import { multiplayerExtension } from "@input/pen-multiplayer";
import type { MultiplayerSession } from "@input/pen-types";

const session: MultiplayerSession = {
  connectionState: "disconnected",
  connect() {},
  disconnect() {},
  destroy() {},
  onStateChange() {
    return () => {};
  },
};

multiplayerExtension({
  user: { id: "u1", name: "Ada" },
  sessionFactory: ({ editor, awareness }) => {
    return session;
  },
});
```

## Recommended setup

If you are using Yjs, prefer:

- `@input/pen-multiplayer` for the multiplayer extension and controller state
- `@input/pen-yjs` for Yjs integration helpers
- an external provider such as [`y-websocket`](https://docs.yjs.dev/ecosystem/connection-provider/y-websocket) for transport

That keeps Pen transport-agnostic and lets the application choose its own provider model.

## Example

See `@input/pen-yjs` for the canonical `y-websocket` integration example using:

- `getYjsDoc()`
- `getYjsAwareness()`
- `createYjsProviderSession()`

For a concrete repository reference, see the playground collaboration wiring in
`playground/src/collaboration/session.ts`.

## Options

`multiplayerExtension(config)` accepts:

| Option                | Default  | Effect                                                                                       |
| --------------------- | -------- | -------------------------------------------------------------------------------------------- |
| `user`                | required | Host-provided presence published on awareness. Visible to every peer                         |
| `autoConnect`         | `true`   | When a session is present, connect unless `false`                                            |
| `session`             | unset    | Ready-made `MultiplayerSession`                                                              |
| `sessionFactory`      | unset    | `(context) => MultiplayerSession` receiving `{ editor, awareness }`                          |
| `resolvePeerIdentity` | unset    | Customizes live caret labels only. Identities from awareness or the ledger stay `unverified` |

Presence ingest bounds (display name, peer cap, rate limit) are the package constants in the table above. They are not `multiplayerExtension` options.

## Facets and commands

Contributes the multiplayer controller facet (`multiplayer.controller` / `MULTIPLAYER_CONTROLLER_SLOT`). It contributes no commands. Requires no other extensions. The extension requires a CRDT adapter that provides awareness (`editor.internals.awareness`); the Yjs adapter does. `defineExtension` on this package declares no `dependencies`.

## Documentation

The docs site (the `@input/pen-docs` package) covers this area on the Collaboration page (`#/collaboration`).

The public signatures of record are in `api-report.md` next to this package's source in the Pen repository. The docs site does not host a generated browsable reference.

## License

MIT © Input B.V. See [`LICENSE.md`](./LICENSE.md).
