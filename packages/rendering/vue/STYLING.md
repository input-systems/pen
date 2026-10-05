# Styling (`@input/pen-vue`)

This is the HOST6 styling contract for `@input/pen-vue` (`spec/rules/host.md`).

`@input/pen-vue` ships no required stylesheet. `PenEditor` adopts `PEN_EDITOR_CHROME_STYLESHEET` from `@input/pen-dom` by default so an empty field fills its block, placeholders paint, and `:focus-visible` uses `--pen-focus-ring`. Pass `:chrome="false"` for the HOST6 unstyled path. The host owns taste — typography, spacing, colors, list markers, callout chrome, table chrome.

This package reads no CSS custom properties of its own. Tokens that other Pen packages read (`@input/pen-react`, `@input/pen-dom` overlays and chrome) are documented in the canonical reference: `STYLING.md`, which ships inside the `@input/pen-react` package.

The default chrome sheet sets `outline: none` on the editor surfaces and restores a `:focus-visible` ring (AX5). Selection fill is native `::selection`. Caret overlays and block outlines are painted by `@input/pen-dom` into the root's overlay layer; Vue renders none of them and reads no overlay tokens of its own.

## What Vue applies itself

Vue sets a few inline styles for layout, not theme:

- List items (`bulletListItem`, `numberedListItem`, `checkListItem`): `margin-left` from `indent * 24px`.
- Image: `width` when the block has a numeric `width` prop.
- Placeholder host (`PenInlineContent`): `position: relative` while a placeholder is shown.
- Table cell text (`PenTableCellContent`): `min-width: 6rem`, `min-height: 1.5rem`, `display: block`, `width: 100%`, and `position: relative` while a placeholder is shown.
- Text entry surfaces (`PenInlineContent`, `PenTableCellContent`): `white-space: pre-wrap`. This one is correctness, not layout, and is not meant to be overridden — a soft break is stored as `\n` and repeated spaces are stored verbatim, so the initial `normal` would collapse characters the document actually contains (RI5 in `spec/rules/dom.md`).

There are no `.css` files in this package. Editor chrome is the shared text sheet from `@input/pen-dom`, adopted at mount.

## Class hooks

The package sets one class, and only on a code block that has a language:

| Class                  | Where                         | When                          |
| ---------------------- | ----------------------------- | ----------------------------- |
| `language-${language}` | `<code>` inside a `codeBlock` | `block.props.language` is set |

Hosts that run a highlighter (Prism, highlight.js, Shiki) can target that class. Vue does not load a highlighter.

## AI review

Review presentation — inserted and deleted text, streaming preview text,
selection context, block suggestions — is painted by `@input/pen-ai`
decorations that land in this tree. This package sets none of those classes.

They ship as one stylesheet and one class vocabulary, both exported from
`@input/pen-dom` (RS4), and are the same contract the React binding documents.
Adopt the sheet once, then theme it with the `--pen-ai-review-*` custom
properties; do not re-declare the rule blocks:

```ts
import { PEN_REVIEW_STYLESHEET } from "@input/pen-dom";

const style = document.createElement("style");
style.textContent = PEN_REVIEW_STYLESHEET;
document.head.prepend(style);
```

It is exported as text rather than a `.css` file because every published
package sets `sideEffects: false` (API7), which entitles a bundler to drop a
bare stylesheet import. `REVIEW_SURFACE_CLASSES`,
`REVIEW_SURFACE_BLOCK_SUGGESTION_CLASSES`, and
`REVIEW_SURFACE_CUSTOM_PROPERTIES` are exported alongside it. See
[`@input/pen-react`'s styling guide](../react/STYLING.md#ai-review-painted-by-inputpen-ai-decorations-in-this-tree)
for the property defaults; there is one table, not one per binding.

## Data-attribute hooks

Boolean `data-*` attributes are the valueless HTML form (`data-readonly=""`), omitted when off. The `present` column below means that form. Write the bare selector `[data-readonly]`, not `[data-readonly=""]` or `[data-readonly="true"]`. Both the bare form and `[data-readonly=""]` match today; the bare form stays correct if one of these attributes ever carries a real value. The bare-attribute rule is for `data-*` only.

ARIA booleans are not valueless. They are the strings `"true"` and `"false"` (`aria-expanded="true"`, `aria-hidden="true"`, `aria-readonly="true"`). `aria-hidden=""` is invalid, and `[aria-hidden=""]` matches nothing. Do not extend the valueless `data-*` convention to ARIA.

Do not invent attributes that are not in this list.

### Editor shell (`PenEditor`)

| Attribute                 | Value   | Meaning                                                                |
| ------------------------- | ------- | ---------------------------------------------------------------------- |
| `data-pen-editor-root`    | present | Editor root. Host CSS starts here.                                     |
| `data-pen-view-id`        | view id | Distinguishes this view from another on the same page.                 |
| `data-focused`            | present | Root contains focus.                                                   |
| `data-pen-reduced-motion` | present | The root's AX6 reduced-motion signal is set; make transitions instant. |
| `data-readonly`           | present | `readonly` prop is on.                                                 |
| `data-empty`              | present | Document has no content.                                               |

### Content (`PenContent`)

| Attribute                              | Value   | Meaning                                                                           |
| -------------------------------------- | ------- | --------------------------------------------------------------------------------- |
| `data-pen-editor-content`              | present | Scrollable content surface. Also `data-empty` present when the document is empty. |
| `data-pen-editor-blocks-host`          | present | Block list host. Field-editor attaches here in expanded mode.                     |
| `data-pen-field-editor-surface`        | present | Expanded mode: this host is a field-editor surface.                               |
| `data-pen-field-editor-active-surface` | present | Expanded mode: this host is the active surface.                                   |

### Block wrapper (`PenBlock`)

Every default-rendered block is wrapped in a `div` with:

| Attribute               | Value                                            | Meaning                                        |
| ----------------------- | ------------------------------------------------ | ---------------------------------------------- |
| `data-pen-editor-block` | present                                          | Block wrapper.                                 |
| `data-block-id`         | block id                                         | Stable id.                                     |
| `data-block-type`       | schema type                                      | Same type as the inner body (see below).       |
| `data-selected`         | present                                          | Block is in the current selection.             |
| `data-focused`          | present                                          | Field-editor focus is on this block.           |
| `data-surface-role`     | `editable-inline` \| `structural` \| `delegated` | Expanded-mode role. Omitted when not expanded. |
| `role`, `aria-level`, `aria-posinset`, `aria-setsize` | `listitem`, numbers | List items only (AX1): position in the item's set. |

Each run of list items in a sibling list renders inside a `div[data-pen-list-group][role="list"]` (AX1). A sibling combinator between blocks (`[data-pen-editor-block] + [data-pen-editor-block]`) does not cross a group boundary; add `[data-pen-list-group]` to the selector for spacing that should.

The wrapper also sets `dir="ltr"` or `dir="rtl"` when the block's `direction` prop is one of those values (DIR2/DIR3). That is a bidi attribute, not a class hook.

### Block body (`data-block-type`)

Default renderers set `data-block-type` on the inner element as well. Values:

`paragraph`, `heading`, `bulletListItem`, `numberedListItem`, `checkListItem`, `callout`, `toggle`, `blockquote`, `divider`, `codeBlock`, `image`, `table`, or the unknown type string.

Additional body hooks:

| Attribute                         | On                       | Value                                                   |
| --------------------------------- | ------------------------ | ------------------------------------------------------- |
| `data-level`                      | heading                  | `1`–`6`                                                 |
| `data-pen-list-marker`            | list marker span         | present (`aria-hidden`)                                 |
| `data-counter`                    | numbered list item       | resolved ordinal                                        |
| `data-checked`                    | checklist item           | present when checked                                    |
| `data-callout-type`               | callout                  | `info` \| `warning` \| `error` (from the severity prop) |
| `data-pen-callout-icon`           | callout icon             | present (`aria-hidden`)                                 |
| `data-pen-callout-body`           | callout body             | present                                                 |
| `data-pen-callout-children`       | nested callout children  | present when the callout has children                   |
| `data-pen-toggle-header`          | toggle header row        | present                                                 |
| `data-pen-toggle-trigger`         | toggle open/close button | present                                                 |
| `data-pen-ignore-pointer-gesture` | toggle trigger           | present (field-editor ignores this target)              |
| `data-pen-toggle-title`           | toggle title             | present                                                 |
| `data-pen-toggle-body`            | nested toggle children   | present when open and the toggle has children           |
| `data-pen-blockquote-children`    | nested quote children    | present when the quote has children                     |
| `data-language`                   | code block `<pre>`       | language string, if set                                 |
| `data-pen-blocked-url`            | image `<img>`            | present when URL policy rejected `src`                  |
| `data-unknown-block`              | unknown-type fallback    | present                                                 |
| `data-pen-unknown-type`           | unknown-type label       | present                                                 |
| `data-selected`                   | unknown-type fallback    | present when that block is selected                     |

A host `renderers` override replaces the inner body. The wrapper hooks above still apply.

### Table

| Attribute                | On                           | Value        |
| ------------------------ | ---------------------------- | ------------ |
| `data-pen-table-frame`   | frame around `<table>`       | present      |
| `data-pen-table`         | `<table>`                    | present      |
| `data-pen-table-row`     | `<tr>`                       | present      |
| `data-pen-table-cell`    | `<td>` / `<th>`              | present      |
| `data-cell-row`          | cell, and the cell text host | row index    |
| `data-cell-col`          | cell, and the cell text host | column index |
| `data-pen-cell-selected` | selected cell                | present      |

### Inline and cell text

`PenInlineContent` (and `PenFieldEditor`, which renders it) and `PenTableCellContent` share most of these:

| Attribute                              | Value            | Meaning                                             |
| -------------------------------------- | ---------------- | --------------------------------------------------- |
| `data-pen-inline-content`              | present          | Inline text host.                                   |
| `data-pen-field-editor-surface`        | present          | Field-editor can attach here.                       |
| `data-pen-field-editor-active-surface` | present          | This host is the active field-editor surface.       |
| `data-placeholder-visible`             | present          | A placeholder is showing.                           |
| `data-placeholder`                     | placeholder text | Set while a placeholder is showing.                 |
| `data-selected`                        | present          | Inline host only: the block is selected.            |
| `data-pen-ignore-pointer-gesture`      | present          | Cell text host only: set while that cell is active. |

## Host CSS

Target the hooks above from host stylesheets. Example:

```css
[data-pen-editor-root] {
  font-family: inherit;
}

[data-readonly] {
  /* host taste — not [data-readonly="true"] or [data-readonly=""] */
}

[data-block-type="heading"][data-level="1"] {
  font-size: 1.75rem;
}

[data-pen-list-marker] {
  margin-inline-end: 0.5em;
}

[data-pen-cell-selected] {
  outline: 2px solid Highlight;
}
```

Do not depend on class names other than `language-${language}`. Vue does not add theme classes, BEM roots, or utility classes.
