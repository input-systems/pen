# @input/pen-test

## Purpose

Headless testing utilities for Pen

## Public Role

Support development, testing, benchmarking, or local integration workflows around Pen.

## Key Exports / Entrypoints

- Export map: `.`
- Editor harness: `createTestEditor()`, `createTestDocument()`, `populateYDoc()`
- Collaboration harness: `createTestCollaboration()`, `createTwoPeerHarness()`, `runBothInterleavings()`, plus two-peer inspection helpers such as `visibleText()` and `listBlockIds()`
- Assertions: `assertDocEquals()`, `assertPeerEditsSurvive()`, `assertDocumentRoots()`
- Fixtures: `encodeFixtureUpdate()`, `normalizeDocumentForSnapshot()`, `DEFAULT_PEN_ROOTS`, `PenFixtureError`
- AI doubles: `createModelDouble()` and its types, used by the AI and transport suites
- Scale fixtures: `generateMixedBlockSpecs()`, `mixedFixtureOps()`, `mixedFixtureIdentity()`, `mixedFixtureTargets()`, `mixedBlockId()`, and `MIXED_FIXTURE_SIZES` (1k, 5k, 10k, 50k root blocks) build a deterministic mixed document — headings, paragraphs, bullet, numbered, and check list runs, quotes, code, open toggles with a `parentId` child, dividers, one table per 1,000 blocks, and bold marks — whose counts `mixedFixtureIdentity()` states by arithmetic (SCALE1)
- Scan probe: `createScanProbe(editor)` (test-only) counts document reads that scale with size — `blockOrder` and `blocks` reads and iterations, full `Y.Text` reads of that editor's document, `documentState.blockOrder` element reads, and `allBlocks()` walks — with a `selfTest()` that throws when a counter is miswired and a `dispose()` that restores every patch; the headless SCALE2 and SCALE6 counts read through it
- `simulateTyping()` / `simulateKeypress()` are methods on `TestEditor` rather than barrel exports
- Workspace scripts: `build`, `clean`, `dev`, `lint`, `test`, `typecheck`

## Dependencies And Boundaries

- Runtime dependencies: `@input/pen-core`, `@input/pen-yjs`, `@input/pen-interop`, `@input/pen-schema`, `@input/pen-types`, `yjs`
- Peer dependencies: No peer dependencies declared.
- Boundary: Tooling packages serve the workspace and advanced integrators more than standard runtime embedding.

## Data Flow / Runtime Model

Tooling packages in Pen should stay package-first and explicit about ownership. Use these packages in development flows, tests, or benchmarks.

`@input/pen-test` provides deterministic Yjs fixtures and opt-in contract helpers for host apps and Pen packages. Fixture helpers generate stable updates, state vectors, and normalized snapshots without relying on product data. Contract helpers exercise CRDT state-vector satisfaction, headless editor creation, and export behavior while leaving the choice of test runner to the host.

## Integration Notes

- Path in workspace: `packages/tooling/test`
- Spec path mirrors workspace path: `packages/tooling/test.md`
- This package is part of the current package surface and should stay aligned with the headless runtime architecture.
- Use `createDeterministicYDocFixture()` when a test needs a stable Yjs update or normalized root snapshot.
- Use `runCRDTStateVectorContract()`, `runHeadlessEditorContract()`, and `runExportContract()` as opt-in smoke contracts for host integrations.

## Current Maturity / Intended Usage

Workspace package at version `0.2.14`; intended usage is current-state but still evolving.

## Non-goals

- Do not present tooling packages as the editor runtime itself.
- Do not encode host-product fixture data in Pen test helpers.
- Do not require host apps to use Pen's test runner.
