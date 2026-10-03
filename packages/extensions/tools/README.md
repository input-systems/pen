# `@input/pen-tools`

`@input/pen-tools` owns Pen's built-in document tool semantics.

The standard `defaultPreset()` installs this extension, so most editors start with the document read/write/context tools already registered. This package does not talk to a model or grant mutating tools — that is `@input/pen-ai/tools`.

## Install

This package has no peer dependencies. `@input/pen` already includes it.

```bash
pnpm add @input/pen @input/pen-tools
```

`engines.node` is `^22.22.2 || ^24.15.0 || >=26.0.0`.

Use this package when you need to:

- rely on the default document-oriented tools installed by Pen
- access the low-level document tool runtime directly from an editor
- work with advanced escape hatches such as `ToolContextImpl` for custom execution flows

## Usage

```ts
import { createEditor } from "@input/pen";
import { getDocumentToolRuntime } from "@input/pen-tools";

const editor = createEditor();
const toolRuntime = getDocumentToolRuntime(editor);

if (!toolRuntime) {
  throw new Error("Document tools are unavailable.");
}

const tools = toolRuntime.listTools();
```

Prefer `@input/pen-ai/tools` for the main public agent/tool integration story. Reach for `@input/pen-tools` when you need the underlying document semantics or lower-level runtime escape hatches.

## Tool surfaces

This package registers every document tool. Which surface a tool is **mounted** on is a different question (`spec/rules/ai.md` UC7): the in-editor loop mounts reads plus exactly one mutator; the single-purpose mutators stay host-facing for external agents.

| Tool                      | Surface                                                             |
| ------------------------- | ------------------------------------------------------------------- |
| `read_document`           | in-editor loop, host                                                |
| `get_context`             | in-editor loop, host                                                |
| `get_cursor_context`      | in-editor loop, host                                                |
| `search_document`         | in-editor loop, host                                                |
| `retrieve_document_spans` | in-editor loop, host                                                |
| `list_block_types`        | in-editor loop, host                                                |
| `inspect_target`          | host (describes the per-block mutators; stays off the edit channel) |
| `list_valid_operations`   | host (same)                                                         |
| `edit_document`           | in-editor loop (the one mutating tool), host                        |
| `insert_block`            | host-facing                                                         |
| `update_block`            | host-facing                                                         |
| `delete_block`            | host-facing                                                         |
| `move_block`              | host-facing                                                         |
| `write_document`          | host-facing                                                         |

A tool that serves neither surface is deleted.

## Payload validation (SEC6)

Built-in document tools and `ToolContextImpl` validate each tool-call payload structurally **before** `editor.apply`. Pipeline phase 2 remains the backstop for every other op source.

A payload is accepted only when all of these hold:

- `type` is a known `DocumentOp` union member (`DOCUMENT_OP_TYPES` / `isDocumentOpType`)
- targets resolve against the live document, or against `insert-block` ids earlier in the same batch
- text offsets (and delete/replace spans) stay inside the live block, including text inserted earlier in the same batch
- the op `text` field, when present, is at most `MAX_OP_TEXT_FIELD_LENGTH` (1,048,576 UTF-16 code units — 1MB)
- `__proto__`, `constructor`, and `prototype` are not own keys anywhere in the payload

These constants are not configurable:

| Constant                   |     Value | What it caps        |
| -------------------------- | --------: | ------------------- |
| `MAX_OP_TEXT_FIELD_LENGTH` | 1,048,576 | Per-op `text` field |

Invalid payloads emit `diagnostic` events (`code: "invalid-tool-payload"`, `source: "tools"`) and **do not apply**. One failure rejects the whole batch — no partial apply. The same diagnostic is emitted when a tool is pointed at an unknown block, a hidden/unavailable block type, or an empty `write_document` payload; those calls still throw so the model sees the error.

This package also rejects `__proto__`, `constructor`, and `prototype` as own keys anywhere in a payload (same filter as apply-time phase 2). It does not validate prop schemas or cap string fields other than `text`. Apply-time `@input/pen-core` phase 2 is the enforcement backstop: those own keys emit `PEN_APPLY_009` and the op is not written.

Custom execution flows should use the same helpers:

```ts
import { createEditor } from "@input/pen";
import {
  applyValidatedOps,
  assertValidToolPayloads,
  validateToolPayloads,
  MAX_OP_TEXT_FIELD_LENGTH,
} from "@input/pen-tools";
import type { DocumentOp } from "@input/pen-types";

const editor = createEditor();
const payloads: DocumentOp[] = [
  {
    type: "insert-block",
    blockId: "b1",
    blockType: "paragraph",
    props: {},
    position: "last",
  },
];

const result = validateToolPayloads(editor, payloads);
if (!result.ok) {
  // result.ops is empty; result.failures carry the diagnostic payloads
}

applyValidatedOps(editor, payloads, { origin: "ai" });
```

`validateToolPayloads` inspects without applying. `assertValidToolPayloads` emits the diagnostics and throws. `applyValidatedOps` asserts, then applies the validated batch.

## `edit_document` for hosts (EC21)

The built-in `edit_document` tool is one caller of a public compiler. A host that needs a different apply origin, undo grouping, or persistence wrapper uses the same path instead of forking the operation set:

```ts
import { createEditor } from "@input/pen";
import { executeEditDocument, planEditDocument } from "@input/pen-tools";
import type { DocumentOp } from "@input/pen-types";

const editor = createEditor();

const plan = planEditDocument(editor, {
  operations: [
    {
      operation: "replace_block_text",
      blockId: "intro",
      text: "Rewritten.",
    },
  ],
});
// plan.compiledOperations names compiled ops; nothing is applied yet

const result = executeEditDocument(
  editor,
  {
    operations: [
      { operation: "insert_blocks", blockId: "intro", markdown: "Hi" },
    ],
  },
  {
    origin: { type: "ai", groupId: "host-run" },
    apply: (ops: DocumentOp[], applyOptions) => {
      editor.apply(ops, applyOptions);
    },
  },
);
```

`EDIT_DOCUMENT_OPERATIONS` is the closed EC4 set. `planEditDocument` compiles without writing and reports `compiledOperations`. `executeEditDocument` validates the batch, applies, then observes the apply boundary so a dropped op is not listed as applied. The injected `apply` must still call `editor.apply` and must not remap results. `editDocumentTool(editor, options)` is the same executor behind a `ToolDefinition`; `toolsExtension()` registers it with the default `{ origin: "ai" }` apply.

## Options

`toolsExtension()` takes no options.

## Facets and commands

This package contributes no facets and no commands. It requires no other extensions. It registers document tools on a slot (`tools:toolRuntime`). Prefer `@input/pen-ai/tools` for the public agent surface.

## Documentation

The docs site (the `@input/pen-docs` package) covers this area on the Extensions and facets page (`#/extensions`) and the AI features page (`#/ai`).

The public signatures of record are in `api-report.md` next to this package's source in the Pen repository. The docs site does not host a generated browsable reference.

## License

MIT © Input B.V. See [`LICENSE.md`](./LICENSE.md).
