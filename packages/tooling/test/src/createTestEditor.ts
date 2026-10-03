import * as Y from "yjs";
import { defaultSchema } from "@input/pen-schema";
import { createEditor } from "@input/pen-core";
import { yjsAdapter, wrapYjsDocument } from "@input/pen-yjs";
import { createTestDocument } from "./createTestDocument";
import type { CRDTAdapter, SchemaEngine } from "@input/pen-types";
import type { TestEditor, TestEditorOptions } from "./types";
import { simulateKeypress, simulateTyping } from "./simulation";

export function createTestEditor(options?: TestEditorOptions): TestEditor {
  return buildTestEditor(options, yjsAdapter());
}

/**
 * `createTestEditor` over a caller-built adapter, so the peer harness can
 * hand each peer an adapter with an awareness factory. Not on the barrel.
 *
 * @internal
 */
export function buildTestEditor(
  options: TestEditorOptions | undefined,
  adapter: CRDTAdapter,
): TestEditor {
  const {
    blocks,
    doc,
    schema: providedSchema,
    crdt: _ignoredCrdt,
    document: _ignoredDocument,
    ...editorOptions
  } = options ?? {};
  const schema = providedSchema ?? defaultSchema;

  let ydoc: Y.Doc;
  let crdtDoc: ReturnType<typeof wrapYjsDocument>;

  if (doc) {
    ydoc = doc;
    const wrapped = wrapYjsDocument(adapter, ydoc);
    crdtDoc = wrapped;
  } else {
    const result = createTestDocument(blocks ?? []);
    ydoc = result.ydoc;
    crdtDoc = result.crdtDoc as ReturnType<typeof wrapYjsDocument>;
  }

  const editor = createEditor({
    ...editorOptions,
    crdt: adapter,
    document: crdtDoc,
    schema,
  });

  const testEditor = editor as TestEditor;
  const getBlock = editor.getBlock.bind(editor);
  const engine: SchemaEngine = editor.internals.engine;

  Object.defineProperties(testEditor, {
    document: {
      get() {
        return editor.internals.doc;
      },
    },
    ydoc: {
      get() {
        return adapter.raw<Y.Doc>(editor.internals.crdtDoc);
      },
    },
    crdtDoc: {
      get() {
        return editor.internals.crdtDoc;
      },
    },
  });

  testEditor.markDirty = (blockId: string) => {
    engine.markDirty(blockId);
  };
  testEditor.normalizeDirty = () => {
    engine.normalizeDirty();
  };
  testEditor.getBlock = (blockId: string) => {
    const handle = getBlock(blockId);
    if (!handle) {
      throw new Error(`Block not found: ${blockId}`);
    }
    return handle;
  };
  testEditor.simulateKeypress = (key: string) => {
    simulateKeypress(testEditor, key);
  };
  testEditor.simulateTyping = (text: string) => {
    simulateTyping(testEditor, text);
  };

  return testEditor;
}
