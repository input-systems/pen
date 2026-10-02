# Vue example

Minimal Vite + Vue app that mounts Pen with `@input/pen`. `@input/pen-core` is the headless assembly point if you skip the preset.

This package is a workspace member (`examples/vue` in `pnpm-workspace.yaml`).

## Install

Pen has not been published. `pnpm add @input/pen-vue` 404s on the public registry. This app consumes the workspace packages (`workspace:*` in `package.json`).

From the repository root:

```bash
pnpm install
pnpm dev -- --filter=@input/pen-example-vue...
```

The post-publish consumer command, including peers, will be:

```bash
pnpm add @input/pen @input/pen-vue vue yjs
```

`vue` is a peer of `@input/pen-vue`. `yjs` is a peer of `@input/pen-yjs`, which arrives through `@input/pen`'s dependency on `@input/pen-core`, so every Pen install needs it.

## Mount

```vue
<script setup lang="ts">
import { createEditor } from "@input/pen";
import { PenEditor } from "@input/pen-vue";

const editor = createEditor();
</script>

<template>
  <PenEditor :editor="editor" />
</template>
```

That file is `src/App.vue`. Mount it from a browser entry (`src/main.ts` calls `createApp(App).mount("#app")`).

`PenEditor` adopts editor-field chrome by default. Pass `:chrome="false"` for the HOST6 unstyled path: an empty paragraph's inline surface lays out at zero width, so activation resolves the clicked _block_ rather than the inline span. The rule in this example's `index.html` is cosmetic. What Vue applies itself is in `STYLING.md` inside `@input/pen-vue`; the token catalog it defers to is `STYLING.md` inside `@input/pen-react`.

Client-only mount: Vue has no `"use client"` directive, so `@input/pen-vue` does not emit one — mount `PenEditor` in the browser, not during SSR.

## Run

Requires Node 22.22.2+, 24.15+, or 26+ and pnpm 10. The install commands above start Vite at `http://localhost:5176`.
