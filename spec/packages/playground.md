# @input/pen-playground

## Purpose

Workspace package in the Pen monorepo.

## Public Role

The reference app: the shortest honest example of embedding Pen. Someone who has never seen this repository should be able to clone it, run `pnpm dev`, and read the whole app in one sitting. That command binds this app to `http://localhost:5173` with `strictPort`, so a collision exits instead of hopping; docs and the examples take 5174–5177. Library packages run `tsup --watch` beside it so a source edit rebuilds `dist/` and reloads this app, without a manual rebuild or restart.

It stays narrow on purpose. A surface is added here only when a first-time embedder needs to see it — editor, AI agent, document inspector, optional collaboration. Package tests and the examples cover the rest.

## Key Exports / Entrypoints

- Export map: Package root only.
- Workspace scripts: `build`, `dev`, `dev:e2e`, `deploy`, `test`, `typecheck`, `lint`
- Client entry: `src/main.tsx` mounts `src/App.tsx`, a three-pane shell over one `Editor`.
- Server entry: `server/aiPlugin.ts` and `server/collaborationPlugin.ts`, Vite middleware that serves `POST /api/chat` and the Yjs websocket at `/collaboration`. There is no second process to start.
- Hosted entry: `worker/index.ts` is the Cloudflare Worker. It serves the Vite `dist/` as a single-page app, the same `POST /api/chat`, and the same `/collaboration/<room>` y-websocket protocol on a Durable Object per room (`worker/yjsRoom.ts`). Live at `https://pen-playground.input.so/`. `pnpm --dir playground run deploy` (and the Playground ship job on `main`) publishes it.

## Dependencies And Boundaries

- Runtime dependencies: `@input/pen-ai`, `@input/pen-assets`, `@input/pen-core`, `@input/pen-dom`, `@input/pen-yjs`, `@input/pen-autoformat`, `@input/pen-multiplayer`, `@input/pen`, `@input/pen-react`, `@input/pen-types`, `@y/websocket-server`, `lib0`, `react`, `react-dom`, `ws`, `y-protocols`, `yjs`, `y-websocket`
- Peer dependencies: No peer dependencies declared.
- Boundary: This is a private app for development, experimentation, and demos.
- It resolves Pen from built packages rather than source aliases, so it fails the way a real consumer would when an export map or `dist` build is wrong. Vite excludes those workspace packages from dependency pre-bundling so a watch rebuild is visible without restarting the dev server.

## Data Flow / Runtime Model

One editor, three panes, no mirrored state. The chat sidebar and the inspector both read and write the same `Editor` instance, which is why they cannot disagree with the document.

- `src/editor/usePenEditor.ts` owns the editor's lifecycle and seeds the starter document with a single `apply` at `origin: "system"`. It also assigns `window.penPlayground` as `{ editor, aiController, smoothStream }` so Playwright — and a human in the console — can reach the live instance, the AI controller, and the paced-reveal controller.
- `src/editor/InlinePrompt.tsx` is the inline AI box from Input's composer: `⌘J` / `Ctrl+J` (`useAskAiShortcut.ts`) or the toolbar wand opens it on the current block. `target: "auto"` is the interesting bit — the library selection trigger only opens on a highlight; a caret is enough here. `InlinePromptPositioner.tsx` inserts the box in the document flow before the target block (not overlaid), and `InlinePromptComposer.tsx` is Input's chrome: history, textarea, send arrow, Discard / Accept while a review is pending. `editor.css` hangs the popover look off the `data-pen-ai-inline-session-*` attributes.
- `src/chat/useChat.ts` sends prompts through `runPrompt` and keeps a receipt of each turn. The agent's answer arrives as document content or tool calls, never as chat prose, so the transcript records what changed rather than replaying a reply; `turnOutcome.ts` is the pure function that writes that one line from the `GenerationState`.
- `src/ai/penModel.ts` is the `ModelAdapter`: it posts to `/api/chat` and translates newline-delimited JSON back into `ModelStreamEvent`s. A browser-saved Anthropic key from the agent bar is sent as `x-anthropic-api-key` and wins over the server env key for that request.
- `server/chatEvents.ts` picks a backend per request — Anthropic when a request header or `ANTHROPIC_API_KEY` supplies a key, `server/scriptedModel.ts` when neither does — and turns the events into newline-delimited JSON, so a fresh clone with no key still streams. `server/chatRoute.ts` (Node) and `worker/chat.ts` (Fetch) are transports over that one generator.
- `src/collaboration/` joins an optional Yjs room from the toolbar; the editor is recreated with `multiplayerExtension` when a session exists. A `?room=` link without a stored display name opens the join card rather than loading a private document under a shared URL. `EditorPane` keys `Pen.Editor.Root` to `editor.internals.viewId`, because a field editor is bound to one instance for its lifetime and a swapped-in editor would otherwise be driven by the previous one's DOM.
- Joining waits for the room before writing anything. Every editor is born with one empty paragraph, and the CRDT merges it like any other insert, so `usePenEditor` remembers that block and deletes it once a room with content arrives — otherwise each join would leave a blank block behind.
- `src/editor/penEditor.ts` assembles the editor and reads two query params so AI write posture can be compared on one document without a rebuild: `?mutation=direct|suggestions`, and `?editStreaming=preview|atomic`. Durable edits always go through `edit_document`.
- `src/editor/assets.ts` holds the one `AssetProvider`, `memoryAssets()` from `@input/pen-assets` with a 5 MB `maxSize`. `EditorPane` passes it as the `assets` prop on `Pen.Editor.Root`, which is the wiring that matters: `CreateEditorOptions.assets` exists on the options type but `createEditor` does not read it (recorded in `packages/core.md`), so paste and drop of image files stay declined until the renderer prop is set. The same file exports `blobImageUrlExtension`, which wraps the default policy through `urlPolicyExtension` to admit `blob:` URLs in the `image` context and delegates every other value — without it the store's own object URLs are dropped at render time and an uploaded image renders as an empty box. Images therefore do not survive a reload and are broken for collaborators in a shared room; that is a property of the test-double store, not of the wiring.
- `src/editor/ImageBlock.tsx` overrides the `image` renderer through the `renderers` prop. A block with a non-empty `src` is handed back to Pen's `ImageRenderer` untouched; an empty one renders a file picker and uploads through the same `uploadImageFiles` path paste and drop use, so an image block picked from the slash menu has a way to be filled instead of rendering as a broken image. Upload failure leaves an `asset-upload-failed` diagnostic and the block empty.
- `src/editor/ReviewSurface.tsx` wraps the editor with the AI review bar, which is how staged suggestions are accepted or rejected when the mutation posture is `suggestions`. `reviewSuggestions.ts` holds the pure readers that order suggestions by document position and describe each one against the current block.
- `src/inspector/useDocumentSnapshot.ts` reads block tree, generation, and selection back out of the editor on `commit` and `selectionChange`; nothing in the app keeps a second copy.
- `src/ui/` holds the interface primitives as simplified ports of Input's design system, in plain CSS over `src/styles/tokens.css`. They are presentation only: no primitive imports from `editor/`, `chat/`, or `inspector/`, and none of them knows Pen exists. Three helpers live beside them because more than one primitive or feature needs them: `keepCaret` (cancel mousedown so the editor keeps focus), `useEscapeKey`, and `shortcut.ts` (platform modifier and `Shift-Mod-z` → `⇧⌘Z`). The agent bar's new-chat and API-key buttons are `Button.Icon` plus `Icon.Plus` and `Icon.Anthropic`.

Important rules:

- The wire format between `penModel.ts` and the server is a named subset of `ModelStreamEvent` (`server/protocol.ts`), not a shape of its own. A chat needs four event types; keeping the subset explicit is what makes the file readable.
- The scripted model answers in whichever form Pen asked for: tools in the request mean structural edits, no tools mean prose for a block. It exists to make the request contract visible, not to simulate a model.
- The UI layer stays dependency-free. A ported primitive that would need Radix, framer-motion, or an icon package is either simplified until it does not, or left out.
- Prefer deleting a feature here over explaining it.

## Integration Notes

- Path in workspace: `playground`
- Spec path mirrors workspace path: `packages/playground.md`
- This package is private to the workspace and exists to support docs, demos, or local development flows.
- `pnpm test:e2e` drives `playground/e2e` against `dev:e2e` on port 4173. Besides the boot smoke, that suite covers the gesture paths unit tests cannot: IOP7/IOP8 mention copy/paste through the real clipboard (Chromium; WebKit and Firefox skip because Playwright cannot grant clipboard-read there), and N2/G5/HOST9 ArrowDown from a text caret onto an image (`BlockSelection` plus focus-sink parking) or a table (collapsed text caret). SCH1 stays a schema-registration unit test — it is not a user gesture.
- `playground/README.md` is the contributor-facing tour and should stay true to the file layout.
- Hosted rooms share a document for as long as the Durable Object keeps it. There is no auth on the public Worker; a peer who knows the room name can write.

## Current Maturity / Intended Usage

Private workspace app.

## Non-goals

Do not treat playground-only glue as part of the public runtime contract.

Additional non-goals:

- Not a feature showcase. Coverage of every extension lives in package tests.
- Not a chat product. The document is the output surface; the sidebar is a receipt.
- No abstraction that exists only to look professional. A reader should be able to follow every hop from keystroke to document without a diagram.
