# `@input/pen-markdown`

`@input/pen-markdown` is not a package to install alone. Install `@input/pen-interop` and import `markdownExporter` from `@input/pen-interop/markdown`, which is the host-facing markdown exporter and runs URL admission on the serialized output.

This package owns the shared markdown serializer used by that exporter and by a few other Pen packages. It does not create an editor, apply ops, or admit URLs.

## Install

This package has no peer dependencies. Hosts should install `@input/pen-interop` instead of depending on this package directly.

```bash
pnpm add @input/pen @input/pen-markdown
```

`engines.node` is `^22.22.2 || ^24.15.0 || >=26.0.0`.

## Usage

```ts
import { createEditor } from "@input/pen";
import { exportMarkdownForBlocks } from "@input/pen-markdown";

const editor = createEditor();
const markdown = exportMarkdownForBlocks(
  editor,
  editor.documentState.allBlocks(),
);
```

`exportMarkdownRange(editor, range)` serializes a start/end block-id span. Omit `range`, or pass a range with no ids, to serialize every block. Hosts that need the admitted URL form should call `markdownExporter` from `@input/pen-interop/markdown` instead.

## Options

| Option     | Default | Effect                                     |
| ---------- | ------- | ------------------------------------------ |
| `viewMode` | `"raw"` | `"resolved"` drops delete-suggestion spans |

`MarkdownExportRange.startBlockId` and `endBlockId` default to the first and last block when omitted.

## Documentation

The docs site (the `@input/pen-docs` package) covers this area on the Import and export page (`#/import-export`).

The public signatures of record are in `api-report.md` next to this package's source in the Pen repository. The docs site does not host a generated browsable reference.

## License

MIT © Input B.V. See [`LICENSE.md`](./LICENSE.md).
