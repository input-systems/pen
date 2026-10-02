# @input/pen-undo

Undo/redo extension with origin tagging for Pen.

`defaultPreset()` installs this extension. A bare `createEditor()` does not. Without it, `editor.undoManager` is an inert stub: `canUndo()` is false, `undo()` does nothing, Mod-Z is dead, and nothing throws.

This package does not reimplement Yjs stack trimming; the Yjs adapter trims oldest items past `maxDepth`.

## Install

```bash
pnpm add @input/pen-undo
```

## Stack depth

`undoExtension({ maxDepth })` caps how many undo/redo stack items are retained (CH7). The default is `DEFAULT_UNDO_MAX_DEPTH` (500). Y.UndoManager has no native cap; the Yjs adapter trims the oldest `undoStack` / `redoStack` items when a new stack item is added past the limit. This package accepts the option and default — it does not reimplement the trim.

```ts
import { undoExtension, DEFAULT_UNDO_MAX_DEPTH } from "@input/pen-undo";

undoExtension();
undoExtension({ maxDepth: DEFAULT_UNDO_MAX_DEPTH });
undoExtension({ maxDepth: 100 });
```

## Tracked origins

By default, undo tracks `user`, `ai`, and `import`. `collaborator`, `unknown`, and `migration` stay untracked, so remote edits, unclassified ops, and document upgrades cannot be undone locally.

## Options

| Option           | Default                        | Effect                                   |
| ---------------- | ------------------------------ | ---------------------------------------- |
| `maxDepth`       | `DEFAULT_UNDO_MAX_DEPTH` (500) | Cap on undo/redo stack items             |
| `groupTimeout`   | `400`                          | Capture window for ungrouped typing (ms) |
| `trackedOrigins` | `user`, `ai`, `import`         | Origins captured on the local undo stack |

## Facets and commands

This package contributes no facets and no commands. It requires no other extensions. `defaultPreset()` installs it next to tools, delta-stream, and shortcuts.

## Documentation

The docs site (the `@input/pen-docs` package) covers this area on the Extensions and facets page (`#/extensions`).

The public signatures of record are in `api-report.md` next to this package's source in the Pen repository. The docs site does not host a generated browsable reference.

## License

MIT © Input B.V. See [`LICENSE.md`](./LICENSE.md).
