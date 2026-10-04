# `@input/pen-shortcuts`

Headless rich-text keyboard shortcuts for Pen. `richTextShortcutsExtension()` installs Mod-b / Mod-i / Mod-u as `pen.toggleMark` bindings. `defaultPreset()` includes it.

This package does not render a surface, handle link UI, or own the keymap facet implementation. Link toggle is a host callback (`onToggleLink`); there is no catalog command for Mod-k.

## Install

`@input/pen` already includes it. The extension depends on `@input/pen-core` for `keymapFacet`. A bare `createEditor()` does not register these bindings, and without a schema the marks have nothing to toggle.

```bash
pnpm add @input/pen-core @input/pen-schema @input/pen-shortcuts
```

`engines.node` is `^22.22.2 || ^24.15.0 || >=26.0.0`.

## Usage

```ts
import { createEditor } from "@input/pen-core";
import { createDefaultSchema } from "@input/pen-schema";
import { richTextShortcutsExtension } from "@input/pen-shortcuts";

const editor = createEditor({
  schema: createDefaultSchema(),
  extensions: [richTextShortcutsExtension()],
});
```

`richTextShortcutsExtension()` registers one `keymapFacet` provider per binding, using the same per-binding precedence the v1 shim used (`priority` 100 → `highest`). `shortcutsToKeymapProviders(bindings)` is that lift. `toggleInlineMark` and `setInlineMark` are the handlers the extension calls.

## Options

| Option         | Default                                         | Effect                                        |
| -------------- | ----------------------------------------------- | --------------------------------------------- |
| `bindings`     | bold `Mod-b`, italic `Mod-i`, underline `Mod-u` | Pass `null` or `[]` for a mark to omit it     |
| `onToggleLink` | unset                                           | When set, also binds `Mod-k` to this callback |

The extension name is `rich-text-shortcuts` (`RICH_TEXT_SHORTCUTS_EXTENSION_NAME`).

## Facets and commands

Contributes `pen.keymap` providers (`PEN_KEYMAP_FACET_NAME`) for `pen.toggleMark` with `mark` `bold`, `italic`, or `underline`. Requires no other extensions.

## Documentation

The docs site (the `@input/pen-docs` package) covers this area on the Commands and keymaps page (`#/commands`).

The public signatures of record are in `api-report.md` next to this package's source in the Pen repository. The docs site does not host a generated browsable reference.

## License

MIT © Input B.V. See [`LICENSE.md`](./LICENSE.md).
