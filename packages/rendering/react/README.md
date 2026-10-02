# @input/pen-react

React renderer, primitives, and hooks for Pen.

`@input/pen-react` is the batteries-included renderer surface. If you want clearer optional-feature boundaries, you can import the dedicated subpaths: `@input/pen-react/ai`, `@input/pen-react/ai-suggestions`, `@input/pen-react/search`, `@input/pen-react/snapshots`, and `@input/pen-react/multiplayer`.

## Install

```bash
pnpm add @input/pen @input/pen-react react react-dom yjs y-protocols
```

`react` and `react-dom` are peers of this package. `yjs` and `y-protocols` are peers of `@input/pen-yjs`, which `@input/pen-core` depends on. Add `@input/pen-core` explicitly when you import from it directly.

## Quick Start

```tsx
import { defaultPreset } from "@input/pen";
import { PenEditor, useEditor } from "@input/pen-react";

export function App() {
  const editor = useEditor({ preset: defaultPreset() });

  return <PenEditor editor={editor} />;
}
```

`PenEditor` requires `editor`. It adopts editor-field chrome by default so an empty field fills its block, placeholders paint, and `:focus-visible` uses `--pen-focus-ring`. Pass `chrome={false}` for the HOST6 unstyled path. The custom-property surface is listed in `STYLING.md`, which ships inside this package.

`useEditor` owns what it creates: one editor per component instance, destroyed on unmount, and rebuilt when StrictMode remounts the component. Passing an existing editor — `useEditor(editor)` — borrows it instead, leaving destruction to whoever created it.

`useEditor()` with no argument calls `createEditor({ schema: defaultSchema })` and does not install `defaultPreset()` — no Mod-B / Mod-I, undo, `tools`, or `delta-stream`. Undo fails silently. Pass `{ preset: defaultPreset() }` when you want that stack.

## Capabilities

The normative per-surface matrix is `packages/docs/CAPABILITY-MATRIX.md` in the Pen repository. React is the reference surface: every capability in the matrix is `supported` here except undo and input rules, which are `bring-your-own-ui` because they need no chrome — install `undoExtension()` or `autoformatExtension()` and the keyboard works without any binding code.

React ships the reference feature set, so it carries components other bindings leave to the host: the AI review and suggestion primitives, the generation zone, overlays and caret painting, multiplayer presence, and the search UI. That is bundled chrome over public state, not exclusive access — a capability marked `bring-your-own-ui` in another binding's column is reachable there too.

## Server rendering (HOST5)

SSR is shell-only: the server renders the editor container and no document content. That is a decision, not a gap. Faithful SSR of a CRDT document would require that document on the server. Pen does not own that transport and does not run a server CRDT.

This is HOST5 (`spec/rules/host.md`). Canonical copy: the docs site Server rendering page (`packages/docs/src/pages/SSR.tsx`, `#/ssr`).

`<PenEditor>` therefore hydrates an empty shell. Block-list and text-snapshot hooks return empty snapshots on the server on purpose. After hydration the client fills from the live document. Layout effects run through one `useIsomorphicLayoutEffect` seam so a server pass produces zero React warnings.

Hosts that need crawler-visible or statically indexed HTML render it from their own persisted copy with `@input/pen-interop/html`, which is DOM-free and server-safe. Construct a headless editor from that copy, export, and destroy — do not expect the React tree to emit this HTML.

```ts
import { createHeadlessEditor } from "@input/pen-core";
import { htmlExporter } from "@input/pen-interop/html";
import type { CRDTDocument } from "@input/pen-types";

declare const hostDocument: CRDTDocument;

const editor = createHeadlessEditor({ document: hostDocument });
const html = htmlExporter.export(editor);
editor.destroy();
```

Render that string as ordinary HTML next to the editor shell. The editor stays a client island; the exported markup is the host's content surface.

See the root README for the full package overview and licensing details.

## Options

`PenEditor` takes a required `editor` prop. This package has no create-function options. The optional peer `@input/pen-interop` is not required to mount the editor. HTML paste is a `defaultPreset()` battery (`html-clipboard`); a bare `createEditor()` host must pass `importers.html` to get it.

`readonly` defaults to `false`. The prop declines typing and pointer activation, sets `data-readonly` (match with `[data-readonly]`, not `[data-readonly="true"]`), and sets `aria-readonly="true"`. It does not stop `editor.apply`. `pen.ariaReadOnly` the facet only sets `aria-readonly`.

`engines.node` is `^22.22.2 || ^24.15.0 || >=26.0.0`. Required peers are `react` and `react-dom` (`^18` or `^19`).

## Documentation

The docs site (the `@input/pen-docs` package) covers this area on the Getting started page (`#/getting-started`) and the Server rendering page (`#/ssr`).

The public signatures of record are in `api-report.md` next to this package's source in the Pen repository. The docs site does not host a generated browsable reference.

## License

MIT © Input B.V. See [`LICENSE.md`](./LICENSE.md).
