# @input/pen-search

## Purpose

`@input/pen-search` provides headless document search and replacement behavior for Pen, including controller state, match discovery, navigation helpers, replacement op builders, and extension wiring.

## Public Role

This package adds optional search behavior to an editor instance without coupling search to any one renderer. UI packages can render search controls, but the controller, match calculation, and replace operations live here.

## Key Exports / Entrypoints

- Export map: `.`
- Primary extension entrypoint: `searchExtension()`
- Controller lookup: `getSearchController()` reads `editor.facet(searchControllerFacet)`. Activate still `assignSlot`s `SEARCH_CONTROLLER_SLOT` (defined on `@input/pen-types`), which overrides that facet.
- `SearchControllerImpl` is the runtime controller; it is reached through `searchExtension()` / `getSearchController()`, not the barrel
- Pure helpers such as `buildSearchRegex()`, `findDocumentMatches()`, `buildReplaceOps()`, and `buildReplaceAllOps()`
- Search state and typing such as `SearchState`, `SearchMatch`, and `SearchOptions`
- Workspace scripts: `build`, `clean`, `dev`, `test`, `typecheck`

## Dependencies And Boundaries

- Runtime dependencies: `@input/pen-core`, `@input/pen-types`
- Peer dependencies: No peer dependencies declared.
- Boundary: The extension composes through the core editor and slots/events rather than side channels.

## Runtime Model

Search is a classic headless extension: it derives state from the current document, exposes controller state, and builds mutations for replacements when asked:

```mermaid
flowchart TD
  HostApp[HostApp]
  SearchExt["searchExtension()"]
  Controller[SearchController]
  Matches[MatchDiscovery]
  Decorations[SearchDecorations]
  Replace[ReplaceOps]
  Core["@input/pen-core"]

  HostApp --> SearchExt
  SearchExt --> Controller
  Controller --> Matches
  Matches --> Decorations
  Controller --> Replace
  Decorations --> Core
  Replace --> Core
```

Important rules:

- Search state is derived from the current editor document and options.
- Case-insensitive match uses core `foldAndNormalize()` and `localeFacet`. Case-sensitive search skips folding.
- The extension declares `Mod-f` / `Mod-g` (and siblings) on `keymapFacet`, which is the only binding channel.
- Active-match navigation is controller state, not renderer-local state.
- Replace and replace-all actions resolve to editor operations instead of direct DOM mutations.

## Integration Notes

- Path in workspace: `packages/extensions/search`
- Spec path mirrors workspace path: `packages/extensions/search.md`
- Typical integration installs `searchExtension()` on the editor and renders controls from `@input/pen-react` or another renderer package
- Decorations and active-match reveal behavior should remain extension-driven so closing or resetting search can fully clear search-derived state
- Keyboard shortcuts for open/next/previous live on `keymapFacet` in this package. Renderer or host bindings should call the same controller methods rather than inventing a second map.

## Current Maturity / Intended Usage

Workspace package at version `0.2.0`; intended usage is current-state but still evolving. The package is small in surface area relative to `@input/pen-ai`, but it is important because it establishes the correct pattern for headless feature packages with renderer-agnostic UI.

## Non-goals

- Do not duplicate core editor authority.
- Do not embed renderer-specific UI inside the extension.
- Do not treat DOM highlight state as the source of truth instead of controller and decoration state.
