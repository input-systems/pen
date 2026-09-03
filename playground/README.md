# Pen playground

A small, complete Pen app: an editor in the middle, an AI agent on the left, and
a live view of the document on the right.

It is meant to be read as much as run. Every file is short and does one thing,
and there is no state management library, CSS framework, or component kit in the
way — just React, plain CSS, and Pen.

## Run it

```bash
pnpm install
pnpm dev
```

Open http://localhost:5173. The agent works immediately: with no API key a
scripted model answers, so you can see the whole path without signing up for
anything. `pnpm dev` also watches the library packages and starts docs plus
the examples on fixed ports (5174–5177). If 5173 is taken, Vite exits instead
of hopping. Filter to this app and its watchers with
`pnpm dev -- --filter=@input/pen-playground...`.

## Host it

The same app ships as a Cloudflare Worker: static UI, `POST /api/chat`, and
one Durable Object per Yjs room at `/collaboration/<room>`. Live at
[pen-playground.input.so](https://pen-playground.input.so/).
Build the workspace packages first, then:

```bash
pnpm --filter @input/pen-playground... run build
pnpm --dir playground run deploy
```

CI does that on push to `main` once `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` are set as repository secrets. Do not put a shared
Anthropic key on the Worker; the scripted model is enough, and a visitor can
still paste their own key in the agent bar.

For real answers locally, click the Anthropic mark in the agent bar and paste
an API key. It stays in this browser. Or write it to `playground/.env.local`
and restart:

```bash
echo 'ANTHROPIC_API_KEY=sk-ant-...' > playground/.env.local
```

While hacking on Pen itself, `pnpm dev` rebuilds library `dist/` as you
edit and reloads the playground on the new build.

## What is where

Each folder is one concern. Components render; `use*.ts` hooks own state and
subscriptions; the remaining `.ts` files are plain functions you can read
without React in your head.

```
src/
  main.tsx             mounts the app and adopts Pen's review stylesheet
  App.tsx              three panes over one editor
  editor/              the middle column
    penEditor.ts         createEditor with this app's extensions
    usePenEditor.ts      owns the one editor instance; recreates it per room
    starterDocument.ts   seeds a fresh document with a handful of ops
    EditorPane.tsx       toolbar over the Pen surface
    FormatToolbar.tsx    marks, block type, undo, and the top-right buttons
    SlashMenu.tsx        the / menu, built from the schema
    ImageBlock.tsx       the image renderer, plus a picker for an empty one
    assets.ts            where image bytes go, and why blob: URLs are allowed
    InlinePrompt.tsx     ⌘J: shortcut hook, positioner, composer
    ReviewSurface.tsx    the bar that accepts or rejects staged suggestions
    reviewSuggestions.ts names a suggestion: block, action, preview
  chat/                the left column
    useChat.ts           sends prompts, keeps a receipt per turn
    turnOutcome.ts       turns a finished generation into one line
    useSmoothStream.ts   how much streamed text is still catching up
    Chat*.tsx            bar, empty state, transcript, composer
    ApiKeyModal.tsx      the browser-saved Anthropic key
  inspector/           the right-hand sheet
    useDocumentSnapshot.ts  reads blocks, revision, selection off the editor
    InspectorSheet.tsx, BlockTree.tsx
  collaboration/       optional live rooms
    session.ts           room in the URL, user in session storage, y-websocket
    useCollaboration.ts  join, leave, and the invitation modal
    CollaborateModal.tsx
  ai/
    penModel.ts          the ModelAdapter: POST /api/chat, read ndjson back
    apiKey.ts            the browser-saved key
  ui/                  the interface primitives (see below)
  styles/tokens.css    every colour, size, and radius in the app
server/                runs inside the Vite dev server
  aiPlugin.ts          mounts /api/chat
  chatRoute.ts         Node request in, ndjson lines out
  chatEvents.ts        pick scripted or Anthropic; encode lines; catch errors
  anthropicModel.ts    real model
  scriptedModel.ts     offline model, used when there is no API key
  protocol.ts          the events that cross the wire, and how a line is written
  collaborationPlugin.ts  Yjs websocket at /collaboration
  collaborationRoute.ts   room name in the /collaboration path
worker/                the same app on Cloudflare
  index.ts             fetch: assets, /api/chat, rooms
  chat.ts              Fetch request in, the same ndjson lines out
  yjsRoom.ts           one Durable Object per y-websocket room
```

## The UI layer

`src/ui/` holds ten primitives — button, tile, select, tooltip, badge, scroll
area, tabs, sheet, modal, toggle — plus the icon set, the 3×3 agent loader,
three small helpers (`keepCaret`, `useEscapeKey`, `shortcut`), and one
stylesheet. They are simplified ports of
[Input](https://www.input.so)'s design system, which is where the look comes from:
quiet surfaces, hairline borders, pill buttons whose hover fill grows into place,
tooltips that carry the key binding, cards with a shadow instead of a border, and
a status line that shimmers while the agent works.

The compound shapes are Input's, because they are what makes the call sites
short: `Button.Icon` for a square icon button, `Button.Tooltip` to label one,
`Tile.Button` for a card you can click.

Simplified means genuinely smaller. Input's button carries kinds, shapes, loading
states, and a keybinding registry across 620 lines; this one is 90 and drops the
registry. Its tooltip is a Radix popper with collision handling and lazy mounting
because it renders thousands in a list; this one is a span shown by CSS. Its
icons animate through Framer Motion; these use CSS keyframes.

Each file names what it dropped and why, so it is clear which parts were
essential and which were scale.

## Three things worth understanding

**One editor, three views.** `App.tsx` creates a single `Editor` and hands it to
all three panes. The chat does not send text to the editor and the inspector does
not receive copies of the document — they both talk to the editor directly, which
is why they never disagree.

**Every change is a document operation.** Typing, the slash menu, undo, and the
agent all end up in `editor.apply(ops)`. `editor/starterDocument.ts` is the
shortest example: it seeds the document with a handful of ops. Open the inspector
and watch the revision counter move as you type.

**The agent answers in document content, not chat prose.** This is the part
that surprises people. Pen routes each prompt — rewrite the selection, continue
at the cursor, or run a tool loop — and the answer arrives either as text
streamed into a block or as tool calls that Pen applies. Nothing comes back for
the sidebar to print, so the sidebar keeps a receipt of what changed and names
the route Pen chose. `server/scriptedModel.ts` shows both shapes: it calls a
document tool when Pen offers one, and streams clause-sized bursts when it
does not (clause-sized bursts make the paced paint visible; a word-at-a-time
script would hide it).

The same path is available in the document. `⌘J` / `Ctrl+J` (or the wand in
the toolbar) opens Input's inline prompt on the current block.
`editor/InlinePromptPositioner.tsx` inserts that box in the document flow
before the block — so a replacement paints below it, not above — and
`InlinePromptComposer.tsx` is the chrome: the same send arrow as the agent
composer, Discard / Accept while a review is pending. Undo after Accept
reopens that review without taking focus, so Redo still works.

**Smooth streaming** is a paint, not a write. Streamed text is already in the
document; an inline decoration withholds what is past a per-block frontier and
reveals it at reading speed. It is always on. While paint is behind the
document, the bar says how much is catching up.

That path is **direct writes only** (`source: "stream"`). Review mode stages
edits instead of streaming them into the block. Turn Review off, or open
`/?mutation=direct`, then ask to continue a paragraph. Reduced motion starts
smooth streaming off and stays live if the OS preference changes.
`window.penPlayground.smoothStream` is the same controller the e2e spec drives.

## Making it yours

- **Restyle it** — edit `styles/tokens.css`; every primitive and every feature
  stylesheet reads from it. Pen's React primitives ship no styles of their own;
  they expose state as `data-*` attributes, and `editor/editor.css` hangs plain
  CSS off those.
- **Add a block type** — `editor/penEditor.ts` uses `defaultPreset()`, which
  supplies the default schema; pass your own schema to `createEditor` to extend
  it. The toolbar's block-type dropdown and the slash menu both build themselves
  from the schema, so a new block type shows up in each with no further wiring.
- **Add an extension** — the `extensions` array in `editor/penEditor.ts`. Search
  is one package away. Multiplayer is already wired through the collaborate
  button in the top bar.
- **Use a different model** — `ai/penModel.ts` is a `ModelAdapter`: an async
  generator of events. Point it anywhere, or drop the server and call a provider
  from the browser.

## Images

Paste an image, drop one on the document, or pick Image from the slash menu and
click the placeholder. All three go through the one `AssetProvider` in
`editor/assets.ts`, which is the whole contract: store bytes, hand back a URL.

That provider is `memoryAssets()` from `@input/pen-assets`, a test double that
keeps bytes in the tab and returns a `blob:` URL. It needs no server, and it is
honest about what it is not: images do not survive a reload, and a collaborator
in a shared room sees a broken image, because a `blob:` URL only means something
in the tab that made it. Swap in a provider that uploads to real storage and
both problems go away — nothing else changes.

Three things that upload path teaches, all worth knowing before you write your
own provider:

- **Pen resolves every URL it renders against a policy.** The default admits
  `http(s):` and `data:` images, so the store's `blob:` URLs need
  `blobImageUrlExtension` in `editor/assets.ts` or they are dropped at render
  time and the block comes out blank.
- **Failure is a diagnostic, not silence.** `maxSize` is enforced before
  `upload`, and an oversize file or a provider error emits
  `asset-upload-failed` and inserts no block.
- **Deleting an asset is the host's job.** Pen never calls
  `AssetProvider.delete`, so a deleted image here keeps its bytes until the tab
  closes.

## Not in here

Comments and tables beyond the basics. This app stays small on purpose; the
examples and package tests cover the rest.
