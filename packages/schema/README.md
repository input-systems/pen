# `@input/pen-schema`

Default block and inline schemas for Pen.

This package describes document structure. It does not render blocks, install extensions, or ship CSS.

## Install

```bash
pnpm add @input/pen-core @input/pen-schema
```

## What It Provides

- `defaultSchema` for the standard shipped schema
- `createDefaultSchema()` when you want a fresh schema instance
- `defaultBlocks` and `defaultInlines` for lower-level composition
- direct exports for common blocks such as `paragraph`, `heading`, and `table`

## Minimal Setup

```ts
import { createEditor } from "@input/pen-core";
import { createDefaultSchema } from "@input/pen-schema";

const editor = createEditor({
  schema: createDefaultSchema(),
});
```

This installs the default blocks and no extensions. Undo is an inert stub (`canUndo()` false, Mod-Z dead, no error). Mod-B does nothing. Pass `preset: defaultPreset()` for those, or use `@input/pen`'s `createEditor()`, which defaults to that preset.

## Shipped Surface

The default schema includes common rich-text building blocks such as:

- paragraphs and headings
- bullet, numbered, and checklist items
- code blocks and images
- tables
- dividers, callouts, toggles, and blockquotes
- marks and inline nodes such as bold, italic, links, mentions, and inline apps

## Integration Notes

- Use `defaultSchema` when you want the repository's standard document model as-is.
- Use `createDefaultSchema()` when you want to merge in custom blocks or inline definitions.
- Schema definitions describe document structure and behavior, not product-specific UI.

## Options

`createDefaultSchema()` takes no arguments. Unknown blocks passthrough (`onUnknownBlock: () => "passthrough"`). `defaultSchema` is one shared instance of that factory.

## Documentation

The docs site (the `@input/pen-docs` package) covers this area on the Core concepts page (`#/core-concepts`).

The public signatures of record are in `api-report.md` next to this package's source in the Pen repository. The docs site does not host a generated browsable reference.

## License

MIT © Input Systems B.V. See [`LICENSE.md`](./LICENSE.md).
