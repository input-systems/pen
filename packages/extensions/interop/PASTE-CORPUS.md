# Paste fidelity corpus (IOP2)

Clipboard `text/html` + `text/plain` pairs measured through the generic HTML import path (`parseHtmlToBlocks`). Pen does not sniff `mso` classes or `docs-internal-guid`. A documented flattening is the paste contract; an undocumented one is a regression.

1 of 9 sources are hand-captured. Still synthetic-until-capture: `word-desktop`, `word-web`, `google-docs`, `notion`, `vscode`, `article`, `excel-sheets`, `pen`. The replacement procedure is `src/html/import/__tests__/pasteCorpus/CAPTURE.md`.

Generated from `src/html/import/__tests__/pasteCorpus/` by `src/html/import/__tests__/pasteCorpus.test.ts`. Do not edit by hand.

## Outcome table

| Source | Provenance | Headings | Lists | Tables | Code | Links | Images | Bold / italic / strike | Colors | Intentional losses |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Microsoft Word (desktop) | synthetic-until-capture | h1 | flattened to paragraphs | 2×2, no header row | none | kept | dropped (img inside MsoNormal paragraph is not lifted) | bold, italic, link | none | Word numbering metadata (mso-list on paragraphs) becomes plain paragraphs with the visible bullet glyph; the generic path does not sniff MsoListParagraph; Office <style> blocks and html/head/meta wrappers are stripped by the sanitizer; An <img> nested in <p class=MsoNormal> does not become an image block; an empty paragraph remains |
| Microsoft Word (web) | synthetic-until-capture | h1 | nested bullets (indent 0/1) | 2×2, no header row | none | kept | none | bold, italic, strike, link | none | Office xmlns / Mso* class names are ignored; conversion uses tags only; No Word numbering metadata is preserved beyond the emitted <ul>/<li> tree |
| Google Docs | synthetic-until-capture | flattened into one paragraph | flattened into one paragraph | flattened (cell text concatenated) | none | kept | none | span bold and italic kept; font-weight normal wrapper ignored | span color kept as textColor | The docs-internal-guid <b> wrapper still collapses headings, lists, and tables into one paragraph; Adjacent block text is concatenated with no separator |
| Apple Notes | captured: Apple Notes 4.13 (2026-09-23) | none | flat numbered and bullets | none | none | none in capture | none | bold, italic, and class-based underline kept | none | font family, size, margins, minimum heights, and list marker CSS are discarded |
| Notion | synthetic-until-capture | h1 | nested bullets (indent 0/1) plus checklist | none | codeBlock language ts | kept | 1 remote src kept | bold, italic, strike, link | none | Notion-specific block identity (if a real capture adds data-block-id) is ignored; conversion uses tags only |
| VS Code | synthetic-until-capture | none | none | none | flattened to one paragraph per token span | none | none | none | token colors kept as textColor | Styled VS Code copy has no pre/code wrapper, so it does not become a codeBlock; Each colored span becomes its own paragraph |
| Browser article | synthetic-until-capture | h1 | none | none | codeBlock | kept | 1 remote src kept; title becomes caption; figcaption becomes a paragraph | italic, bold, link | none | figure/figcaption wrappers unwrap; caption text is a sibling paragraph, not image.caption (title attribute is) |
| Excel / Google Sheets | synthetic-until-capture | none | none | 2×2, no header row | none | none | none | none | none | google-sheets-html-origin is stripped; the table remains; Excel mso-number-format / <style> (when present on a real Excel capture) are stripped; The first row is not promoted to a header row without <thead> |
| Pen | synthetic-until-capture | h1 | flat bullets | none | none | none | none | bold, italic | none | The data-pen-blocks meta is stripped on the HTML import path; structured Pen blocks arrive only through the JSON clipboard flavor (IOP1) |

## Fixtures

### Microsoft Word (desktop)

- **id:** `word-desktop`
- **Provenance:** `synthetic-until-capture`
- **Approximates:** Word for Microsoft 365 desktop clipboard HTML (Word.Document, MsoNormal, mso-list paragraphs). Not a hand-captured dump.
- **Markers:** `xmlns:w`, `Word.Document`, `MsoNormal`, `MsoListParagraph`, `mso-list`

- Word numbering metadata (mso-list on paragraphs) becomes plain paragraphs with the visible bullet glyph; the generic path does not sniff MsoListParagraph
- Office <style> blocks and html/head/meta wrappers are stripped by the sanitizer
- An <img> nested in <p class=MsoNormal> does not become an image block; an empty paragraph remains

### Microsoft Word (web)

- **id:** `word-web`
- **Provenance:** `synthetic-until-capture`
- **Approximates:** Word for the web clipboard fragment (StartFragment, MsoNormal, Office xmlns). Semantic lists are what Word Online often emits; desktop Word usually does not.
- **Markers:** `xmlns:w`, `StartFragment`, `MsoNormal`, `MsoTableGrid`

- Office xmlns / Mso* class names are ignored; conversion uses tags only
- No Word numbering metadata is preserved beyond the emitted <ul>/<li> tree

### Google Docs

- **id:** `google-docs`
- **Provenance:** `synthetic-until-capture`
- **Approximates:** Google Docs clipboard HTML: <b id=docs-internal-guid-…> wrapper, span-styled marks, semantic headings/lists/tables inside the wrapper. Typical Docs copies also append Apple-interchange-newline.
- **Markers:** `docs-internal-guid`, `font-weight:700`, `Apple-interchange-newline`

- The docs-internal-guid <b> wrapper still collapses headings, lists, and tables into one paragraph
- Adjacent block text is concatenated with no separator

### Apple Notes

- **id:** `apple-notes`
- **Provenance:** `captured: Apple Notes 4.13 (2026-09-23)`
- **Approximates:** n/a — hand-captured browser paste payload
- **Markers:** `Cocoa HTML Writer`, `span.s1`, `ol.ol1`, `ul.ul1`

- font family, size, margins, minimum heights, and list marker CSS are discarded

### Notion

- **id:** `notion`
- **Provenance:** `synthetic-until-capture`
- **Approximates:** Notion clipboard fragment: StartFragment, semantic headings/lists, checkbox inputs, fenced code, remote image. Notion copies are relatively clean HTML.
- **Markers:** `StartFragment`, `input type=checkbox`, `language-ts`

- Notion-specific block identity (if a real capture adds data-block-id) is ignored; conversion uses tags only

### VS Code

- **id:** `vscode`
- **Provenance:** `synthetic-until-capture`
- **Approximates:** VS Code styled editor copy: nested divs with per-token <span style=color> and no <pre>/<code>. Dark+ token colors.
- **Markers:** `Menlo, Monaco, Consolas`, `span style=color`, `background-color: #1e1e1e`

- Styled VS Code copy has no pre/code wrapper, so it does not become a codeBlock
- Each colored span becomes its own paragraph

### Browser article

- **id:** `article`
- **Provenance:** `synthetic-until-capture`
- **Approximates:** A typical news/article selection: <article>, heading, paragraphs, link, pre/code, figure/img/figcaption.
- **Markers:** `article`, `figure`, `figcaption`

- figure/figcaption wrappers unwrap; caption text is a sibling paragraph, not image.caption (title attribute is)

### Excel / Google Sheets

- **id:** `excel-sheets`
- **Provenance:** `synthetic-until-capture`
- **Approximates:** A 2×2 spreadsheet range as Google Sheets clipboard HTML (google-sheets-html-origin + table). Excel desktop emits a similar <table> with xmlns:x / Excel.Sheet and mso-number-format styles; the stated structural outcome is the same.
- **Markers:** `google-sheets-html-origin`, `table`, `tbody`

- google-sheets-html-origin is stripped; the table remains
- Excel mso-number-format / <style> (when present on a real Excel capture) are stripped
- The first row is not promoted to a header row without <thead>

### Pen

- **id:** `pen`
- **Provenance:** `synthetic-until-capture`
- **Approximates:** Pen HTML clipboard flavor: <meta data-pen-blocks> prefix plus exported semantic HTML. This fixture measures the HTML fallback, not the versioned JSON flavor (IOP1).
- **Markers:** `data-pen-blocks`, `h1`, `strong`, `em`

- The data-pen-blocks meta is stripped on the HTML import path; structured Pen blocks arrive only through the JSON clipboard flavor (IOP1)
