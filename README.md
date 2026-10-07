<!-- markdownlint-disable MD033 MD041 -->
<img width="100%" height="auto" alt="logo_black@2x" src="https://github.com/user-attachments/assets/6eb68df5-c70f-4a38-ac6f-f69530f0b355" />

<h3 align="center">
  Rich text editor for human/AI Agent<br/> collaboration. Headless. Extendable.
</h3>

<p align="center">
  <a href="https://www.npmjs.com/package/@input/pen"><img src="https://img.shields.io/npm/v/@input/pen?style=flat&color=00C2FF" alt="npm version" /></a>
  <a href="https://github.com/input-systems/pen/stargazers"><img src="https://img.shields.io/github/stars/input-systems/pen?style=flat&color=8D30FF" alt="GitHub stars" /></a>
  <a href="LICENSE.md"><img src="https://img.shields.io/badge/license-MIT-FF2B6E" alt="license" /></a>
</p>
<!-- markdownlint-enable MD033 MD041 -->

**Pen is a block-native rich text editor SDK** for applications where people and AI write in the same document. The runtime is headless: it owns the document, selection, and history, and renders nothing you did not ask for. The document is a Yjs CRDT from the first keystroke.

## Why Pen

**You own the UI.** Toolbars, slash menus, and AI panels are your markup over Pen's state. The editor field itself adopts a small chrome stylesheet by default so `createEditor()` plus `<PenEditor />` is a usable field; pass `chrome={false}` to stay unstyled. Start with one component, or compose the `Pen.*` primitives and keep every pixel.

**One write path.** A keystroke, a paste, an AI rewrite, and a remote peer all become `DocumentOp[]` and go through `editor.apply(ops, { origin })`. There is no second way to change a document, so undo, review, and history read one stream instead of guessing.

**AI is a writer, not a plugin.** Origins record who wrote each change, so a model can stream into the document, land as tracked suggestions, and be accepted or rejected per change, with the same undo stack a human gets.

**Collaborative by construction.** The document is a Yjs CRDT from the first keystroke. Multiplayer adds presence and a transport; it does not change the document model.

**Runs without a DOM.** The same runtime works in Node, so agents, servers, and pipelines edit documents through the API the editor uses.

## Playground

The [playground](https://pen-playground.input.so/) is a complete Pen app you can open in the browser: an editor in the middle, an AI agent on the left, a live view of the document on the right, and optional collaboration. The agent provides simulated answers without an API key.

<img width="1543" alt="Web preview of the Pen playground" src="https://input-pr-z1wpxj.s3.us-west-2.amazonaws.com/pen/playground-preview.png" />

## Quick Start

Every host follows the same two steps: build an editor, then mount it. `createEditor()` from `@input/pen` comes with the batteries preset applied; the default schema, undo, formatting shortcuts, document tools, and the streaming writer. The React and Vue hooks own the editor's lifetime themselves, so they take the preset as an option instead.

### React

```bash
pnpm add @input/pen @input/pen-react react react-dom yjs
```

```tsx
"use client";

import { defaultPreset } from "@input/pen";
import { PenEditor, useEditor } from "@input/pen-react";

export function App() {
  const editor = useEditor({ preset: defaultPreset() });

  return <PenEditor editor={editor} />;
}
```

`useEditor` owns the editor's lifetime: one editor per component instance, destroyed on unmount, rebuilt across a StrictMode remount. Reach for `createEditor` directly when something outside React owns the editor (a store, a route loader, or a collaboration session) and pass the instance in as `useEditor(editor)`, which borrows it without destroying it.

`@input/pen-react` is a client module and its entry points carry `"use client"`. In Next.js App Router, call `useEditor` from a Client Component; `@input/pen-core` stays importable from server code.

### Vue

```bash
pnpm add @input/pen @input/pen-vue vue yjs
```

```vue
<script setup lang="ts">
import { defaultPreset } from "@input/pen";
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
pnpm add @input/pen @input/pen-dom yjs
```

```ts
import { createEditor } from "@input/pen";
import { mountEditor } from "@input/pen-dom";

const editor = createEditor();

const root = document.querySelector("#app");
if (!(root instanceof HTMLElement)) {
  throw new Error("Missing #app");
}

mountEditor(editor, root);
```

`mountEditor` assembles the same field editor, root shell, and inline surfaces that the React and Vue bindings use. Construct it in the browser, not during SSR.

`createEditor` from `@input/pen` applies `defaultPreset()` whenever you pass no `preset` of your own; explicit `preset`, `schema`, and `extensions` options pass through unchanged. The bare constructor — no schema, no extensions, `editor.undoManager` an inert stub, and Mod-Z doing nothing, silently — is `@input/pen-core`'s `createEditor`. Reach for that one when you compose every extension yourself.

**Peer dependencies.** `react` and `react-dom`, or `vue`, are peers of the binding you install. `yjs` is a peer of `@input/pen-yjs`, which `@input/pen-core` depends on, so every Pen install needs it, since the document model is a Yjs document. `y-protocols` is needed only for collaboration: it is a peer of `@input/pen-multiplayer` and of the `@input/pen-yjs/awareness` subpath, and a non-collaborative install never loads it. `yjs` is a peer rather than a dependency so that exactly one copy is resolved; the adapter asserts that at document creation and fails loudly if a second copy is present. Package managers that auto-install peers will add them for you, but naming them explicitly is what pins the versions you get.

**Direct imports.** Sections below import `@input/pen-types` and `@input/pen-shortcuts` on top of a feature package each. Both arrive transitively with the starter, so the code resolves without them in your manifest, but list whatever you import directly, because a phantom dependency breaks as soon as the tree shifts underneath it.

**Styling.** `PenEditor` and `mountEditor` adopt editor-field chrome by default (full-width empty field, painted placeholders, a `:focus-visible` ring). Pass `chrome={false}` for the HOST6 unstyled path: clicks still land and the first keystroke works with no CSS at all. Design tokens live in the `STYLING.md` that ships inside `@input/pen-react`.

## The Document Model

Three ideas cover most of Pen.

**Blocks** are the document unit, and addressing is block-scoped: `{ blockId, offset }`. **Ops** are the mutation currency: ten variants, including `splice-text`, `format-text`, `insert-block`, and `move-block`. **Origins** label the author of a change, which is how undo, suggestions, and attribution stay correct.

```ts
import { createEditor } from "@input/pen";
import { generateId } from "@input/pen-types";

const editor = createEditor();

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

Pen keeps state in the editor and hands you the pieces to render it. `useToolbar` reports what the current selection can do, and `@input/pen-shortcuts` provides the formatting commands behind the keyboard shortcuts, so your toolbar and Mod-B stay in agreement for free.

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

When you want structure without styling, `@input/pen-react` also ships unstyled compound primitives (`Pen.Editor.*`, `Pen.Toolbar.*`, `Pen.SlashMenu.*`, `Pen.Search.*`, `Pen.AI.*`, `Pen.Multiplayer.*`) plus hooks such as `useSearch`, `useSelection`, `useSlashMenu`, and `useSnapshots`. Use `PenEditor` to ship today and drop down to primitives when the design demands it.

## AI Co-Authoring

`aiExtension` needs one thing from you: a `ModelAdapter` that streams events. Pen bundles no provider SDK and holds no API keys, so the model call stays in your infrastructure.

```ts
import { aiExtension } from "@input/pen-ai";
import { createEditor } from "@input/pen";
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
  extensions: [aiExtension({ model })],
});
```

By default AI edits land as tracked suggestions for a review UI; `mutationPreference: "direct"` applies them immediately. Because AI writes carry an `ai` origin through the same pipeline as human edits, a rewrite is reviewable, undoable, and attributable without a parallel code path. Subpaths cover the rest: `@input/pen-ai/suggestions` for proactive suggestions, `@input/pen-ai/autocomplete` for inline completion, `@input/pen-ai/tools` for document tool calls, and `@input/pen-ai/stream` for streaming protocol handling.

## Collaboration

The document is already a CRDT, so collaboration is presence plus a network provider. `multiplayerExtension` owns peers, remote cursors, and selections.

```ts
import { createEditor } from "@input/pen";
import { multiplayerExtension } from "@input/pen-multiplayer";

const editor = createEditor({
  extensions: [
    multiplayerExtension({
      user: { id: "ada", name: "Ada Lovelace", color: "#8D30FF" },
    }),
  ],
});
```

Pen ships no server. To go over the wire, pass a `sessionFactory` that wraps your provider. `createYjsProviderSession` from `@input/pen-yjs` adapts anything with connect, disconnect, and status callbacks. `playground/src/collaboration/session.ts` is a complete `y-websocket` implementation.

## Import And Export

`@input/pen-interop` moves documents in and out as HTML, Markdown, JSON, or XML. JSON is the canonical machine-readable format; XML exists for interoperability.

```ts
import { createEditor } from "@input/pen";
import {
  markdownExporter,
  markdownImporter,
} from "@input/pen-interop/markdown";

const editor = createEditor();

markdownImporter.import("# Title\n\nHello **world**.", editor, {
  replace: true,
});

const markdown = markdownExporter.export(editor);
```

Importers report what they dropped rather than failing silently, and HTML input is sanitized on the way in.

## Without A DOM

`createHeadlessEditor` gives you the full runtime with no browser globals: the same ops, schema, and normalization your UI runs, in Node. The starter's carries the same batteries as its rendered constructor; `@input/pen-core`'s is the bare one.

```ts
import { createHeadlessEditor } from "@input/pen";
import { exportPlainText } from "@input/pen-interop/json";

export async function summarize(): Promise<string> {
  const editor = createHeadlessEditor();

  await editor.whenReady();
  const text = exportPlainText(editor);
  await editor.destroy();

  return text;
}
```

This is the path for server-side generation, agent workflows, migrations, and tests. Most of Pen's own suite exercises the runtime with no DOM at all.

## Packages

Install `@input/pen` and a renderer (`createEditor()` from the starter applies the batteries preset, and `@input/pen-core` plus the default schema arrive with it), then add the rest when you need them. Everything below ships as public npm packages released from this repository, so none of it needs a credential to install, and every published package commits an `api-report.md` next to its source as the signatures of record.

This table is the whole published set. The last three rows are companions: they arrive as dependencies of the packages above them, and installed on their own they give you helpers with no editor. Name a companion in your manifest when you import from it directly, alongside the preset or core rather than instead of it; each companion's README says the same in its first sentence.

| Package                  | What it does                                                                  |
| ------------------------ | ----------------------------------------------------------------------------- |
| `@input/pen`             | Batteries-included starter: `createEditor()` with the default preset built in |
| `@input/pen-core`        | Editor runtime: apply pipeline, selection, normalization, extension manager   |
| `@input/pen-schema`      | Default block and inline definitions                                          |
| `@input/pen-yjs`         | Yjs document adapter                                                          |
| `@input/pen-react`       | React primitives, hooks, and renderers: the documented renderer surface       |
| `@input/pen-vue`         | Vue bindings over the shared DOM engine                                       |
| `@input/pen-dom`         | Framework-free DOM field-editor engine                                        |
| `@input/pen-ai`          | AI sessions, suggestions, autocomplete, tools, and streaming                  |
| `@input/pen-multiplayer` | Presence, remote cursors, and remote selections                               |
| `@input/pen-interop`     | HTML, Markdown, JSON, and XML import and export                               |
| `@input/pen-search`      | Search and replace primitives                                                 |
| `@input/pen-autoformat`  | Markdown shortcuts while typing                                               |
| `@input/pen-shortcuts`   | Keyboard shortcuts and formatting commands                                    |
| `@input/pen-undo`        | Undo and redo with origin tagging                                             |
| `@input/pen-snapshots`   | Snapshot history and per-character attribution                                |
| `@input/pen-tools`       | The built-in document tools: block CRUD, generation zones, tool runtime       |
| `@input/pen-transport`   | Transports for AI streams: in-process (`./direct`) and SSE (`./sse`)          |
| `@input/pen-test`        | Headless test utilities and deterministic fixtures                            |
| `@input/pen-bench`       | Benchmarks with recorded budgets                                              |
| `@input/pen-assets`      | In-memory asset provider for development, tests, and benchmarks               |
| `@input/pen-types`       | Companion: shared contracts, constants, and `generateId`                      |
| `@input/pen-ingest`      | Companion: Markdown parsing and write-op construction                         |
| `@input/pen-markdown`    | Companion: Markdown export for blocks and ranges                              |

## Architecture

Pen is layered, and dependencies point strictly downward: contracts, then the CRDT adapter, then the core runtime, then schema, rendering, and extensions. `editor.apply(...)` is the runtime authority boundary for document writes, extensions compose behavior without replacing it, and renderer packages stay separate from the core.

The current-state specs in [`spec/README.md`](spec/README.md) are the contract: per-package descriptions in `spec/packages/`, normative rules with stable IDs in `spec/rules/`, and architectural invariants in `spec/charter/`.

## Browser And Node Support

| Runtime         | Minimum                                | Input backend                                                                           |
| --------------- | -------------------------------------- | --------------------------------------------------------------------------------------- |
| Node            | `^22.22.2 \|\| ^24.15.0 \|\| >=26.0.0` | n/a (headless)                                                                          |
| Chromium        | 93                                     | contenteditable on 93–120; EditContext when `EditContext` is a function (Chromium 121+) |
| Firefox         | 92                                     | contenteditable                                                                         |
| Safari / WebKit | 15.4                                   | contenteditable                                                                         |

Expanded field-editor mode and table-cell editing always use contenteditable, even when EditContext is present. APIs newer than this floor (EditContext, `structuredClone`, `ResizeObserver`, `color-mix()`, `crypto.randomUUID`) are feature-detected with a documented fallback and do not raise the minimum. Published packages declare `engines.node: "^22.22.2 || ^24.15.0 || >=26.0.0"`, the range jsdom 30 declares (the Node sanitizer behind `@input/pen-interop` runs on it), and CI verifies each line's exact floor (Node 22.22.2 and 24.15.0) and current Node 26, plus one non-Linux runner on the 22.22.2 floor, in [`.github/workflows/node-matrix.yml`](.github/workflows/node-matrix.yml). Raising the floor is a minor-version change; lowering it is never silent. The reasoning is in [`spec/rules/host.md`](spec/rules/host.md) (HOST3, HOST4).

## Docs And Examples

- **[Documentation](https://input-systems.github.io/pen/)**: getting started per host, core concepts, selection, extensions, commands, collaboration, AI, import and export, security, and accessibility.
- **Examples**: minimal Vite apps at [`examples/react`](examples/react), [`examples/vue`](examples/vue), and [`examples/vanilla`](examples/vanilla). Each is a workspace member consuming the built packages, so `pnpm build` once and then `pnpm --filter @input/pen-example-react dev`. CI mounts each one and types into it. A drifted quickstart fails the build.

## Development

```bash
pnpm install
pnpm dev
```

`pnpm dev` builds workspace `dist/` once, then watches the libraries and starts every Vite app on a fixed port. If a port is taken, Vite exits instead of hopping:

| App             | URL                   |
| --------------- | --------------------- |
| Playground      | http://localhost:5173 |
| Docs            | http://localhost:5174 |
| React example   | http://localhost:5175 |
| Vue example     | http://localhost:5176 |
| Vanilla example | http://localhost:5177 |

A library edit rebuilds that package's `dist/` and reloads the open app; no manual rebuild or restart. To run one app and its watchers: `pnpm dev -- --filter=@input/pen-playground...`.

```bash
pnpm build
pnpm test
pnpm typecheck
pnpm lint
```

Prefer scoped runs while iterating: `pnpm --filter @input/pen-core test`. Browser coverage is `pnpm test:e2e`, which drives the playground. See [`playground/README.md`](playground/README.md). Any change to a published package needs a changeset (`pnpm changeset`). [`CONTRIBUTING.md`](CONTRIBUTING.md) has the full loop, including which gates run in CI.

Releases use Changesets: approve the **Version Packages** PR workflows, then approve and merge the PR after its checks pass. CI builds and publishes all public packages to npm and completes their tags. See [release setup and recovery](.changeset/README.md); no GitHub App is required.

## Community

- [Contributing](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security Policy](SECURITY.md)
- [Support](SUPPORT.md)

## Authors

Pen is created and maintained by [Noud Adrichem](https://www.x.com/noudadrichem), [Jan Gladines](https://www.x.com/_janglad), [Mattèo Gauthier](https://www.x.com/MatteoGauthier_), and [Krijn Rijshouwer](https://www.x.com/krijnrijshouwer) from [Input](https://www.input.so).

## License

The Pen SDK is provided under the [MIT License](LICENSE.md).

Copyright (c) 2026-present Input B.V.
