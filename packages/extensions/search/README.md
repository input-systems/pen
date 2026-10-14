# @input/pen-search

Document search and replacement primitives for Pen.

This package is renderer-agnostic. It does not ship a search UI — renderer packages bind the controller to their own primitives.

## Install

```bash
pnpm add @input/pen-search
```

## What It Provides

- a headless search controller
- query navigation and replacement operations
- document-wide search across blocks and grid-backed cell content

This package is renderer-agnostic. Renderer packages can bind the controller state to UI primitives.

The packaged extension keeps the runtime contract broad:

- search, navigation, and replace work across blocks and tables
- active grid matches reveal by selecting the containing cell
- the built-in search decoration helper only highlights block-text matches today

Cell-specific visual highlighting needs a richer decoration surface than the current block/inline model.

## Usage

```ts
import { createEditor } from "@input/pen-core";
import { searchExtension, getSearchController } from "@input/pen-search";

const editor = createEditor({
  extensions: [searchExtension()],
});

const search = getSearchController(editor);
search?.open();
```

`searchExtension()` takes no options. Runtime `SearchOptions` on the controller default to:

| Option          | Default |
| --------------- | ------- |
| `caseSensitive` | `false` |
| `regex`         | `false` |
| `wholeWord`     | `false` |

## Facets and commands

Contributes the search controller facet (`searchControllerFacet` / `SEARCH_CONTROLLER_SLOT`) and one `keymapFacet` provider per search binding (undeclared priority → `300` → `default`, same as the v1 shim). Bindings, not catalog commands: `Mod-f` opens, `Mod-g` / `Enter` next, `Shift-Mod-g` / `Shift-Enter` previous, `Escape` closes. Requires no other extensions.

## Documentation

The docs site (the `@input/pen-docs` package) covers this area on the Extensions and facets page (`#/extensions`).

The public signatures of record are in `api-report.md` next to this package's source in the Pen repository. The docs site does not host a generated browsable reference.

## License

MIT © Input Systems B.V. See [`LICENSE.md`](./LICENSE.md).
