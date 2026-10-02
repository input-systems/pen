# `@input/pen-interop`

HTML, Markdown, JSON, and XML import and export for a live Pen editor. Per-format importers and exporters live on subpaths; the package root re-exports the unique public symbols.

This package does not mount a renderer. URL admission for display is render-time policy in `@input/pen-core`. Shared markdown serialization stays in `@input/pen-markdown`.

## Install

This package has no peer dependencies.

```bash
pnpm add @input/pen @input/pen-interop
```

`engines.node` is `^22.22.2 || ^24.15.0 || >=26.0.0`.

## Usage

```ts
import { createEditor } from "@input/pen";
import { htmlExporter, htmlImporter } from "@input/pen-interop";

const editor = createEditor();
const html = await htmlExporter.export(editor);
await htmlImporter.import(html, editor, { replace: true });
```

Format-scoped imports:

```ts
import { htmlExporter, htmlImporter } from "@input/pen-interop/html";
import {
  markdownExporter,
  markdownImporter,
} from "@input/pen-interop/markdown";
import {
  jsonExporter,
  jsonImporter,
  jsonDocumentImporter,
} from "@input/pen-interop/json";
import { xmlExporter, xmlImporter } from "@input/pen-interop/xml";
```

A bare `createEditor()` has an empty schema. Unknown block types are dropped. `defaultPreset()` (or `createDefaultSchema()`) is required for default block and mark types to resolve.

`jsonImporter` is the ingest-bounds importer (`parseJsonToBlocks` / `parseJsonWithReport`). `jsonDocumentImporter` is the versioned `PenDocumentJSON` importer (`parseJsonDocument`). Both reached this package under the name `jsonImporter`, so the document importer carries the longer name here.

## Subpaths

| Subpath      | Exporter           | Importer                                  |
| ------------ | ------------------ | ----------------------------------------- |
| `./html`     | `htmlExporter`     | `htmlImporter`                            |
| `./markdown` | `markdownExporter` | `markdownImporter`                        |
| `./json`     | `jsonExporter`     | `jsonImporter` and `jsonDocumentImporter` |
| `./xml`      | `xmlExporter`      | `xmlImporter`                             |

Ingest-bound constants (`INGEST_MAX_*`) live in `src/ingestBounds.ts` and are re-exported from each format subpath. They are not re-exported from the package root.

## What each format provides

- **HTML** — `htmlExporter.export(editor)` walks every block, including nested and layout children. `htmlImporter` sanitizes incoming HTML and applies it through `editor.apply` with `origin: "import"`. `parseHtmlToBlocks()` / `parseHtmlWithReport()` convert without mutating the editor. `sanitizeHTML()` is the sanitizer used before import. Blocks without a schema `serialize.toHTML` fall back to a `<p>` of the block text.
- **Markdown** — `markdownExporter.export(editor)` serializes the document and admits link and image URLs through core's URL policy. `exportMarkdownForBlocks(editor, handles)` and `exportMarkdownRange(editor, range)` are the same serializers with URL admission. `markdownImporter` turns markdown into document ops. `parseMarkdownToBlocks()` / `parseMarkdownWithReport()` convert without applying ops. The shared serializer lives in `@input/pen-markdown`; this package is the host-facing wrapper.
- **JSON** — `jsonExporter` / `exportEditorToJson` for machine-readable persistence. `textExporter`, `exportEditorToText`, `exportPlainText`, and `exportPenDocumentToText` for plain text. `jsonImporter` is the ingest-bounds paste/import path. `jsonDocumentImporter` / `parseJsonDocument` is the versioned `PenDocumentJSON` round-trip path.
- **XML** — `xmlExporter` serializes through the JSON document model. `xmlImporter` parses a `<pen-document version="1">` tree and applies it through `jsonDocumentImporter`. `parseXmlDocument(input)` returns the JSON document without applying it. The root element must be `pen-document` with `version` `1`; anything else throws.

## Ingest bounds (IOP5 / SEC4)

The same envelope governs every ingest path. These constants are not configurable. They sit beside the published runtime envelope in `spec/rules/scale.md` SCALE1 (verified document size is a different number — ingest caps are what a single paste/import will accept). HTML, Markdown, JSON, XML, and clipboard ingest all read the same numbers.

| Constant                   |     Value | What it caps                                                                                                                                                                                                |
| -------------------------- | --------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INGEST_MAX_NESTING_DEPTH` |        32 | Block-tree depth (top-level = 1) and list `indent` (0-based, so indent 0–31)                                                                                                                                |
| `INGEST_MAX_NODE_COUNT`    |    10,000 | Blocks including table rows/cells                                                                                                                                                                           |
| `INGEST_MAX_TEXT_SIZE`     | 1,048,576 | Imported plain text, UTF-16 code units; also the pre-parse raw-source cap                                                                                                                                   |
| `INGEST_MAX_IMAGE_COUNT`   |       256 | Image blocks                                                                                                                                                                                                |
| `INGEST_TIME_BUDGET_MS`    |     1,000 | Advisory wall-clock ceiling. Same number as clipboard ingest. Not a unit-suite gate — a source longer than `INGEST_MAX_TEXT_SIZE` is sliced or refused before parse, so parse work is O(cap), not O(input). |

Exceeding a bound truncates at a block boundary. Importers return or emit one `IngestReport` (`droppedByReason`) naming the bound — not a per-block diagnostic stream. `parse*ToBlocks()` stays silent; use `parse*WithReport()` when the host wants the report without applying ops.

JSON and XML cannot slice to a valid document, so an oversize source is refused before parse. After XML parse, the same node / depth / image caps truncate the tree.

## HTML image src policy

Remote `<img src>` URLs are **kept as-is** by default (`imageSrc: "keep"`). The imported document may then depend on the remote server. Set `imageSrc: "ingest"` to fetch those URLs (and `data:` URLs) and upload them through the editor's `AssetProvider` on the `paste:assetProvider` slot. Ingest failure emits `asset-upload-failed` and omits that image block.

## JSON validation (SEC4)

- Block `type` must resolve in the active registry; unknown types and unknown props are dropped with `diagnostic { code: "import-dropped" }`.
- `__proto__`, `constructor`, and `prototype` are rejected as own keys anywhere in the payload.
- Validation builds fresh null-prototype records. It never deep-merges raw parsed JSON.
- URLs are not pre-laundered (SEC1 applies at render time).

## Options

| Option               | Default   | Effect                                                                                 |
| -------------------- | --------- | -------------------------------------------------------------------------------------- |
| `includeSuggestions` | unset     | `false` forces `viewMode` to `"resolved"` when `extra.viewMode` is omitted             |
| `extra.viewMode`     | `"raw"`   | `"resolved"` omits delete-suggestion spans; `"raw"` serializes the stored document     |
| `extra.range`        | whole doc | Markdown only: `{ startBlockId, endBlockId }` limits the export to that span           |
| `includeMetadata`    | unset     | JSON/XML: when true and `extra.metadata` is set, metadata is written onto the document |
| `imageSrc`           | `"keep"`  | HTML import: `"ingest"` fetches remote and `data:` URLs through the asset provider     |
| `position`           | unset     | Insert position for imported blocks                                                    |
| `replace`            | unset     | Replace the current document                                                           |
| `validate`           | unset     | Passed through to apply                                                                |
| `normalize`          | unset     | Passed through to apply                                                                |
| `undoGroup`          | unset     | Passed through to apply                                                                |

Other `ExportOptions` fields (`includeApps`, `includeLayout`, `prettyPrint`) are accepted on the type and unused by these exporters. The ingest bounds above are not configurable.

`exportPenDocumentToText` accepts `excludeBlockTypes` (default none) and `separator` (default `"\n"`).

`xmlExporter` forwards `ExportOptions` to `exportEditorToJson`. `XmlExporterExtraOptions` is an open `Record<string, unknown>`; this package does not read custom keys.

## Facets and commands

This package contributes no facets and no commands. It requires no other extensions.

## Documentation

The docs site (the `@input/pen-docs` package) covers this area on the Import and export page (`#/import-export`).

Per-format export fidelity tables are in [`FIDELITY.md`](./FIDELITY.md). The HTML paste corpus is in [`PASTE-CORPUS.md`](./PASTE-CORPUS.md).

The public signatures of record are in `api-report.md` next to this package's source in the Pen repository. The docs site does not host a generated browsable reference.

## License

MIT © Input B.V. See [`LICENSE.md`](./LICENSE.md).
