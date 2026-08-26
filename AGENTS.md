# AGENTS.md

## Scope

These instructions apply to the whole Pen monorepo and are written for AI coding agents (Cursor agents and Agent mode in the Cursor IDE). Human contributors follow the same conventions where noted.

Pen is a headless, extension-first, block-native rich text editor SDK built on a Yjs CRDT document, with first-class AI co-authoring. It is licensed under the MIT License (`LICENSE.md`).

## Architecture

The monorepo is layered; dependencies point strictly downward:

- `packages/types` (`@input/pen-types`) — shared contracts: types, constants, guards. Target state is types-only (see `spec/rules/api.md` API3); today it still carries schema builders and the registry.
- `packages/crdt/yjs` (`@input/pen-crdt-yjs`) — the Yjs adapter: document shape (`blockOrder`, `blocks`, `apps`, `metadata`), transactions, update handling, undo integration.
- `packages/core` (`@input/pen-core`) — the editor runtime: `editor.apply(ops, options)` pipeline, validation, normalization, selection, extension manager, events. Runtime authority for everything.
- `packages/schema/default` — the default block/inline schema set.
- `packages/rendering/dom` (`@input/pen-dom`) — the framework-free DOM engine: field editors (EditContext + contenteditable backends), selection bridge, key handling, clipboard/transfer, reconciliation, overlays. The hardest code in the repo lives here.
- `packages/rendering/react` / `packages/rendering/vue` — thin framework bindings over pen-dom. Behavior belongs in pen-dom or core, never here.
- `packages/extensions/*` — undo, history, search, input-rules, shortcuts, multiplayer, document-ops, `@input/pen-ai` (subpaths: suggestions, autocomplete, skills, tools, stream), and `@input/pen-interop` (subpaths: html, markdown, json, xml).
- `packages/presets/default` — batteries-included assembly of core + default schema + recommended extensions.
- `packages/shared/*`, `packages/transports/*` (direct, sse), `packages/tooling/*` (test, bench, assets-memory), `packages/docs`, `playground/` (reference app; `pnpm test:e2e` runs against it).

## Specs Are The Contract

`spec/README.md` is the index. `spec/` describes shipped behavior only — no roadmap. Load the matching `spec/rules/` document and package spec before editing a surface. Normative rules carry stable IDs (`A1`, `S4`, `SEC1`, `API6`, …); cite them in PR descriptions and test names. When implementation proves a rule wrong or untestable, amend the spec in the same PR. Silent divergence is a defect.

## Core Principles

- `DocumentOp[]` is the mutation currency; `editor.apply(ops, { origin })` is the only durable write path. Never write `Y.Text`/`Y.Map` directly or call `adapter.transact` outside core. Streaming goes through `editor.openTextStream` / `TextStreamWriter` (`@input/pen-ai/stream`).
- Set operation origins intentionally (`user`, `ai`, `collaborator`, `input-rule`, structured origins with `groupId`/`requestId`); undo, suggestions, and diagnostics depend on them.
- Keep Pen headless: core and extensions must work without a DOM (`createHeadlessEditor`). Only `@input/pen-dom` may touch browser globals.
- Prefer non-fatal behavior in runtime paths: drop invalid input with a `diagnostic` event rather than throwing from hooks, observers, or extension code.
- Normalization is incremental and idempotent; repeated passes must not produce new changes.
- The `\u200B` empty-block sentinel is removed from storage (`spec/rules/empty-blocks.md` EM1–EM8). Do not add new code that tests for it. The two-seam confinement in `spec/rules/selection.md` §2 was the interim v2 position and is retired (I11 → I14).
- Selection code is under redesign; do not add `requestAnimationFrame`/`setTimeout` retries, suppression flags, or intent counters to selection paths (`spec/rules/selection.md` S4). If a selection bug cannot be fixed without one, stop and surface it.
- Follow `.cursor/rules/*.mdc` for import style (extensionless), extension resilience, and headless React primitive conventions.

## Commands

From the repository root (pnpm + turbo):

- `pnpm build` / `pnpm typecheck` / `pnpm test` — all workspaces via turbo.
- `pnpm --filter @input/pen-core test` (or any package name) — scoped runs; prefer these while iterating.
- `pnpm test:e2e` — Playwright suite.
- `pnpm lint` — Prettier format check plus turbo lint.
- `pnpm changeset` — required for any change to a published package (see Releases).

For substantive changes run `pnpm build`, `pnpm typecheck`, and `pnpm test` before finishing (`.cursor/rules/pen-security-quality-gates.mdc`). Scale scope to the change: a one-package fix needs that package's checks plus its dependents' tests, not the world.

## Testing Guidance

- Vitest, `.test.ts`, colocated per package (`src/__tests__/` or alongside sources — match the package you are in).
- Test headlessly by default: core logic, ops, schema, extension behavior, and anything expressible without a DOM. jsdom cannot represent real selection, IME, or geometry — do not write jsdom tests that pretend to cover those; that is what the conformance package (`spec/rules/reliability.md`) is for.
- Perf-sensitive paths have benchmark expectations in `packages/tooling/bench`; do not regress them.
- Deterministic fixtures live in `packages/tooling/test`; reuse them instead of hand-rolling documents.

## Git Conventions

- Local agents: never create or switch branches; stay on the user's checkout.
- Commit messages: imperative sentence naming the component and objective, matching repo history (`Refactor editor extension handling and improve test structure`, `Enhance inline atom handling and DOM reconciliation`). No conventional-commit prefixes.
- Only commit when explicitly asked.

## Releases

- Changesets drive versioning (`pnpm changeset`, `pnpm version-packages`, `pnpm release`). Any PR that changes a published package's behavior or API includes a changeset. The train is `0.x`; breaking is `minor`, additive is `patch`, and `major` is rejected until 1.0. The first published train is `0.1.0`.
- Published packages ship dual ESM/CJS with `exports` maps, `files`, and `sideEffects: false`; keep manifests consistent (`sync-package-metadata.mjs` exists for shared fields).

## Agent Skills And Reviewers

- `.agents/skills/pen-deslop` — audit for AI-generated slop patterns specific to this codebase.
- `.agents/skills/ligne-blanche` — boundary/structural integrity review for changes.
- `.cursor/skills/investigate` — root-cause investigation workflow; use before fixing non-trivial bugs.
- `.cursor/agents/spec-reviewer.md` — reviews a diff against `spec/`, `spec/rules/` rule IDs, and `.cursor/rules`; use proactively after implementing features or refactors.
