# @input/pen-snapshots

Snapshot history and attribution primitives for Pen.

This package stores version snapshots through a host `PenPersistence`. It does not treat awareness names as authors and does not delete snapshots.

## Install

```bash
pnpm add @input/pen-snapshots
```

## COL3: `resolveAuthor` is host-authoritative

Yjs records only a numeric `clientId`. That is an opaque session number — not a user, not stable across reloads, and not attributable on its own.

The host resolver is authoritative. `getCharacterAttribution` and `buildBlameRanges` resolve identity through `resolveAuthor` (`clientId` → author). The controller's `getBlameRanges(blockId)` is that same path. Pen stamps `verified: true` on that result. Presence names never become `author` and are not stored on a snapshot.

Peer-asserted presence stays on `displayHint` (`unverified: true`). That field is an unverified display hint (a live cursor label), not authorship.

Pass the resolver on `snapshotsExtension`:

```ts
import { snapshotsExtension } from "@input/pen-snapshots";
import type { PenPersistence } from "@input/pen-types";

declare const persistence: PenPersistence;

const usersByClientId = new Map<
  number,
  { id: string; name: string; color: string }
>([[1, { id: "u1", name: "Ada", color: "#4f46e5" }]]);

snapshotsExtension({
  persistence,
  docId: "doc-1",
  resolveAuthor(clientId) {
    const user = usersByClientId.get(clientId);
    if (!user) return null;
    return { id: user.id, name: user.name, color: user.color };
  },
});
```

`resolveAuthor` is the attribution trust boundary. Return only identities the host has verified (session, auth token, or user table).

- **Resolver returns an identity:** `author` is that identity (`verified: true`).
- **No resolver, or the resolver returns null:** `author` is an opaque client handle (`verified: false`, `name: "User 77"`, `clientId: 77`). Never a peer-supplied display name.
- **Presence:** `displayHint` only. Do not render it as authorship.

An unnamed author is honest; a forgeable name is not.

## Options

| Option          | Default  | Effect                                                                                                                                        |
| --------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `persistence`   | required | Host `PenPersistence`                                                                                                                         |
| `docId`         | required | Document id used for snapshot rows                                                                                                            |
| `resolveAuthor` | unset    | Host-verified `clientId` → author. Omit for an opaque client handle                                                                           |
| `autoSnapshot`  | on       | `false` disables the scheduler. Object fields default to `intervalMs` 300000, `opThreshold` 100, `onSessionStart` true, `onAIGeneration` true |

## Facets and commands

Contributes the history controller facet (`SNAPSHOTS_CONTROLLER_SLOT`). It contributes no commands. Requires no other extensions. Attribution is honest only when the host passes `resolveAuthor`.

## Documentation

The docs site (the `@input/pen-docs` package) covers this area on the Extensions and facets page (`#/extensions`).

The public signatures of record are in `api-report.md` next to this package's source in the Pen repository. The docs site does not host a generated browsable reference.

## License

MIT © Input Systems B.V. See [`LICENSE.md`](./LICENSE.md).
