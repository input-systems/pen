# `@input/pen-ingest`

`@input/pen-ingest` is a shared library for turning imported or authored content into `DocumentOp`s. Hosts do not install it alone — install `@input/pen`, or `@input/pen-core` plus the import / tools extensions that consume this package.

This is the live workspace package at `packages/shared/ingest`. It is not the deleted `packages/extensions/content-ops` husk (CH6). Core owns `blocksToOps` and the profile-policy helpers; import those from `@input/pen-core`. This package is the parse/write layer on top.

## Install

```bash
pnpm add @input/pen-ingest
```

## What this package does

- Parse markdown or plain text into pending blocks.
- Turn parsed or authored content into write ops (`buildDocumentWriteOps`).
- Share structured-target types used by tools.

## What this package does not do

- It is not an editor, importer extension, or host entry point.
- It does not apply ops — callers pass the result to `editor.apply`.
- It does not own the deleted husk path. The core → content-ops DAG edge is gone.
- `parseMarkdownToBlocks` is parse-only: it does not drop unknown or flow-disallowed types. Callers that need that run `normalizePendingBlocksForImport` from `@input/pen-core`.
- `buildDocumentWriteOps` passes `position` through to core's `blocksToOps` (`"last"` if omitted).

## Public exports

The index is the public surface. Unused former exports (`TARGET_EDITABILITIES`, `STRUCTURED_TARGET_KINDS`, `normalizePlanProps`, `normalizePlanRecord`, `normalizePlanSteps`, `PlanRecord`) are not on it. Internal modules (`astToBlocks`, `htmlInline`, `inlineMarks`, `tableParser`) are not either.

| Export                                                                                                                                   | Role                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `parseMarkdownToBlocks`                                                                                                                  | Markdown → pending blocks. Used by interop markdown, `buildDocumentWriteOps`, and autocomplete.                                  |
| `splitPlainTextLineBlocks`                                                                                                               | Plain text → trimmed line strings (leading/trailing empty lines stripped). Used by AI replacement and autocomplete.              |
| `buildDocumentWriteOps`                                                                                                                  | Text, markdown, or block input → write ops (normalizes first). Used by tools (re-export + write tool) and AI via that re-export. |
| `DocumentWriteFormat`, `DocumentWriteBlockInput`, `BuildDocumentWriteOpsOptions`, `BuildDocumentWriteOpsResult`                          | Write-ops option/result types.                                                                                                   |
| `StructuredTargetDescriptor` and members (`StructuredTargetKind`, `TargetEditability`, `BlockTargetDescriptor`, `TableTargetDescriptor`) | Structured-target types. Used by tools. Kind/editability const arrays are not exported.                                          |

### `buildDocumentWriteOps` options

| Field      | Default                                                   |
| ---------- | --------------------------------------------------------- |
| `format`   | `"blocks"` when `blocks` is non-empty, otherwise `"text"` |
| `content`  | `""` (empty content returns empty blocks and ops)         |
| `blocks`   | `[]` when `format` is `"blocks"`                          |
| `position` | passed through to `blocksToOps` (`"last"` if omitted)     |
| `surface`  | `"write-content:${format}"`                               |

## Usage

```ts
import { blocksToOps } from "@input/pen-core";
import { parseMarkdownToBlocks } from "@input/pen-ingest";
import type { Editor } from "@input/pen-types";

declare const editor: Editor;

const blocks = parseMarkdownToBlocks("# Hello", { schema: editor.schema });
editor.apply(blocksToOps(blocks, { position: "last" }), { origin: "import" });
```

Hosts that import markdown or write documents should use `@input/pen-interop/markdown` or `@input/pen-tools` instead of calling this package directly.

## Documentation

The docs site (the `@input/pen-docs` package) covers this area on the Core concepts page (`#/core-concepts`).

The public signatures of record are in `api-report.md` next to this package's source in the Pen repository. The docs site does not host a generated browsable reference.

## License

MIT © Input Systems B.V. See [`LICENSE.md`](./LICENSE.md).
