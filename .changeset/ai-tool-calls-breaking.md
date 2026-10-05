---
"@input/pen-types": minor
"@input/pen-tools": minor
"@input/pen-ai": minor
"@input/pen-transport": minor
---

AI tool calls are attributed, classified and undone per call (AIB3, AIB4).

- `openAIToolCall()` returns the call's own `context`. `executeAITool()` and both transports run handlers with it. Every write path books a write to the call that issued it, and refuses a read-only call's write.
- The user's typing while a call is open is no call's write.
- `StreamingTarget.disableActiveWriter()` is replaced by the `activeWriter` getter.
- `ToolDefinition.destructive` may be a resolver `(input, { staged }) => boolean` (`ToolDestructiveResolver`, `ToolAuthorityContext`).
- `edit_document` consults `confirm` only for direct calls that remove or replace content: direct replaces, deletes of non-empty blocks, and content-kind changes. `authorizeAIToolCall` and `isDestructiveAITool` take the call's context.
- New `unconfirmedDestructive: "refuse"` (on `aiExtension`, `AIToolGrant`, `AIToolTurnOptions` and `AgenticLoopOptions`) blocks destructive calls when no resolver is installed. Use it in production if you expose `delete_block` or `write_document`.
- A host that used `confirm` as an "every AI edit" hook moves to `onBeforeApply` or the commit event.
- `UndoManager.syncExplicitUndoGroup` is replaced by `withCapture(origin, groupId, run)`. `CRDTUndoManager` gains an optional `setCaptureKey` (`CRDTUndoCaptureKey`).

Host migration:

- Tool handlers that compared `ctx.editor === editor` compare `ctx.editor.internals.adapter` (or the document) instead, because `ctx.editor` is now a per-call view.
- Code that called `StreamingTarget.disableActiveWriter()` reads `activeWriter`.
- Code that reads `ToolDefinition.destructive` as a boolean must handle a function.
- Hosts that implement `UndoManager` replace `syncExplicitUndoGroup` with `withCapture`.

Breaking: yes — tool handlers compare `ctx.editor.internals.adapter` instead of `ctx.editor === editor`, read `activeWriter` instead of `disableActiveWriter()`, handle a function-valued `ToolDefinition.destructive`, and `UndoManager` implementations replace `syncExplicitUndoGroup` with `withCapture`
