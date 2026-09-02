# @input/pen-tools

## Purpose

`@input/pen-tools` provides the document tool/runtime layer for Pen. It exposes block CRUD tools, document context and retrieval helpers, structured target inspection, and shared tool runtime plumbing for systems that need to read from or write to the document programmatically.

## Public Role

This package is the bridge between Pen's headless editor and tool-driven execution flows such as AI actions or external command surfaces. It does not own document truth, but it gives higher-level systems a safe, schema-aware way to inspect targets, retrieve context, and build valid document mutations.

## Key Exports / Entrypoints

- Export map: `.`
- Primary extension entrypoint: `toolsExtension()`
- Tool runtime: `getDocumentToolRuntime()` reads `editor.facet(toolRuntimeFacet)`. Activate `assignSlot`s `TOOL_RUNTIME_SLOT`.
- Runtime plumbing such as `ToolRuntimeImpl` and `ToolContextImpl`
- Context helpers such as `buildCursorContext()`, `resolveDocumentBlocks()`, `exportDocumentRangeAsMarkdown()`, `resolveSelectedText()`, and retrieval helpers
- Structured-target helpers such as `inspectStructuredTarget()`, `listValidOperationsForTarget()`, and block-type policy helpers
- `edit_document`: the block-addressed AI write tool, registered by `toolsExtension()`. Seven operations (`replace_block_text`, `replace_blocks`, `insert_blocks`, `delete_blocks`, `move_block`, `format_text`, `set_block_props`) returning an `EditDocumentResult`. Public compile-and-apply: `EDIT_DOCUMENT_OPERATIONS`, `planEditDocument()` (`compiledOperations`, not applied), `executeEditDocument()`, `editDocumentTool()`. Specified in `packages/extensions/ai.md` under Edit Channel (EC21).
- Mutation policy: `assertToolCanMutateBlock()` throws for the older block tools; the non-throwing `check*` predicates behind it stay in-package because a returned refusal is what `edit_document` needs and a host needs neither.
- Re-exported shared write helper: `buildDocumentWriteOps()`
- Workspace scripts: `build`, `clean`, `dev`, `lint`, `test`, `typecheck`

## Dependencies And Boundaries

- Runtime dependencies: `@input/pen-ingest`, `@input/pen-core`, `@input/pen-markdown`, `@input/pen-types`
- Peer dependencies: No peer dependencies declared.
- Boundary: This package owns tool-facing document inspection and mutation preparation, but it does not replace the core mutation pipeline or renderer layer. The dependency on `@input/pen-core` runs one way — core does not load `toolsExtension()`, so installing this package is always the host's choice.

## Runtime Model

`@input/pen-tools` wraps editor-aware tools around shared write and context utilities:

```mermaid
flowchart TD
  Host[AIOrToolHost]
  DocOps["@input/pen-tools"]
  Runtime[ToolRuntime]
  Context[ContextAndRetrieval]
  Targets[StructuredTargetInspection]
  Write[WriteOpPreparation]
  Core["@input/pen-core"]

  Host --> DocOps
  DocOps --> Runtime
  Runtime --> Context
  Runtime --> Targets
  Runtime --> Write
  Write --> Core
```

Important rules:

- Tool-facing operations still resolve back into editor mutations.
- Context retrieval and structured target inspection should stay explicit and bounded so tools do not mutate blindly.
- Shared write-op construction comes from `@input/pen-ingest`; this package owns the editor-aware tooling boundary built around it.
- Document search and span retrieval fold text with a local `foldAndNormalize` copy in `utils/editorLocale.ts`. That copy is a leftover: the same file already imports `localeFacet` from `@input/pen-core`, and core exports `foldAndNormalize` on its barrel, so nothing prevents using core's. Until it is removed, the local body must stay identical to core's (`toLocaleLowerCase`, final-sigma fold, NFC).

## Integration Notes

- Path in workspace: `packages/extensions/tools`
- Spec path mirrors workspace path: `packages/extensions/tools.md`
- Install `toolsExtension()` when a host needs a registered tool runtime for read/write/context operations against a live editor
- Use the inspection and policy helpers before mutating structured targets like tables
- This package is especially important for AI and automation flows because it centralizes the safe document-tool contract

## Current Maturity / Intended Usage

Workspace package at version `0.2.0`; intended usage is current-state but still evolving. It already has an outsized architectural role because it defines how non-human actors interact with Pen documents without bypassing editor boundaries.

## Non-goals

- Do not duplicate core editor authority.
- Do not let tool runtimes mutate the document without schema-aware preparation and policy checks.
- Do not move renderer ownership or transport-specific orchestration into this package.
