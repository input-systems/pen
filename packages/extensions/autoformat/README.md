# `@input/pen-autoformat`

Opt-in markdown autoformat for Pen.

This package is intentionally **not** included in `defaultPreset()`. Library users enable it only when they want markdown-style typing shortcuts. It does not ship a renderer or a keymap.

## Install

```bash
pnpm add @input/pen @input/pen-autoformat
```

## Usage

```ts
import { createEditor } from "@input/pen";
import { autoformatExtension } from "@input/pen-autoformat";

const editor = createEditor({
  extensions: [autoformatExtension()],
});
```

Without the extension:

```ts
import { createEditor } from "@input/pen";

const editor = createEditor();
```

markdown autoformat remains disabled.

## What it adds

Block shortcuts:

- `# ` through `###### ` -> headings
- `- `, `* `, `+ ` -> bullet list
- `1. ` -> numbered list
- `[ ] `, `[x] ` -> checklist
- `> ` -> blockquote
- ` ``` ` -> code block
- `---`, `***`, `___` -> divider
- `> [!note] ` -> callout

Inline shortcuts:

- `**text**` -> bold
- `*text*` -> italic
- `` `text` `` -> code
- `~~text~~` -> strikethrough
- `==text==` -> highlight

## Notes

- This package is headless and renderer-agnostic.
- `@input/pen-react` keeps a small fallback list-input convenience path, but full markdown autoformat lives here.
- If you want custom rules, pass them through `autoformatExtension({ rules, inlineRules })`.

## Options

| Option                      | Default | Effect                         |
| --------------------------- | ------- | ------------------------------ |
| `disableDefaults`           | `false` | Skip the built-in block rules  |
| `disableDefaultInlineRules` | `false` | Skip the built-in inline rules |
| `rules`                     | unset   | Extra block rules              |
| `inlineRules`               | unset   | Extra inline rules             |

## Facets and commands

Contributes no facet providers and no commands. The extension publishes a rules engine on `inputRulesEngineFacet` and rewrites matching input from `onBeforeApply`. Requires no other extensions. `defaultPreset()` does not install it.

## Documentation

The docs site (the `@input/pen-docs` package) covers this area on the Extensions and facets page (`#/extensions`).

The public signatures of record are in `api-report.md` next to this package's source in the Pen repository. The docs site does not host a generated browsable reference.

## License

MIT © Input Systems B.V. See [`LICENSE.md`](./LICENSE.md).
