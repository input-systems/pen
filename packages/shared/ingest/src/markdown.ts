import type { Editor } from "@input/pen-types";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { astToBlocks } from "./astToBlocks";
import type { PendingBlock, MdastRoot } from "./markdownTypes";

export function parseMarkdownToBlocks(
  input: string,
  editor: Pick<Editor, "schema">,
): PendingBlock[] {
  const tree = fromMarkdown(input, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  }) as MdastRoot;

  return astToBlocks(tree, editor.schema, input);
}
