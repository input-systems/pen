import { describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
import { escapeMarkupAttribute, escapeMarkupText } from "../../escapeMarkup";
import { xmlExporter } from "../exporter";
import { xmlImporter } from "../importer";
import { defaultSchema } from "@input/pen-schema";

const noDefaultExtensionsPreset = {
  resolve() {
    return { extensions: [] };
  },
};

const HOSTILE_PLAIN_TEXTS = [
  `<script>alert("xss")</script>`,
  `foo & bar < baz > 'qux' "quux"`,
  `"><img src=x onerror=alert(1)>`,
];

function createBareEditor() {
  const editor = createEditor({
    schema: defaultSchema, preset: noDefaultExtensionsPreset,
  });
  const existingBlockIds = [...editor.documentState.allBlocks()]
    .filter((handle) => handle.parent === null)
    .map((handle) => handle.id);
  if (existingBlockIds.length > 0) {
    editor.apply(
      existingBlockIds.reverse().map((blockId) => ({
        type: "delete-block" as const,
        blockId,
      })),
    );
  }
  return editor;
}

function collectPlainText(editor: ReturnType<typeof createEditor>): string {
  return [...editor.documentState.allBlocks()]
    .map((handle) => handle.textContent())
    .join("");
}

describe("SEC5 escaped XML serialization", () => {
  it("SEC5 escapes text and attribute values", () => {
    expect(escapeMarkupText(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&apos;");
    expect(escapeMarkupAttribute(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&apos;");
  });

  it.each(HOSTILE_PLAIN_TEXTS)(
    "SEC5 round-trips hostile plain text %j through export and import",
    async (text) => {
      const source = createBareEditor();
      source.apply([
        {
          type: "insert-block",
          blockId: "b1",
          blockType: "paragraph",
          props: {},
          position: "last",
        },
        { type: "splice-text", blockId: "b1", from: 0, to: 0, insert: text },
      ]);

      const xml = await xmlExporter.export(source);
      expect(xml).not.toContain("<script>");
      if (text.includes("<")) {
        expect(xml).toContain("&lt;");
      }
      if (text.includes("&")) {
        expect(xml).toContain("&amp;");
      }
      if (text.includes("'")) {
        expect(xml).toContain("&apos;");
      }
      if (text.includes('"')) {
        expect(xml).toContain("&quot;");
      }

      const target = createBareEditor();
      await xmlImporter.import(xml, target);

      expect(collectPlainText(target)).toBe(text);

      source.destroy();
      target.destroy();
    },
  );

  it("SEC5 keeps breakout strings as attribute data", async () => {
    const source = createBareEditor();
    source.apply([
      {
        type: "insert-block",
        blockId: `b'"&<>`,
        blockType: "paragraph",
        props: { title: `a&b<'">` },
        position: "last",
      },
      {
        type: "splice-text",
        blockId: `b'"&<>`,
        from: 0,
				to: 0,
				insert: "safe",
      },
    ]);

    const xml = await xmlExporter.export(source);
    expect(xml).toContain("id=\"b&apos;&quot;&amp;&lt;&gt;\"");
    expect(xml).not.toContain(`id="b'"`);

    const target = createBareEditor();
    await xmlImporter.import(xml, target);
    expect(target.getBlock(`b'"&<>`)?.textContent()).toBe("safe");

    source.destroy();
    target.destroy();
  });
});
