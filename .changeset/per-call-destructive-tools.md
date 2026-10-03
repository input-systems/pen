---
"@input/pen-types": minor
"@input/pen-tools": minor
"@input/pen-ai": minor
---

Destructive tool calls are classified per call (AIB3). `ToolDefinition.destructive` may be a resolver `(input, { staged }) => boolean` (`ToolDestructiveResolver`, `ToolAuthorityContext`), and `edit_document` declares one: staged edits and direct inserts, moves, formatting, and deletes of empty blocks no longer reach your `confirm` resolver or emit `ai-tool-unconfirmed`; direct replaces, deletes of non-empty blocks, and content-kind changes of non-empty blocks still do. `authorizeAIToolCall` and `isDestructiveAITool` take the call's context. New `aiExtension({ unconfirmedDestructive: "refuse" })` (also on `AIToolGrant`, `AIToolTurnOptions`, and `AgenticLoopOptions`) blocks destructive calls when no resolver is installed and emits `ai-tool-unconfirmed` — use it in production if you expose `delete_block` or `write_document`. A host that used `confirm` as an "every AI edit" hook should move to `onBeforeApply` or the commit event.

Breaking: yes — code that reads `ToolDefinition.destructive` as a boolean must handle a function; `edit_document` consults `confirm` only for direct calls that remove or replace content
