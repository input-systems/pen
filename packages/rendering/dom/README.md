# `@input/pen-dom`

Shared DOM field-editor engine for Pen renderers. `@input/pen-react` and `@input/pen-vue` mount `FieldEditorImpl` inside their document shells. Vanilla hosts call `mountEditor`, which is that same composition without a framework.

This package does not assemble a schema or install a preset. Editor-field chrome (`PEN_EDITOR_CHROME_STYLESHEET`) is adopted by `mountEditor` by default; pass `{ chrome: false }` to skip. It is the DOM engine, not a product editor.

## Install

This package has no peer dependencies. Hosts that want a mounted editor still need `@input/pen-core` and a preset or schema.

```bash
pnpm add @input/pen @input/pen-dom yjs
```

`yjs` is a peer of `@input/pen-yjs`, which `@input/pen-core` depends on.

`engines.node` is `>=22`.

## Usage

```ts
import { createEditor } from "@input/pen";
import { mountEditor } from "@input/pen-dom";

const editor = createEditor();

const root = document.querySelector("#app");
if (!(root instanceof HTMLElement)) {
  throw new Error("Missing #app");
}

mountEditor(editor, root);
```

That snippet is the vanilla mount path. `FieldEditorImpl.setRootElement` alone binds a focus sink and never builds the document tree — the page stays blank while it typechecks. React and Vue hosts should keep using those packages; they already construct `FieldEditorImpl` and the same document shell.

`mountEditor` adopts editor-field chrome by default so an empty field fills its block, placeholders paint, and `:focus-visible` uses `--pen-focus-ring`. Pass `{ chrome: false }` for the HOST6 unstyled path: clicks still land and the first keystroke works with no CSS.

The root export also includes `urlPolicy`, `urlPolicyExtension`, `DomScheduler`, and keyboard helpers such as `bindEditorDocumentKeyDown` and `handleEditorDocumentKeyDown`. Extra subpaths exist on the `exports` map (`./field-editor`, `./constants/selectAll`, and the listed `./utils/*` keys). Prefer the root export unless you already depend on a subpath.

## Capabilities

The normative per-surface matrix is `packages/docs/CAPABILITY-MATRIX.md` in the Pen repository. This package is the vanilla surface, and it is also where most capabilities are implemented for the framework bindings — so its column is mostly `bring-your-own-ui`: the behavior is here, and `mountEditor` renders no chrome for it.

`supported` from `mountEditor` alone: single-block fields, expanded fields, document mutation, paste, editor-field chrome (`PEN_EDITOR_CHROME_STYLESHEET`), and the review-surface styling contract (adopt `PEN_REVIEW_STYLESHEET`). Everything else — AI review affordances, overlays, multiplayer presence, search UI, and the matrix's Chrome rows (toolbar, selection toolbar, slash menu, suggestion menu, block handle, table chrome) — exports its state and utilities and leaves the rendering to you.

## Options

`mountEditor(editor, root, options?)` returns `{ fieldEditor, root, destroy }`. Options:

| Option             | Default           | Effect                                                                                                                                                                                                                       |
| ------------------ | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `readonly`         | `false`           | Declines typing and pointer activation; sets `data-readonly` (match with `[data-readonly]`, not `="true"`) and `aria-readonly="true"`. Does not stop `editor.apply`. `pen.ariaReadOnly` the facet only sets `aria-readonly`. |
| `interactionModel` | `"content-first"` | Passed through `resolveSelectAllBehavior`                                                                                                                                                                                    |
| `focusPolicy`      | unset             | Host focus policy passed to `FieldEditorImpl`                                                                                                                                                                                |
| `chrome`           | `true`            | Adopt `PEN_EDITOR_CHROME_STYLESHEET`. Pass `false` for the unstyled HOST6 path.                                                                                                                                              |

`FieldEditorImpl` accepts a second argument:

| Option              | Default            | Effect                                           |
| ------------------- | ------------------ | ------------------------------------------------ |
| `selectAllBehavior` | `"document-first"` | `"block-first"` selects the active block first   |
| `focusPolicy`       | unset              | Host focus policy passed to the focus controller |

`DEFAULT_SELECT_ALL_BEHAVIOR` is `"document-first"`. `resolveSelectAllBehavior(interactionModel)` returns `"block-first"` only when `interactionModel` is `"block-first"`.

## Documentation

The docs site (the `@input/pen-docs` package) covers this area on the Getting started page (`#/getting-started`).

The public signatures of record are in `api-report.md` next to this package's source in the Pen repository. The docs site does not host a generated browsable reference.

## License

MIT © Input B.V. See [`LICENSE.md`](./LICENSE.md).
