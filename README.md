<!-- markdownlint-disable MD033 MD041 -->
<img width="100%" height="auto" alt="logo_black@2x" src="https://github.com/user-attachments/assets/6eb68df5-c70f-4a38-ac6f-f69530f0b355" />

<h3 align="center">
  Rich text editor engine for human/AI<br/> collaboration. Headless. Extendable.
</h3>

<p align="center">
  <a href="https://github.com/input-systems/pen/stargazers"><img src="https://img.shields.io/github/stars/input-systems/pen?style=flat&color=8D30FF" alt="GitHub stars" /></a>
  <a href="LICENSE.md"><img src="https://img.shields.io/badge/license-MIT-FF2B6E" alt="license" /></a>
</p>
<!-- markdownlint-enable MD033 MD041 -->

# Pen

Pen is a block-native rich text editor SDK for applications where people and AI write in the same document. The runtime is headless — it owns the document, selection, and history, and renders nothing you did not ask for — and the document is a Yjs CRDT from the first keystroke.

## Why Pen

**You own the UI.** Pen ships no required stylesheet and no built-in chrome. Toolbars, slash menus, and AI panels are your markup over Pen's state. Start with one component, or compose the `Pen.*` primitives and keep every pixel.

**One write path.** A keystroke, a paste, an AI rewrite, and a remote peer all become `DocumentOp[]` and go through `editor.apply(ops, { origin })`. There is no second way to change a document, so undo, review, and history read one stream instead of guessing.

**AI is a writer, not a plugin.** Origins record who wrote each change, so a model can stream into the document, land as tracked suggestions, and be accepted or rejected per change — with the same undo stack a human gets.

**Collaborative by construction.** The document is a Yjs CRDT from the first keystroke. Multiplayer adds presence and a transport; it does not change the document model.

**Runs without a DOM.** The same runtime works in Node, so agents, servers, and pipelines edit documents through the API the editor uses.

## Quick Start

Pen has not shipped its first release train: every package is still the placeholder `0.0.1`, the first `changeset version` stamps **0.3.0**, and until that lands `pnpm add @input/pen-*` 404s on the public npm registry. Clone this repository, run `pnpm install` and `pnpm build`, and consume the built workspace artifacts — the commands below are the post-publish path. Versioning is a single `0.x` train (v3 ships as 0.3); the policy lives in [`spec/rules/api.md`](spec/rules/api.md) (API7).

Every host follows the same two steps: build an editor with `defaultPreset()`, then mount it. The preset supplies the default schema, undo, and formatting shortcuts.

### React

```bash
pnpm add @input/pen-preset-default @input/pen-react react react-dom yjs y-protocols
```

```tsx
"use client";

import { defaultPreset } from "@input/pen-preset-default";
import { PenEditor, useEditor } from "@input/pen-react";

export function App() {
  const editor = useEditor({ preset: defaultPreset() });

  return <PenEditor editor={editor} />;
}
```

`useEditor` owns the editor's lifetime: one editor per component instance, destroyed on unmount, rebuilt across a StrictMode remount. Reach for `createEditor` directly when something outside React owns the editor — a store, a route loader, or a collaboration session — and pass the instance in as `useEditor(editor)`, which borrows it without destroying it.

`@input/pen-react` is a client module and its entry points carry `"use client"`. In Next.js App Router, call `useEditor` from a Client Component; `@input/pen-core` stays importable from server code.

### Vue

```bash
pnpm add @input/pen-preset-default @input/pen-vue vue yjs y-protocols
```

```vue
<script setup lang="ts">
import { defaultPreset } from "@input/pen-preset-default";
import { PenEditor, useEditor } from "@input/pen-vue";

const editor = useEditor({ preset: defaultPreset() });
</script>

<template>
  <PenEditor :editor="editor" />
</template>
```

The composable mirrors the React hook: it destroys the editor it created when the component scope is disposed, and returns an editor you pass in untouched.

Vue has no `"use client"` directive. Mount `PenEditor` in the browser, not during SSR.

### Vanilla DOM

```bash
pnpm add @input/pen-core @input/pen-preset-default @input/pen-dom yjs y-protocols
```

```ts
import { createEditor } from "@input/pen-core";
import { defaultPreset } from "@input/pen-preset-default";
import { mountEditor } from "@input/pen-dom";

const editor = createEditor({
  preset: defaultPreset(),
});

const root = document.querySelector("#app");
if (!(root instanceof HTMLElement)) {
  throw new Error("Missing #app");
}

mountEditor(editor, root);
```

`mountEditor` assembles the same field editor, root shell, and inline surfaces that the React and Vue bindings use. Construct it in the browser, not during SSR.

Pass `defaultPreset()` — or an explicit `extensions` list — whenever you call `createEditor` yourself, as every example below does. A bare `createEditor()` installs no schema and no extensions, which leaves `editor.undoManager` an inert stub and Mod-Z doing nothing, silently.

**Peer dependencies.** `react` and `react-dom`, or `vue`, are peers of the binding you install. `yjs` and `y-protocols` are peers of `@input/pen-crdt-yjs`, which `@input/pen-core` depends on, so every Pen install needs both — including non-collaborative ones, since the document model is a Yjs document and the adapter imports awareness. `yjs` is a peer rather than a dependency so that exactly one copy is resolved; the adapter asserts that at document creation and fails loudly if a second copy is present. Package managers that auto-install peers will add them for you, but naming them explicitly is what pins the versions you get.

**Direct imports.** Sections below import `@input/pen-core`, `@input/pen-types`, and `@input/pen-shortcuts` on top of a feature package each. All three arrive transitively with the preset, so the code resolves without them in your manifest — but list whatever you import directly, because a phantom dependency breaks as soon as the tree shifts underneath it.

**Styling.** The editor is functional unstyled, including on an empty document — clicks land and the first keystroke works with no CSS at all. Design tokens live in the `STYLING.md` that ships inside `@input/pen-react`.

## The Document Model

Three ideas cover most of Pen.

**Blocks** are the document unit, and addressing is block-scoped: `{ blockId, offset }`. **Ops** are the mutation currency — ten variants, including `splice-text`, `format-text`, `insert-block`, and `move-block`. **Origins** label the author of a change, which is how undo, suggestions, and attribution stay correct.

```ts
import { createEditor } from "@input/pen-core";
import { defaultPreset } from "@input/pen-preset-default";
import { generateId } from "@input/pen-types";

const editor = createEditor({
  preset: defaultPreset(),
});

const blockId = generateId();

editor.apply(
  [
    {
      type: "insert-block",
      blockId,
      blockType: "paragraph",
      props: {},
      position: "last",
    },
    {
      type: "splice-text",
      blockId,
      from: 0,
      to: 0,
      insert: "Every change is an op.",
    },
  ],
  { origin: "user" },
);

editor.on("commit", (event) => {
  console.log(event.origin.type, event.summary.affectedBlockIds);
});
```

One `apply` call is one commit: validated, normalized, and reported as a single `commit` event with a change summary. Read the result back through `editor.documentState`, `editor.getBlock(id)`, or an exporter.

## Build Your Own UI

Pen keeps state in the editor and hands you the pieces to render it. `useToolbar` reports what the current selection can do, and `@input/pen-shortcuts` provides the formatting commands behind the keyboard shortcuts — so your toolbar and Mod-B stay in agreement for free.

```tsx
import { type Editor, useToolbar } from "@input/pen-react";
import { toggleInlineMark } from "@input/pen-shortcuts";

export function Toolbar({ editor }: { editor: Editor }) {
  const toolbar = useToolbar(editor);

  return (
    <div role="toolbar">
      <button
        type="button"
        disabled={!toolbar.canBold}
        aria-pressed={Boolean(toolbar.activeMarks.bold)}
        onClick={() => toggleInlineMark(editor, "bold")}
      >
        Bold
      </button>
      <button
        type="button"
        disabled={!toolbar.canItalic}
        aria-pressed={Boolean(toolbar.activeMarks.italic)}
        onClick={() => toggleInlineMark(editor, "italic")}
      >
        Italic
      </button>
      <span>{toolbar.blockType ?? "paragraph"}</span>
    </div>
  );
}
```

When you want structure without styling, `@input/pen-react` also ships unstyled compound primitives — `Pen.Editor.*`, `Pen.Toolbar.*`, `Pen.SlashMenu.*`, `Pen.Search.*`, `Pen.AI.*`, `Pen.Multiplayer.*` — plus hooks such as `useSearch`, `useSelection`, `useSlashMenu`, and `useHistory`. Use `PenEditor` to ship today and drop down to primitives when the design demands it.

## AI Co-Authoring

`aiExtension` needs one thing from you: a `ModelAdapter` that streams events. Pen bundles no provider SDK and holds no API keys, so the model call stays in your infrastructure.

```ts
import { aiExtension } from "@input/pen-ai";
import { createEditor } from "@input/pen-core";
import { defaultPreset } from "@input/pen-preset-default";
import type { ModelAdapter } from "@input/pen-types";

const model: ModelAdapter = {
  async *stream({ messages, signal }) {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages }),
      signal,
    });

    if (!response.body) {
      throw new Error("No response body");
    }

    const reader = response.body
      .pipeThrough(new TextDecoderStream())
      .getReader();

    let chunk = await reader.read();
    while (!chunk.done) {
      yield { type: "text-delta", delta: chunk.value };
      chunk = await reader.read();
    }

    yield { type: "done" };
  },
};

const editor = createEditor({
  preset: defaultPreset(),
  extensions: [aiExtension({ model })],
});
```

By default AI edits land as tracked suggestions for a review UI; `mutationPreference: "direct"` applies them immediately. Because AI writes carry an `ai` origin through the same pipeline as human edits, a rewrite is reviewable, undoable, and attributable without a parallel code path. Subpaths cover the rest: `@input/pen-ai/suggestions` for proactive suggestions, `@input/pen-ai/autocomplete` for inline completion, `@input/pen-ai/tools` for document tool calls, and `@input/pen-ai/stream` for streaming protocol handling.

## Collaboration

The document is already a CRDT, so collaboration is presence plus a network provider. `multiplayerExtension` owns peers, remote cursors, and selections.

```ts
import { createEditor } from "@input/pen-core";
import { multiplayerExtension } from "@input/pen-multiplayer";
import { defaultPreset } from "@input/pen-preset-default";

const editor = createEditor({
  preset: defaultPreset(),
  extensions: [
    multiplayerExtension({
      user: { id: "ada", name: "Ada Lovelace", color: "#8D30FF" },
    }),
  ],
});
```

Pen ships no server. To go over the wire, pass a `sessionFactory` that wraps your provider — `createYjsProviderSession` from `@input/pen-crdt-yjs` adapts anything with connect, disconnect, and status callbacks. `playground/src/collaboration/session.ts` is a complete `y-websocket` implementation.

## Import And Export

`@input/pen-interop` moves documents in and out as HTML, Markdown, JSON, or XML. JSON is the canonical machine-readable format; XML exists for interoperability.

```ts
import { createEditor } from "@input/pen-core";
import {
  markdownExporter,
  markdownImporter,
} from "@input/pen-interop/markdown";
import { defaultPreset } from "@input/pen-preset-default";

const editor = createEditor({
  preset: defaultPreset(),
});

markdownImporter.import("# Title\n\nHello **world**.", editor, {
  replace: true,
});

const markdown = markdownExporter.export(editor);
```

Importers report what they dropped rather than failing silently, and HTML input is sanitized on the way in.

## Without A DOM

`createHeadlessEditor` gives you the full runtime with no browser globals — the same ops, schema, and normalization your UI runs, in Node.

```ts
import { createHeadlessEditor } from "@input/pen-core";
import { exportPlainText } from "@input/pen-interop/json";
import { defaultPreset } from "@input/pen-preset-default";

export async function summarize(): Promise<string> {
  const editor = createHeadlessEditor({
    preset: defaultPreset(),
  });

  await editor.whenReady();
  const text = exportPlainText(editor);
  await editor.destroy();

  return text;
}
```

This is the path for server-side generation, agent workflows, migrations, and tests — most of Pen's own suite exercises the runtime with no DOM at all.

## Packages

Install `@input/pen-preset-default` and a renderer — the preset brings `@input/pen-core` and the default schema with it — then add the rest when you need them. Every published package commits an `api-report.md` next to its source as the signatures of record.

| Package                                                   | What it does                                                                |
| --------------------------------------------------------- | --------------------------------------------------------------------------- |
| `@input/pen-core`                                         | Editor runtime: apply pipeline, selection, normalization, extension manager |
| `@input/pen-preset-default`                               | Batteries-included assembly of schema, undo, shortcuts, and streaming       |
| `@input/pen-schema-default`                               | Default block and inline definitions                                        |
| `@input/pen-crdt-yjs`                                     | Yjs document adapter                                                        |
| `@input/pen-types`                                        | Shared contracts: types, constants, and helpers such as `generateId`        |
| `@input/pen-react`                                        | React primitives, hooks, and renderers — the documented renderer surface    |
| `@input/pen-vue`                                          | Vue bindings over the shared DOM engine                                     |
| `@input/pen-dom`                                          | Framework-free DOM field-editor engine                                      |
| `@input/pen-ai`                                           | AI sessions, suggestions, autocomplete, tools, and streaming                |
| `@input/pen-multiplayer`                                  | Presence, remote cursors, and remote selections                             |
| `@input/pen-interop`                                      | HTML, Markdown, JSON, and XML import and export                             |
| `@input/pen-search`                                       | Search and replace primitives                                               |
| `@input/pen-input-rules`                                  | Markdown shortcuts while typing                                             |
| `@input/pen-shortcuts`                                    | Keyboard shortcuts and formatting commands                                  |
| `@input/pen-undo`                                         | Undo and redo with origin tagging                                           |
| `@input/pen-history`                                      | Snapshot history and per-character attribution                              |
| `@input/pen-document-ops`                                 | Block CRUD and generation-zone tools                                        |
| `@input/pen-transport-direct`, `@input/pen-transport-sse` | In-process and Server-Sent Events transports for AI streams                 |
| `@input/pen-test`, `@input/pen-bench`                     | Headless test utilities and benchmarks                                      |

## Architecture

Pen is layered, and dependencies point strictly downward: contracts, then the CRDT adapter, then the core runtime, then schema, rendering, and extensions. `editor.apply(...)` is the runtime authority boundary for document writes, extensions compose behavior without replacing it, and renderer packages stay separate from the core.

The current-state specs in [`spec/README.md`](spec/README.md) are the contract — per-package descriptions in `spec/packages/`, normative rules with stable IDs in `spec/rules/`, and architectural invariants in `spec/charter/`.

## Browser And Node Support

| Runtime         | Minimum | Input backend                                                                           |
| --------------- | ------- | --------------------------------------------------------------------------------------- |
| Node            | `>=22`  | n/a (headless)                                                                          |
| Chromium        | 93      | contenteditable on 93–120; EditContext when `EditContext` is a function (Chromium 121+) |
| Firefox         | 92      | contenteditable                                                                         |
| Safari / WebKit | 15.4    | contenteditable                                                                         |

Expanded field-editor mode and table-cell editing always use contenteditable, even when EditContext is present. APIs newer than this floor — EditContext, `structuredClone`, `ResizeObserver`, `color-mix()`, `crypto.randomUUID` — are feature-detected with a documented fallback and do not raise the minimum. Published packages declare `engines.node: ">=22"`, and CI verifies both declared endpoints (Node 22 and current Node 26) plus one non-Linux runner in [`.github/workflows/node-matrix.yml`](.github/workflows/node-matrix.yml). Raising the floor is a minor-version change; lowering it is never silent. The reasoning is in [`spec/rules/host.md`](spec/rules/host.md) (HOST3, HOST4).

## Docs, Examples, And Playground

- **[Documentation](https://input-systems.github.io/pen/)** — getting started per host, core concepts, selection, extensions, commands, collaboration, AI, import and export, security, and accessibility.
- **Examples** — minimal Vite apps at [`examples/react`](examples/react), [`examples/vue`](examples/vue), and [`examples/vanilla`](examples/vanilla). Each is a workspace member consuming the built packages, so `pnpm build` once and then `pnpm --filter @input/pen-example-react dev`. CI mounts each one and types into it — a drifted quickstart fails the build.
- **Playground** — the reference app: editor, AI agent, document inspector, and optional live collaboration. Run `pnpm --dir playground run dev` after `pnpm build`. It is the host for `pnpm test:e2e`, not a starter template.

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm lint
```

Prefer scoped runs while iterating: `pnpm --filter @input/pen-core test`. Browser coverage is `pnpm test:e2e`. Any change to a published package needs a changeset (`pnpm changeset`). [`CONTRIBUTING.md`](CONTRIBUTING.md) has the full loop, including which gates run in CI.

## Community

- [Contributing](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security Policy](SECURITY.md)
- [Support](SUPPORT.md)

## Authors

Pen is created by [Input B.V.](https://www.input.so/).

## License

The Pen SDK is provided under the [MIT License](LICENSE.md).

Copyright (c) 2026-present Input B.V.
