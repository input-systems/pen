# Vanilla example

Minimal Vite app that mounts Pen with `@input/pen` and `@input/pen-dom`. `@input/pen-core` is the headless assembly point if you skip the preset.

This package is a workspace member (`examples/vanilla` in `pnpm-workspace.yaml`).

## Install

Pen has not been published. `pnpm add @input/pen-dom` 404s on the public registry. This app consumes the workspace packages (`workspace:*` in `package.json`).

From the repository root:

```bash
pnpm install
pnpm dev -- --filter=@input/pen-example-vanilla...
```

The post-publish consumer command will be:

```bash
pnpm add @input/pen @input/pen-dom yjs
```

`@input/pen-dom` has no extra peer dependencies. `yjs` is a peer of `@input/pen-yjs`, which arrives through `@input/pen`'s dependency on `@input/pen-core`, so every Pen install needs it.

## Mount

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

That file is `src/main.ts`. `mountEditor` is the same composition `@input/pen-react` and `@input/pen-vue` already assemble: `FieldEditorImpl`, the editor-root shell, and inline-content surfaces. Construct it in the browser, not during SSR.

`mountEditor` adopts editor-field chrome by default. Pass `{ chrome: false }` for the HOST6 unstyled path: an empty paragraph's inline surface lays out at zero width, so activation resolves the clicked _block_ rather than the inline span. The rule in this example's `index.html` is cosmetic. Tokens the `@input/pen-dom` overlays read are catalogued in `STYLING.md`, which ships inside the `@input/pen-react` package.

Client-only mount: `@input/pen-dom` is a browser module — construct `FieldEditorImpl` in the browser, not during SSR.

## Run

Requires Node 22.22.2+, 24.15+, or 26+ and pnpm 10. The install commands above start Vite at `http://localhost:5177`.
