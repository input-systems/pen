# `@input/pen-transport`

`@input/pen-transport` ships Pen's two reference transports as subpath entries: `@input/pen-transport/direct` (in-process, for tests and demos) and `@input/pen-transport/sse` (Server-Sent Events, a development-oriented reference for the streaming protocol). Neither is a production collaboration or sync backend, and this package does not own endpoint routing, auth, persistence, or deployment — those stay host seams.

The root entry re-exports both variants; the subpaths are the documented way to name the one you use.

## Install

```bash
pnpm add @input/pen @input/pen-transport
```

## `./direct`

**Grade: development-only.** This is a single-process, in-process only, no-network transport for tests and demos. It never opens a socket and cannot reach a runtime in another process. It is non-resumable: there is no stream history and nothing to reconnect. Do not ship it.

A host can rely on `directTransport({ toolRuntime, editor }).stream(request)` running `toolCalls` in-process against the construction-time runtime and editor and yielding `PenStreamPart`s until `done`. A host cannot rely on a socket, resume, `reconnect`, or `onConnectionChange`.

```ts
import { createEditor } from "@input/pen";
import { getAIToolRuntime } from "@input/pen-ai/tools";
import { directTransport } from "@input/pen-transport/direct";

const editor = createEditor();
const toolRuntime = getAIToolRuntime(editor);

if (!toolRuntime) {
  throw new Error("AI tools are unavailable.");
}

const transport = directTransport({
  toolRuntime,
  editor,
  onError(error) {
    console.error(error);
  },
});
```

A live `Editor` is passed at construction. It is not a field on `PenStreamRequest` — that type is the wire shape, and direct does not smuggle a handle through it.

Mutating `toolCalls` are default-deny. Set `allowedMutatingTools` to grant specific names.

### Options — `directTransport`

| Option                 | Default | Effect                                           |
| ---------------------- | ------- | ------------------------------------------------ |
| `toolRuntime`          | none    | Required. In-process tool execution              |
| `editor`               | unset   | In-process editor handed to `ToolContext.editor` |
| `allowedMutatingTools` | `[]`    | Mutating tools the request may run. Default deny |
| `onError`              | unset   | Called with tool-execution errors                |

## `./sse`

**Grade: reference.** This transport is single-process, non-resumable, and development-oriented. It illustrates Pen's SSE streaming protocol. Do not use it as a production collaboration or sync backend.

A host can rely on `sseTransport({ url }).stream(request)` POSTing a `PenStreamRequest` and yielding `PenStreamPart`s from `createSSEHandler`'s event-stream, including in-process `toolCalls` when a `toolRuntime` is wired. A host cannot rely on resume, `reconnect`, multi-process deployment, persistence, or request authentication — those stay host seams.

Resume is absent, not stubbed. `createSSEHandler` answers `GET` — with or without `Last-Event-ID` — with `405 Method Not Allowed` and `Allow: POST`. It does not return `501`. There is no replayable log, no retention bound, and no `X-Replay-Supported` header. Event `id` fields on the wire are not a replay contract. The client POSTs a fresh stream and does not send `Last-Event-ID`. A dropped connection is a full restart, not a continuation. This package does not resync document state. The handler is in-process memory only; it does not survive a process restart or a second instance.

### Server example

```ts
import { createEditor } from "@input/pen";
import { getAIToolRuntime } from "@input/pen-ai/tools";
import { createSSEHandler } from "@input/pen-transport/sse";

const editor = createEditor();
const toolRuntime = getAIToolRuntime(editor);

if (!toolRuntime) {
  throw new Error("AI tools are unavailable.");
}

const handler = createSSEHandler({
  toolRuntime,
  editor,
  onError(error) {
    console.error(error);
  },
});
```

A live `Editor` is passed at construction. `PenStreamRequest` is the wire body and has no `editor` field. The handler rejects a body that is not a `PenStreamRequest` — including a top-level or nested `editor`, a wrong-shaped field, a prototype key, or an oversized payload — with `400` before any tool runs.

Mutating `toolCalls` are default-deny. Set `allowedMutatingTools` to grant specific names; an un-allowlisted mutating call emits `tool-error` and does not run the handler or apply.

Destructive calls are allowed by default. A granted tool whose call is destructive (`delete_block`, `write_document`, or an `edit_document` that removes content) runs when no `confirm` resolver is configured, with an `ai-tool-unconfirmed` diagnostic. A server that exposes the handler to clients should pass `unconfirmedDestructive: "refuse"`, or set it once on `aiExtension`, or provide `confirm`.

Each request is one tool turn: the per-turn budgets (tool calls and document ops) and the undo group start fresh per request, so a client that splits its calls across requests is limited per request, not per conversation.

### Client example

```ts
import { sseTransport } from "@input/pen-transport/sse";

const transport = sseTransport({
  url: "https://example.com/api/stream",
  pingTimeout: 30_000,
});
```

### Integration notes

- This package handles streaming transport concerns, not editor authority or product UI.
- The host application still owns endpoint routing, auth, headers, and server deployment. Auth is a host seam; this package does not verify requests.
- A dropped stream is not retried or resumed by this package. If the host retries, that is a new `POST`, not a continuation.
- `createSSEHandler()` can execute Pen tool-runtime requests and stream `PenStreamPart` events back to the client.

### Options — `sseTransport`

| Option        | Default  | Effect                       |
| ------------- | -------- | ---------------------------- |
| `url`         | required | POST endpoint                |
| `headers`     | unset    | Extra request headers        |
| `pingTimeout` | `30_000` | Idle timeout in milliseconds |
| `signal`      | unset    | Abort the client stream      |

### Options — `createSSEHandler`

| Option                   | Default                  | Effect                                                                                                                      |
| ------------------------ | ------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `toolRuntime`            | unset                    | In-process tool execution                                                                                                   |
| `editor`                 | unset                    | In-process editor for `ToolContext`                                                                                         |
| `allowedMutatingTools`   | `[]`                     | Mutating tools the request may run. Default deny                                                                            |
| `confirm`                | editor's                 | Confirms destructive calls (AIB3)                                                                                           |
| `unconfirmedDestructive` | editor's, then `"allow"` | A destructive call with no `confirm`: `"allow"` runs it with a diagnostic, `"refuse"` blocks it. Use `"refuse"` on a server |
| `onRequest`              | unset                    | Called with each `PenStreamRequest`                                                                                         |
| `onError`                | unset                    | Called with handler errors                                                                                                  |
| `pingInterval`           | `15_000`                 | Server ping interval in milliseconds                                                                                        |

## Documentation

The docs site (the `@input/pen-docs` package) covers this area on the AI features page (`#/ai`).

The public signatures of record are in `api-report.md` next to this package's source in the Pen repository. The docs site does not host a generated browsable reference.

## License

MIT © Input B.V. See [`LICENSE.md`](./LICENSE.md).
