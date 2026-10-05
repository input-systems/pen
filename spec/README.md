# Pen Specs

`spec/` is the current-state index of this repository for agents. It describes shipped behavior only. There is no roadmap, no wave plan, and no future-work list here. When shipped behavior changes, the matching spec changes in the same PR. Silent divergence between code and spec is a defect.

Read this file first. Then load only the `rules/` and `packages/` documents that match the surface you are touching.

## Layout

- `charter/` — cross-cutting architectural invariants.
- `rules/` — normative families with stable rule IDs (`A1`, `S4`, `SEC1`, `API6`, …). Cite those IDs in PR descriptions and test names.
- `packages/` — one current-state spec per workspace package that has one. Mirrors the package tree, not a milestone.

Two workspace packages have no `spec/packages/` file on purpose: `@input/pen-conformance` and `@input/pen-eslint-plugin`. See `charter/package-map.md`.

## Charter

- `charter/architecture.md` — layering, runtime authority, host vs library
- `charter/document-model.md` — blocks, read model, empty storage, nested traversal
- `charter/mutation-pipeline.md` — `DocumentOp[]`, `editor.apply`, streaming, intent
- `charter/package-map.md` — workspace layout and spec path for every specified package

## Rules — load before editing the matching surface

| Surface                                                | Document                 | Families                       |
| ------------------------------------------------------ | ------------------------ | ------------------------------ |
| Write path, ops, streaming, origins                    | `rules/pipeline.md`      | ST, OP, PR, OPB                |
| Selection, caret, IME, projection                      | `rules/selection.md`     | A, N, R, P, O, T, C, S         |
| Anchors and position survival                          | `rules/anchors.md`       | AN, AS                         |
| Empty-block storage                                    | `rules/empty-blocks.md`  | EM                             |
| Change summaries, origin intent                        | `rules/observation.md`   | OB, INT                        |
| Facets, slots, extension seams                         | `rules/facets.md`        | R, SM                          |
| Commands, keymaps, beforeinput                         | `rules/commands.md`      | D, K, B                        |
| DOM scheduler, field editors, geometry, overlays, bidi | `rules/dom.md`           | SCH, FE, G, OV, DIR, BR, M, RI |
| Cross-cutting invariants                               | `rules/architecture.md`  | I                              |
| Public API, packaging, DAG, surface                    | `rules/api.md`           | API, SF, CS                    |
| Security, URLs, HTML, clipboard                        | `rules/security.md`      | SEC                            |
| Accessibility                                          | `rules/accessibility.md` | AX                             |
| AI boundary, edit channel, review surface              | `rules/ai.md`            | AIB, UC, RS                    |
| Collaboration                                          | `rules/collaboration.md` | COL                            |
| Import/export, assets                                  | `rules/interop.md`       | IOP                            |
| Localization, catalogs                                 | `rules/localization.md`  | LOC                            |
| Durability, schema evolution                           | `rules/durability.md`    | DUR                            |
| Scale envelope, benches                                | `rules/scale.md`         | SCALE, PG                      |
| Tests, conformance, flake                              | `rules/reliability.md`   | CH                             |
| Host integration, browser/Node floor                   | `rules/host.md`          | HOST, HB                       |
| Docs site, READMEs, examples                           | `rules/documentation.md` | DOC                            |

Also load the matching `packages/*.md` for any package whose source you are editing.

## Packages

Runtime authority: `packages/core.md`, `packages/types.md`, `packages/crdt/yjs.md`

Rendering: `packages/rendering/dom.md`, `packages/rendering/react.md`, `packages/rendering/vue.md`

Schema and preset: `packages/schema.md`, `packages/pen.md`

Extensions: `packages/extensions/ai.md`, `packages/extensions/tools.md`, `packages/extensions/snapshots.md`, `packages/extensions/autoformat.md`, `packages/extensions/interop.md`, `packages/extensions/multiplayer.md`, `packages/extensions/search.md`, `packages/extensions/shortcuts.md`, `packages/extensions/undo.md`

Shared: `packages/shared/ingest.md`, `packages/shared/markdown.md`

Transport: `packages/transport.md` (`./direct` and `./sse` subpaths)

Tooling: `packages/tooling/test.md`, `packages/tooling/bench.md`, `packages/tooling/assets.md`

Workspace apps: `packages/docs.md`, `packages/playground.md`

AI subpaths (`@input/pen-ai/suggestions`, `/autocomplete`, `/skills`, `/tools`, `/stream`) live in `packages/extensions/ai.md`. Interop format subpaths (`/html`, `/markdown`, `/json`, `/xml`) live in `packages/extensions/interop.md`.

## Conventions

- Runtime authority is `@input/pen-core` and the `Editor` API.
- `DocumentOp[]` is a closed ten-member union. Durable writes go through `editor.apply(...)`.
- Positions that must survive commits are `editor.anchors`. Change summaries describe what a commit touched; they do not map positions across commits.
- Empty text-capable storage is `""`. The renderer empty-block placeholder is a `<br data-pen-empty="">` and is not stored.
- `@input/pen-types` is the shared contract layer, not a hidden runtime layer.
- Renderer packages bind to the editor runtime but do not own document truth.
- JSON is the canonical machine-readable format. XML is an interoperability surface on top of that model. Both live on `@input/pen-interop`.
- React is the primary documented renderer. Vue is a shipped renderer proof built on the shared DOM engine.
- `playground/` is the reference app and the host for `pnpm test:e2e`. Private apps (`@input/pen-docs`, `@input/pen-playground`) are specified because they are in the workspace; they are not publishable runtime packages.

## Shipped ambiguities

These are current behavior, not bugs to close in passing:

- `pen.ariaReadOnly` (the facet) only sets `aria-readonly`. The renderer `readonly` prop is what declines typing. Package specs describe the split; they do not pick a winner.
- The command registry and catalog are settled: dispatch keeps the D/K/B rules. Selection bridging inside `@input/pen-dom` follows `spec/rules/selection.md`, with one reader and one writer.
