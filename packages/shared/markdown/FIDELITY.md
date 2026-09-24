# Markdown serialization dialect (IOP3)

Pen markdown is GitHub-flavored Markdown for blocks that have a standard representation, plus Pen-specific constructs for the rest. This package walks the document and calls each block and mark `serialize.toMarkdown`. It does not grow the dialect.

The generated per-type export table is [`packages/extensions/interop/FIDELITY.md`](../../extensions/interop/FIDELITY.md).

## Portable GFM — survives a Pen markdown round-trip

These constructs export as ordinary GFM. `@input/pen-interop/markdown` reconstructs the same block or mark type.

| Construct | Markdown | Notes |
| --- | --- | --- |
| paragraph | plain text | |
| heading | `#`–`######` | |
| bullet list | `-` plus a space | indent is two spaces per level |
| numbered list | `N.` plus a space | `N` comes from sibling walk or `start` |
| check list | `- [ ]` / `- [x]` | GFM task list |
| code block | fenced ` ``` ` | language in the fence info string |
| image | `![alt](src)` | caption and width are not exported |
| table | GFM pipe table | only when `hasHeaderRow` is not `false` |
| divider | `---` | |
| blockquote | `>` plus a space | |
| bold | `**text**` | |
| italic | `*text*` | |
| strikethrough | `~~text~~` | GFM |
| inline code | `` `text` `` | |
| link | `[text](href "title")` | title omitted when absent |

A non-Pen GFM reader sees these as ordinary GFM.

## Pen-specific — not portable CommonMark

| Construct | This package emits | Non-Pen reader sees | Pen markdown import |
| --- | --- | --- | --- |
| toggle | raw `<details><summary>…</summary></details>` | raw HTML, if the reader keeps it | `fromMarkdown` reconstructs a toggle; nested children are not exported |
| subdocument | `<!-- pen-subdocument:<guid> -->` | HTML comment ignored | no `fromMarkdown`; the comment is dropped. Nested document is never exported |
| callout | `> **Note:**` / `**Warning:**` / `**Error:**` | a blockquote with a bold label | `fromMarkdown` reconstructs a callout |
| underline | `<u>text</u>` | raw HTML, or stripped tags | reconstructs the underline mark |
| highlight | `==text==` | literal `==` in CommonMark and GFM | not a GFM mark; returns as plain text. Color is not encoded |

Do not treat subdocument or toggle markup as portable Markdown. A host that wants CommonMark from those blocks needs the table above, not a support ticket.

## Package-owned rules

These rules live in this serializer, not in schema `toMarkdown`:

- A block without `toMarkdown` exports as its text content.
- A mark without `toMarkdown` is skipped; the text stays.
- Non-string inserts (mention, inlineApp) are omitted. Schema `toMarkdown` for those nodes is not reached.
- A table with `hasHeaderRow === false` exports as an HTML `<table>`, not a GFM pipe table. A GFM importer does not reconstruct that table.
- Consecutive list-item lines are joined with a single newline.
- Numbered-list `start` is derived from prior siblings at the same indent and passed into the block serializer.
- The empty-block storage sentinel `\u200B` is stripped at the export boundary (I11).

URL admission (hostile `href` / `src` omitted) is SEC1 in `@input/pen-interop/markdown`, not this package.

## Does not survive markdown

- mention and inlineApp
- textColor and backgroundColor
- image caption and width
- subdocument nested content, and the marker itself on import
- toggle children
- header-less table HTML fallback on GFM import
- highlight as a mark (`==` is not GFM)
