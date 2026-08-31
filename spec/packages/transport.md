# @input/pen-transport

## Purpose

Transports for Pen: the in-process direct transport and the Server-Sent Events transport, one package with a subpath per variant.

## Public Role

Provide transport-specific wiring around Pen protocols and sessions. The live `Editor` is a constructor argument (`directTransport({ editor })`, `createSSEHandler({ editor })`), never a field on the wire request.

## Key Exports / Entrypoints

- Export map: `.`, `./direct`, `./sse`
- `./direct`: `directTransport()` and `DirectTransportOptions`. `toolRuntime` is required.
- `./sse`: server `createSSEHandler()`, client `sseTransport()`, types `SSEServerOptions`, `SSEClientOptions`, `SSEEvent`.
- The root export re-exports both variants; the subpaths are the documented way to name the one in use.
- `parsePenStreamRequest()` is internal to the SSE handler and deliberately not on any barrel.
- Workspace scripts: `build`, `clean`, `dev`, `lint`, `test`, `typecheck`

## Dependencies And Boundaries

- Runtime dependencies: `@input/pen-ai`, `@input/pen-core`, `@input/pen-types`
- Peer dependencies: No peer dependencies declared.
- Boundary: Transport packages should stay below product policy and above raw network wiring. The `@input/pen-ai` dependency is for tool authorization (`openAIToolCall`, `createAIToolTurn`), not for AI orchestration.

## Data Flow / Runtime Model

Direct is in-process only: no socket, no resume, `toolCalls` run against the construction-time runtime and editor.

`createSSEHandler` reads the POST body, rejects oversized or malformed JSON with HTTP 400, then runs `parsePenStreamRequest()`. That parser admits only the serializable `PenStreamRequest` keys. `context.editor` is not a valid field and fails the parse, so tool execution never sees a live editor handle from the network. The editor used for tool context is the one passed at handler construction.

In both variants each `toolCalls` entry is authorized with `openAIToolCall()` before `toolRuntime.executeTool()`. A denied call yields `tool-error` and skips execution. The write guard installed for the call is restored in `finally`, not `catch`: abandoning a stream mid-`yield` resumes the generator with a return completion, which runs `finally` and skips `catch`. A `catch`-only restore left a read-only guard patched onto the host editor and silently dropped later writes. `opened.close()` is idempotent and returns its first result on later calls (owned by `@input/pen-ai/tools`).

## Integration Notes

- Path in workspace: `packages/transport`
- Spec path mirrors workspace path: `packages/transport.md`
- Merged from the pre-publish `@input/pen-transport-direct` and `@input/pen-transport-sse` packages (SF3 amendment); the variants kept their sources under `src/direct/` and `src/sse/` with one manifest.
- This package is part of the current package surface and should stay aligned with the headless runtime architecture.

## Current Maturity / Intended Usage

Workspace package at version `0.1.8`; intended usage is current-state but still evolving.

## Non-goals

Do not make transports own editor behavior or auth policy.
