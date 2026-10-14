# `@input/pen-test`

Headless testing utilities for Pen.

These helpers are for package and app tests. They do not bootstrap a production editor.

## Install

```bash
pnpm add -D @input/pen-test
```

## What It Provides

- `createTestEditor()` for a Yjs-backed editor harness with the default schema
- `assertDocEquals()` for document-shape assertions
- `assertPeerEditsSurvive()` so two-peer tests cannot pass on mutual loss
- `createTestCollaboration()` for two-editor sync tests
- `createDeterministicYDocFixture()` for stable Yjs updates and snapshots
- `runCRDTStateVectorContract()`, `runHeadlessEditorContract()`, and `runExportContract()` for opt-in package/app contracts
- `simulateTyping()` and `simulateKeypress()` helpers for editor interactions

## Minimal Setup

```ts
import { assertDocEquals, createTestEditor } from "@input/pen-test";

const editor = createTestEditor({
  blocks: [{ type: "paragraph", content: "Hello" }],
});

editor.simulateTyping(" world");

assertDocEquals(editor, [{ type: "paragraph", content: "Hello world" }]);
```

## Collaboration Harness

```ts
import {
  assertDocEquals,
  assertPeerEditsSurvive,
  createTestCollaboration,
} from "@input/pen-test";

const collab = createTestCollaboration({
  blocks: [{ id: "p1", type: "paragraph", content: "Hello" }],
});

collab.editorA.apply(
  [{ type: "splice-text", blockId: "p1", from: 5, to: 5, insert: " A" }],
  { origin: "user" },
);
collab.editorB.apply(
  [{ type: "splice-text", blockId: "p1", from: 5, to: 5, insert: " B" }],
  { origin: "user" },
);
collab.sync();

assertDocEquals(collab.editorA, collab.editorB);
assertPeerEditsSurvive([collab.editorA, collab.editorB], {
  blockId: "p1",
  tokens: [" A", " B"],
});
```

## Deterministic Fixtures

```ts
import { expect } from "vitest";
import {
  createDeterministicYDocFixture,
  runCRDTStateVectorContract,
} from "@input/pen-test";

const fixture = createDeterministicYDocFixture({
  blocks: [{ id: "p1", type: "paragraph", content: "Stable text" }],
});

expect(fixture.updateBase64).toMatchSnapshot();
runCRDTStateVectorContract({ createFixture: () => fixture });
```

## Integration Notes

- The test harness defaults to Pen's shipped schema and a Yjs-backed document.
- Override `schema`, `doc`, or other editor options when a test needs a custom runtime setup.
- Fixture helpers use generic Pen document roots and avoid product-specific fixture data.
- Contract helpers throw ordinary errors and do not require a specific test runner.
- These utilities are intended for package and app tests, not production editor bootstrapping.

## Options

`createTestEditor` defaults to the shipped schema and a Yjs-backed document. Override `schema`, `doc`, or other editor options when a test needs a custom runtime. This package has no separate options object beyond those editor fields.

## Documentation

The docs site (the `@input/pen-docs` package) covers runtime floor notes on the Browser and Node page (`#/support`).

The public signatures of record are in `api-report.md` next to this package's source in the Pen repository. The docs site does not host a generated browsable reference.

## License

MIT © Input Systems B.V. See [`LICENSE.md`](./LICENSE.md).
