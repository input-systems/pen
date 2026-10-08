export function CommandsPage() {
	return (
		<>
			<h1>Commands and keymaps</h1>
			<p>
				Every built-in editing action is a named <code>Command</code>{" "}
				with a typed parameter. Handlers live on a registry. Keymaps,
				menus, and tests are supposed to dispatch those names instead of
				reimplementing Enter or Backspace. Contracts are{" "}
				<code>Command</code>, <code>CommandHandler</code>, and{" "}
				<code>CommandHandlerProvider</code> on{" "}
				<code>@input/pen-types</code>. The design record is{" "}
				<code>spec/rules/commands.md</code>.
			</p>
			<p>
				<code>Editor</code> has no <code>dispatch</code> or{" "}
				<code>canDispatch</code> method. <code>createEditor</code>{" "}
				installs a registry of the 31 built-in handlers. Hosts reach it
				with <code>getCommandRegistry(editor)</code>. The command
				tokens,
				<code>defineCommand</code>, <code>commandHandler</code>, and{" "}
				<code>createCommandRegistry</code> export from{" "}
				<code>@input/pen-core</code>.
			</p>

			<h2>Command registry</h2>
			<p>
				<code>createCommandRegistry</code> takes an editor, an optional{" "}
				<code>apply</code> / <code>setSelection</code> pair, and a list
				of <code>commandHandler(...)</code> providers. It resolves those
				providers once, by command name. <code>createEditor</code>{" "}
				passes <code>builtinCommandHandlers()</code> and wires apply /
				selection back onto the editor. <code>getCommandRegistry</code>{" "}
				returns that installed instance.
			</p>
			<pre>
				<code>{`import { getCommandRegistry, insertText } from "@input/pen-core";
import { createEditor } from "@input/pen";

const editor = createEditor();
const blockId = editor.firstBlock()?.id ?? "";
editor.selectText(blockId, 0, 0);

const registry = getCommandRegistry(editor);
registry?.dispatch(insertText, { text: "Hello" });`}</code>
			</pre>
			<p>
				<code>commandsFacet</code> (<code>pen.commands</code>) groups{" "}
				<code>CommandHandlerRegistration</code> values by command name.
				The installed registry does not read that facet. Contributing{" "}
				<code>commandHandler</code> through{" "}
				<code>extension.facets</code> does not change what{" "}
				<code>getCommandRegistry(editor)</code> dispatches.
			</p>

			<h2>Dispatch and precedence</h2>
			<p>
				<code>registry.dispatch(command, param, context?)</code> walks
				handlers for that <code>command.name</code> and returns{" "}
				<code>true</code> on the first non-<code>false</code> result. No
				handler, or every handler returning <code>false</code>, is a
				miss: <code>false</code>, no diagnostic. Precedence is{" "}
				<code>highest</code>, <code>high</code>, <code>default</code>,{" "}
				<code>low</code>, <code>lowest</code>, then registration order.
				Built-ins register at <code>default</code>.
			</p>
			<p>A handler result is one of:</p>
			<ul>
				<li>
					<code>false</code> — miss; the next handler runs
				</li>
				<li>
					<code>true</code> — handled; the handler already used public
					editor APIs
				</li>
				<li>
					<code>{"{ ops, options? }"}</code> — one <code>apply</code>.
					Origin is <code>context.origin ?? "user"</code>, then the
					result&apos;s <code>options</code>
				</li>
				<li>
					<code>{"{ selection }"}</code> — one selection write. Origin
					is <code>keyboard</code> when{" "}
					<code>context.fromKeymap</code> is set, otherwise{" "}
					<code>programmatic</code>
				</li>
			</ul>
			<p>
				A handler that calls <code>editor.apply</code> and then returns
				ops emits <code>command-double-effect</code> and still counts as
				handled. Dispatch is synchronous. A nested <code>dispatch</code>{" "}
				queues and runs after the current one; the outer call still
				returns the outer result.
			</p>
			<p>
				<code>canDispatch</code> runs the same handlers on a probe
				editor whose <code>apply</code> and selection writes are no-ops.
				It is <code>true</code> when some handler would not miss. Use it
				to ask; use <code>dispatch</code> to commit.
			</p>

			<h2>Registering or overriding</h2>
			<p>
				<code>defineCommand(name)</code> is a <code>{"{ name }"}</code>{" "}
				token.{" "}
				<code>commandHandler(command, handler, precedence?)</code> wraps
				a handler as a <code>pen.commands</code> provider (default
				precedence <code>default</code>). Pass extra providers into{" "}
				<code>createCommandRegistry</code> after the built-ins. A{" "}
				<code>high</code> handler that returns <code>false</code> falls
				through; one that returns a result wins.
			</p>
			<pre>
				<code>{`import {
  builtinCommandHandlers,
  commandHandler,
  createCommandRegistry,
  splitBlock,
} from "@input/pen-core";
import { createEditor } from "@input/pen";

const editor = createEditor();

const registry = createCommandRegistry({
  editor,
  providers: [
    ...builtinCommandHandlers(),
    commandHandler(
      splitBlock,
      (current) => {
        const selection = current.selection;
        if (selection?.type !== "text") {
          return false;
        }
        const block = current.getBlock(selection.focus.blockId);
        if (!block || block.type !== "heading") {
          return false;
        }
        return {
          ops: [
            {
              type: "splice-text",
              blockId: block.id,
              from: selection.focus.offset,
				to: selection.focus.offset,
				insert: "|",
            },
          ],
        };
      },
      "high",
    ),
  ],
  apply: (ops, options) => {
    editor.apply(ops, options);
  },
});

const canSplit = registry.canDispatch(splitBlock, undefined);
void canSplit;
void registry.dispatch(splitBlock, undefined);`}</code>
			</pre>
			<p>
				That registry is not the one <code>createEditor</code>{" "}
				installed. There is no host API that appends providers to the
				installed instance. Until install reads{" "}
				<code>pen.commands</code>, an override is a registry you
				construct and dispatch yourself.
			</p>

			<h2>Built-in catalog</h2>
			<p>
				Thirty-three frozen names, all thirty-three with a core handler.{" "}
				<code>pen.caretUp</code> and <code>pen.caretDown</code> need
				geometry that core, being headless, does not have: register{" "}
				<code>setVerticalCaretMeasure</code> after{" "}
				<code>createEditor</code> to get real column-preserving motion.
				Without it they still cross block boundaries logically, and a
				mid-block press is a handled no-op that emits{" "}
				<code>caret-geometry-unavailable</code> rather than failing
				silently. Field-editor ArrowUp / ArrowDown still move on a
				parallel path ahead of the keymap; that path is what these
				handlers exist to replace.
			</p>
			<table>
				<caption>
					Caret and selection. Param is {`{ extend }`} unless noted.
				</caption>
				<thead>
					<tr>
						<th>Name</th>
						<th>Token</th>
						<th>Notes</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>
							<code>pen.caretLeft</code> /{" "}
							<code>pen.caretRight</code>
						</td>
						<td>
							<code>caretLeft</code> / <code>caretRight</code>
						</td>
						<td>
							Grapheme step; atom-adjacent select; block-boundary
							T4.
						</td>
					</tr>
					<tr>
						<td>
							<code>pen.caretUp</code> /{" "}
							<code>pen.caretDown</code>
						</td>
						<td>
							<code>caretUp</code> / <code>caretDown</code>
						</td>
						<td>
							Geometry via <code>setVerticalCaretMeasure</code>;
							goalX preserved. Without it: logical cross at a
							block edge, diagnostic no-op mid-block.
						</td>
					</tr>
					<tr>
						<td>
							<code>pen.caretLineStart</code> /{" "}
							<code>pen.caretLineEnd</code>
						</td>
						<td>
							<code>caretLineStart</code> /{" "}
							<code>caretLineEnd</code>
						</td>
						<td>
							Offset 0 / logical length of the focus block. Visual
							line-box edges need geometry that is not here yet.
						</td>
					</tr>
					<tr>
						<td>
							<code>pen.caretBlockStart</code> /{" "}
							<code>pen.caretBlockEnd</code>
						</td>
						<td>
							<code>caretBlockStart</code> /{" "}
							<code>caretBlockEnd</code>
						</td>
						<td>Same offsets. Unbound by default.</td>
					</tr>
					<tr>
						<td>
							<code>pen.caretDocStart</code> /{" "}
							<code>pen.caretDocEnd</code>
						</td>
						<td>
							<code>caretDocStart</code> /{" "}
							<code>caretDocEnd</code>
						</td>
						<td>First / last normal position in document order.</td>
					</tr>
					<tr>
						<td>
							<code>pen.caretWordLeft</code> /{" "}
							<code>pen.caretWordRight</code>
						</td>
						<td>
							<code>caretWordLeft</code> /{" "}
							<code>caretWordRight</code>
						</td>
						<td>
							<code>Intl.Segmenter</code> word boundaries.
						</td>
					</tr>
					<tr>
						<td>
							<code>pen.selectAll</code>
						</td>
						<td>
							<code>selectAll</code>
						</td>
						<td>
							<code>void</code>. Escalation ladder T1.
						</td>
					</tr>
					<tr>
						<td>
							<code>pen.selectBlock</code>
						</td>
						<td>
							<code>selectBlock</code>
						</td>
						<td>
							<code>{"{ blockId }"}</code>
						</td>
					</tr>
				</tbody>
			</table>
			<table>
				<caption>Text</caption>
				<thead>
					<tr>
						<th>Name</th>
						<th>Token</th>
						<th>Param</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>
							<code>pen.insertText</code>
						</td>
						<td>
							<code>insertText</code>
						</td>
						<td>
							<code>{"{ text }"}</code>
						</td>
					</tr>
					<tr>
						<td>
							<code>pen.deleteBackward</code> /{" "}
							<code>pen.deleteForward</code>
						</td>
						<td>
							<code>deleteBackward</code> /{" "}
							<code>deleteForward</code>
						</td>
						<td>
							<code>{`{ granularity: "grapheme" | "word" | "line" }`}</code>
						</td>
					</tr>
					<tr>
						<td>
							<code>pen.insertLineBreak</code>
						</td>
						<td>
							<code>insertLineBreak</code>
						</td>
						<td>
							<code>void</code>. Inserts <code>{"\\n"}</code>.
						</td>
					</tr>
					<tr>
						<td>
							<code>pen.splitBlock</code>
						</td>
						<td>
							<code>splitBlock</code>
						</td>
						<td>
							<code>void</code>. Split, list continuation,
							empty-list convert, heading → paragraph.
						</td>
					</tr>
					<tr>
						<td>
							<code>pen.indent</code> / <code>pen.outdent</code>
						</td>
						<td>
							<code>indent</code> / <code>outdent</code>
						</td>
						<td>
							<code>void</code>
						</td>
					</tr>
					<tr>
						<td>
							<code>pen.toggleMark</code>
						</td>
						<td>
							<code>toggleMark</code>
						</td>
						<td>
							<code>{"{ mark; value? }"}</code>. Collapsed caret
							misses (no pending-mark host).
						</td>
					</tr>
					<tr>
						<td>
							<code>pen.convertBlock</code>
						</td>
						<td>
							<code>convertBlock</code>
						</td>
						<td>
							<code>{"{ blockId; newType; newProps? }"}</code>.
							Unbound. Unknown types emit{" "}
							<code>invalid-block-type</code>.
						</td>
					</tr>
				</tbody>
			</table>
			<table>
				<caption>Structure, table, history</caption>
				<thead>
					<tr>
						<th>Name</th>
						<th>Token</th>
						<th>Notes</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>
							<code>pen.moveBlockUp</code> /{" "}
							<code>pen.moveBlockDown</code>
						</td>
						<td>
							<code>moveBlockUp</code> /{" "}
							<code>moveBlockDown</code>
						</td>
						<td>
							<code>{"{ blockId? }"}</code>. First / last sibling
							is a miss. Unbound.
						</td>
					</tr>
					<tr>
						<td>
							<code>pen.duplicateBlock</code>
						</td>
						<td>
							<code>duplicateBlock</code>
						</td>
						<td>Copy after the original. Unbound.</td>
					</tr>
					<tr>
						<td>
							<code>pen.deleteBlock</code>
						</td>
						<td>
							<code>deleteBlock</code>
						</td>
						<td>
							Last remaining block becomes an empty paragraph.
							Unbound.
						</td>
					</tr>
					<tr>
						<td>
							<code>table.cellNext</code> /{" "}
							<code>table.cellPrev</code> /{" "}
							<code>table.cellDown</code>
						</td>
						<td>
							<code>tableCellNext</code> /{" "}
							<code>tableCellPrev</code> /{" "}
							<code>tableCellDown</code>
						</td>
						<td>
							Linear cell step; clamp at the edge. Keymap{" "}
							<code>context: &quot;cell&quot;</code>.
						</td>
					</tr>
					<tr>
						<td>
							<code>table.escapeGrid</code>
						</td>
						<td>
							<code>tableEscapeGrid</code>
						</td>
						<td>Leave cell selection. Unbound.</td>
					</tr>
					<tr>
						<td>
							<code>history.undo</code> /{" "}
							<code>history.redo</code>
						</td>
						<td>
							<code>historyUndo</code> / <code>historyRedo</code>
						</td>
						<td>
							Calls the undo controller /{" "}
							<code>editor.undoManager</code>. Without{" "}
							<code>undoExtension</code> /{" "}
							<code>defaultPreset()</code> that manager is an
							inert stub: <code>canUndo()</code> is{" "}
							<code>false</code>, <code>undo()</code> does
							nothing, no error.
						</td>
					</tr>
				</tbody>
			</table>
			<p>
				Do not invent catalog names for field-editor helpers (
				<code>applyListInputRule</code>,{" "}
				<code>handleFieldEditorKeyDown</code>, and the rest). Those are
				not commands.
			</p>

			<h2>Keymaps</h2>
			<p>
				Two tables have not fully met. The command catalog keymap is{" "}
				<code>resolveDefaultKeymap(platform)</code> in{" "}
				<code>@input/pen-core</code>: each row is a key string, a{" "}
				<code>Command</code> token, an optional param, and an optional
				context (<code>text</code> / <code>cell</code> /{" "}
				<code>block</code> / <code>any</code>). Shared rows use{" "}
				<code>Mod</code>, rewritten to <code>Meta</code> on macOS and{" "}
				<code>Ctrl</code> on Windows and Linux. Word / line / document
				chords are platform-specific. Unbound by default:{" "}
				<code>pen.caretBlockStart</code>, <code>pen.caretBlockEnd</code>
				, <code>pen.convertBlock</code>, the four structure commands,
				and <code>table.escapeGrid</code>.
			</p>
			<pre>
				<code>{`import {
  defineExtension,
  keymapFacet,
  resolveDefaultKeymap,
} from "@input/pen-core";

const macos = resolveDefaultKeymap("macos");
const toggleBold = macos.find(
  (binding) => binding.command.name === "pen.toggleMark",
);

const hostKeys = defineExtension({
  name: "host-keys",
  facets: [
    keymapFacet.of(
      [{ key: "Mod-s", handler: () => true }],
      "high",
    ),
  ],
});

void toggleBold;
void hostKeys;`}</code>
			</pre>
			<p>
				Host-contributed bindings go through{" "}
				<code>extension.facets</code> as <code>keymapFacet</code> (
				<code>pen.keymap</code>) providers. A <code>KeyBinding</code>{" "}
				has <code>key</code> and <code>handler(editor, event)</code>,
				not a command token. <code>keymapFacet.of</code> takes a{" "}
				<code>KeyBinding[]</code> and an optional precedence (
				<code>highest</code> / <code>high</code> / <code>default</code>{" "}
				/ <code>low</code> / <code>lowest</code>).{" "}
				<code>defaultPreset()</code> installs{" "}
				<code>richTextShortcutsExtension</code> from{" "}
				<code>@input/pen-shortcuts</code> unless{" "}
				<code>shortcuts: false</code> is passed. Read the merged list
				with <code>editor.facet(keymapFacet)</code>.
			</p>
			<p>
				The field editor now walks <code>resolveDefaultKeymap</code> and{" "}
				<code>dispatch</code>es the matching command. A miss — including{" "}
				<code>pen.caretUp</code> / <code>pen.caretDown</code> — falls
				through to <code>keymapFacet</code> (
				<code>KeyBinding.handler</code>, not a command token). Those two
				tables are not one. Until they are, a host chord stays on{" "}
				<code>keymapFacet</code>; a host that needs an editing action
				the default keymap does not cover calls{" "}
				<code>getCommandRegistry(editor)?.dispatch(...)</code>.{" "}
				<code>Editor</code> still has no <code>dispatch</code> method.
			</p>
		</>
	);
}
