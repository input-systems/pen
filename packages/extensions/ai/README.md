# `@input/pen-ai`

AI extension, suggest mode, review state, planning/runtime helpers, proactive suggestions, inline autocomplete, agent skill packaging, the public tool surface, and the streaming apply path for Pen.

`@input/pen-ai` is headless. It does not ship a model adapter, transport, or UI. It does not execute skill files, talk to a model, or write those files to disk.

## Install

```bash
pnpm add @input/pen @input/pen-ai
```

Most app integrations also pair it with a renderer such as `@input/pen-react`.

## What It Provides

- `aiExtension(...)` to install Pen's headless AI runtime
- controller accessors such as `getAIController()` and `getAIReviewController()`
- suggest-mode and persistent-suggestion helpers
- planning, mutation-receipt, and review utilities used by richer AI workflows
- `./suggestions` — proactive writing suggestions (`aiSuggestionsExtension`)
- `./autocomplete` — low-latency inline completion (`autocompleteExtension`)
- `./skills` — `SKILL.md` packaging from tool and provider descriptors
- `./tools` — the canonical public tool surface (`getAIToolRuntime`, `executeAITool`)
- `./stream` — streaming apply path (`deltaStreamExtension`, `processStream`) and paced paint (`smoothStreamExtension`)

## Minimal Setup

```ts
import { createEditor } from "@input/pen";
import { aiExtension, getAIController } from "@input/pen-ai";

const editor = createEditor({
  extensions: [
    aiExtension({
      suggestMode: true,
      author: "Ada",
    }),
  ],
});

const ai = getAIController(editor);
```

Subpath imports:

```ts
import { aiSuggestionsExtension } from "@input/pen-ai/suggestions";
import { autocompleteExtension } from "@input/pen-ai/autocomplete";
import { listDefaultAISkills, renderSkillFiles } from "@input/pen-ai/skills";
import { getAIToolRuntime, executeAITool } from "@input/pen-ai/tools";
import {
  deltaStreamExtension,
  processStream,
  smoothStreamExtension,
} from "@input/pen-ai/stream";
```

## Integration Notes

- `@input/pen-ai` is headless. It installs runtime behavior and controller state, not a fixed UI.
- Suggest mode lets AI-authored edits flow through Pen's suggestion and review pipeline instead of immediately replacing document content.
- The host application still owns model adapters, auth, transport, and any product-specific orchestration.
- Outbound model calls go through the single `pen.aiEgress` facet in `@input/pen-core` (re-exported here). Suggestions and autocomplete share that same facet.
- Async request/response ranges: mint anchors when the request leaves, run the repair step on structural commits, and resolve when the response arrives. Do not map through `summaryLog.between`. A resolve of `null` is not deletion — check whether the block still exists (not-yet-seen) before dropping the range.
- Playground request planning (`buildPlaygroundRequestPlan` and related helpers) lives in the playground app, not this package.
- Mutating tools are default-deny until the host allowlists them. `@input/pen-ai/tools` does not replace `@input/pen-tools`.
- `@input/pen-ai/skills` is a packaging helper. Pen has no skill loader and never runs bundled scripts.
- `processStream` does not mint an undo `groupId`; if you omit `groupId`, each apply uses `{ origin: "ai" }` only.

## Typical Pairing

- `@input/pen-core` for editor authority and document mutation
- `@input/pen-react` for AI surfaces, prompts, and review UI
- `@input/pen-ai/suggestions` or `@input/pen-ai/autocomplete` for narrower inline flows
- `@input/pen-ai/tools` when an agent should call the public tool surface
- `@input/pen-ai/stream` when applying a `PenStreamPart` stream
- `@input/pen-tools` when AI actions should route through document tools

## Options

| Option        | Default       | Effect                                             |
| ------------- | ------------- | -------------------------------------------------- |
| `suggestMode` | `false`       | Stage AI edits for review instead of applying them |
| `author`      | `"assistant"` | Author label stored on AI-originated suggestions   |

`aiExtension()` requires the `tools`, `delta-stream`, and `undo` extensions (`dependencies` on the extension record). `defaultPreset()` installs those three.

### Suggestions (`./suggestions`)

`mode` defaults to `"balanced"`. `enabled` defaults to `true`. The host must supply `analyzer`. Numeric defaults below are the balanced preset; `cheap` and `aggressive` replace the whole set.

| Option                   | Default (`balanced`) | Effect                              |
| ------------------------ | -------------------- | ----------------------------------- |
| `enabled`                | `true`               | Master switch                       |
| `mode`                   | `"balanced"`         | `cheap` / `balanced` / `aggressive` |
| `debounceMs`             | `1200`               | Wait after edits before analysis    |
| `minChangedChars`        | `12`                 | Minimum local change                |
| `minStableMs`            | `800`                | Stability window                    |
| `cooldownMs`             | `10000`              | Per-block cooldown                  |
| `maxScopeChars`          | `320`                | Bound on text sent for analysis     |
| `maxSuggestionsPerScope` | `3`                  | Cap visible suggestions per scope   |
| `minConfidence`          | `0.8`                | Drop weaker candidates              |
| `cacheTtlMs`             | `300000`             | Analyzer cache TTL                  |
| `dismissMemoryMs`        | `600000`             | Remember dismissed suggestions      |
| `groupGapChars`          | `3`                  | Grouping gap                        |
| `scopeUnit`              | `"sentence"`         | `sentence` / `block` / `document`   |

`blockPolicy` takes `allowedBlockTypes`, `deniedBlockTypes`, and an optional `isBlockAllowed(block)` veto. With `scopeUnit: "document"` one request covers every eligible block; the analyzer receives the blocks joined by blank lines and each candidate is anchored in the block its `originalText` matches.

### Autocomplete (`./autocomplete`)

| Option                | Default                                  | Effect                                                      |
| --------------------- | ---------------------------------------- | ----------------------------------------------------------- |
| `debounceMs`          | `DEFAULT_DEBOUNCE_MS` (`100`)            | Delay before requesting a hint                              |
| `prefetchAfterAccept` | `DEFAULT_PREFETCH_AFTER_ACCEPT` (`true`) | Prefetch the next hint after accept                         |
| `paragraphGap`        | `"separator"`                            | How a blank line between prose paragraphs lands (see below) |

`autocompleteExtension()` accepts an empty config.

`paragraphGap` decides what a blank line between two prose paragraphs in a completion becomes. `"separator"` drops it: the paragraphs land as adjacent blocks and the host's paragraph margin is the gap. `"empty-block"` keeps it as an empty paragraph block, for documents whose paragraphs carry no margin and express the gap as a block of their own (email). An implicit paragraph split during a continuation takes the same gap. Independent of the setting, a single leading newline in a prose completion right after a closed line (`Best,`, `Thanks for your time.`) starts a new block instead of being dropped as a model artifact; mid-sentence it is still dropped.

### Skills (`./skills`)

This subpath has no options. `listDefaultAISkills` always includes the document-agent skill and adds the autocomplete-context skill only when `autocompleteProviders` is supplied.

### Tools (`./tools`)

| Constant                         | Default | What it caps            |
| -------------------------------- | ------- | ----------------------- |
| `AI_TOOL_MAX_CALLS_PER_TURN`     | 20      | Tool calls per turn     |
| `AI_TOOL_MAX_OPS_PER_CALL`       | 32      | Ops per mutating call   |
| `AI_TOOL_MAX_TOTAL_OPS_PER_TURN` | 128     | Total ops per turn      |
| `AI_AGENTIC_MAX_STEPS_DEFAULT`   | 10      | Agentic loop `maxSteps` |

`createAIToolTurn` takes `allowedMutatingTools` (default deny), optional `confirm`, and optional `groupId`.

### Stream (`./stream`)

#### `deltaStreamExtension`

| Option          | Default | Effect                                        |
| --------------- | ------- | --------------------------------------------- |
| `batchInterval` | `50`    | Flush interval in milliseconds for the target |

#### `smoothStreamExtension`

Paces how streamed text appears without buffering the document: appends land immediately and `omitFromRender` holds back paint until a library-owned ticker advances a per-block frontier (ST7–ST9). Opt-in. Headless-safe (`setInterval`; no `window` / `matchMedia`). Reduced motion is the host's `enabled` / `setEnabled(false)` call.

| Option        | Default                     | Effect                                                                             |
| ------------- | --------------------------- | ---------------------------------------------------------------------------------- |
| `intervalMs`  | `20`                        | Gap between reveal ticks                                                           |
| `granularity` | `"word"`                    | Unit released per tick (`"word"` or `"character"`)                                 |
| `drainMs`     | `1000`                      | Catch-up time constant; a burst drains fast, the tail settles to one unit per tick |
| `enabled`     | `true`                      | When false, nothing is withheld                                                    |
| `shouldPace`  | `event.source === "stream"` | Whether a commit's inserted text should be paced                                   |

`getSmoothStreamController(editor)` reads `smoothStreamControllerFacet` and returns `null` when the extension is not installed. `subscribe` emits `SmoothStreamStatus` `{ isRevealing, hiddenCharCount, enabled }`; `setEnabled` notifies on a real value change even when nothing is withheld.

#### `processStream`

| Option                 | Default | Effect                                                                 |
| ---------------------- | ------- | ---------------------------------------------------------------------- |
| `onPart`               | none    | Called with each `PenStreamPart`                                       |
| `signal`               | none    | Abort the stream                                                       |
| `protocolVersion`      | unset   | Must equal `PEN_STREAM_PROTOCOL_VERSION` (`1`) when sent; omit to skip |
| `groupId`              | unset   | Undo group for every apply in this stream                              |
| `allowedMutatingTools` | `[]`    | Mutating tools (and equivalent structural parts) this stream may run   |

## Facets and commands

`aiExtension` contributes `beforeApplyFacet` (`pen.beforeApply`) when suggest mode is on, plus the AI controller facets read by `getAIController` and `getAIReviewController`. Commands: `ai:rewrite`, `ai:continue`, `ai:summarize`, `ai:fix-grammar`, `ai:simplify`, `ai:expand`, `ai:translate`. Key bindings cover inline undo/redo. Requires `tools`, `delta-stream`, and `undo`.

`aiSuggestionsExtension` contributes the suggestions controller facet (`aiSuggestionsControllerFacet` / `AI_SUGGESTIONS_CONTROLLER_SLOT`). It contributes no commands. Requires no other extensions. The host must provide `analyzer`.

`autocompleteExtension` contributes the autocomplete controller facet (`aiAutocompleteControllerFacet` / `AI_AUTOCOMPLETE_CONTROLLER_SLOT`). It contributes no commands. Requires no other extensions. It shares the inline-completion controller with the package root when both are installed.

`./skills` and `./tools` contribute no facets and no commands. `./stream` contributes `smoothStreamControllerFacet` when `smoothStreamExtension()` is installed (`getSmoothStreamController`). Tools depend on the tools tool runtime that `defaultPreset()` installs. `processStream` looks up that runtime when the stream contains tool parts, and works without it when those parts are absent.

## Documentation

The docs site (the `@input/pen-docs` package) covers this area on the AI features page (`#/ai`).

The public signatures of record are in `api-report.md` next to this package's source in the Pen repository. The docs site does not host a generated browsable reference.

## License

MIT © Input B.V. See [`LICENSE.md`](./LICENSE.md).
