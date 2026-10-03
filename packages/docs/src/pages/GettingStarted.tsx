export function GettingStartedPage() {
	return (
		<>
			<h1>Getting started</h1>
			<p>
				Start with <code>@input/pen</code> and a host binding. The
				starter&apos;s <code>createEditor()</code> applies{" "}
				<code>defaultPreset()</code> when no <code>preset</code> is
				passed: the default schema, bold/italic shortcuts, undo,
				document tools, and <code>delta-stream</code>.{" "}
				<code>@input/pen-core</code> is the assembly point when you
				compose everything yourself: core&apos;s{" "}
				<code>createEditor()</code> installs no schema and no extension,
				and <code>editor.undoManager</code> is an inert stub (
				<code>canUndo()</code> is <code>false</code>,{" "}
				<code>undo()</code> does nothing, no error). Core&apos;s{" "}
				<code>
					createHeadlessEditor({"{ useDefaultExtensions: true }"})
				</code>{" "}
				is a no-op: the fallback list is empty. React and Vue{" "}
				<code>useEditor</code> inject <code>defaultSchema</code> and
				still install no preset — pass{" "}
				<code>preset: defaultPreset()</code> there, or compose{" "}
				<code>schema: createDefaultSchema()</code> and an{" "}
				<code>extensions</code> list yourself.
			</p>
			<p>
				Packages are not on the public registry. There has never been a
				release train, a git tag, or a <code>CHANGELOG.md</code>.{" "}
				<code>pnpm add @input/pen-*</code> 404s today. Minimal apps live
				in this repository at <code>examples/react</code>,{" "}
				<code>examples/vue</code>, and <code>examples/vanilla</code>.
				Each is a workspace member. Each README lists the packages and
				peer dependencies for that host.
			</p>
			<p>
				<code>PenEditor</code> and <code>mountEditor</code> adopt
				editor-field chrome by default so an empty field is usable.
				Pass <code>chrome={"{false}"}</code> for the unstyled path.
				Tokens live in the <code>STYLING.md</code> that ships inside{" "}
				<code>@input/pen-react</code>. Vue documents what it applies in
				its own <code>STYLING.md</code> and defers to that same token
				catalog.
			</p>
			<p>
				Without chrome, an empty{" "}
				<code>[data-pen-inline-content]</code> has zero width until it
				contains text, so a click on an empty paragraph never lands on
				the inline surface. Activation is block-level: it resolves the
				clicked <code>[data-pen-editor-block]</code> in every binding,
				including on an empty document. A click on tall host chrome{" "}
				<em>below</em> the last text block activates that block at its
				end offset; a click <em>above</em> the first text block
				activates that block at offset 0. The gap <em>between</em>{" "}
				blocks stays inactive. Default chrome makes the inline surface
				fill its block, so the first click lands on the field; the
				unstyled path still does not need a host{" "}
				<code>min-width</code>.
			</p>
			<p>
				Runtime floor (HOST3): Node <code>^22.22.2 || ^24.15.0 || &gt;=26.0.0</code>, Chromium 93,
				Firefox 92, Safari 15.4. The table and the feature-detection
				fallbacks live on{" "}
				<a href="#/support">Browser and Node support</a>.
			</p>
			<p>
				License and distribution are stated in the repository root
				README. The{" "}
				<a href="https://pen-playground.input.so/">
					playground
				</a>{" "}
				is the try-it host: editor, scripted agent, and live rooms.
			</p>

			<h2>React</h2>
			<p>
				<code>@input/pen-react</code> is a client module. Its public
				entry points carry <code>"use client"</code>. In Next.js App
				Router, import <code>PenEditor</code> from a Client Component.
				<code>react</code> and <code>react-dom</code> are peers (
				<code>^18</code> or <code>^19</code>).{" "}
				<code>@input/pen-core</code> stays importable from server code.
			</p>
			<pre>
				<code>{`"use client";

import { createEditor } from "@input/pen";
import { PenEditor } from "@input/pen-react";

const editor = createEditor();

export function App() {
  return <PenEditor editor={editor} />;
}`}</code>
			</pre>

			<h2>Vue</h2>
			<p>
				<code>vue</code> <code>^3.4.0</code> is a peer of{" "}
				<code>@input/pen-vue</code>. Vue has no{" "}
				<code>"use client"</code> directive. Mount{" "}
				<code>PenEditor</code> in the browser, not during SSR.
			</p>
			<pre>
				<code>{`<script setup lang="ts">
import { createEditor } from "@input/pen";
import { PenEditor } from "@input/pen-vue";

const editor = createEditor();
</script>

<template>
  <PenEditor :editor="editor" />
</template>`}</code>
			</pre>

			<h2>Vanilla DOM</h2>
			<p>
				<code>@input/pen-dom</code> is the field-editor engine. It has
				no extra peer dependencies. <code>mountEditor</code> is the same
				composition <code>@input/pen-react</code> and{" "}
				<code>@input/pen-vue</code> already assemble:{" "}
				<code>FieldEditorImpl</code>, the editor-root shell, and
				inline-content surfaces. Construct it in the browser, not during
				SSR. <code>FieldEditorImpl.setRootElement</code> alone does not
				render document blocks.
			</p>
			<pre>
				<code>{`import { createEditor } from "@input/pen";
import { mountEditor } from "@input/pen-dom";

const editor = createEditor();

const root = document.querySelector("#app");
if (!(root instanceof HTMLElement)) {
  throw new Error("Missing #app");
}

mountEditor(editor, root);`}</code>
			</pre>
		</>
	);
}
