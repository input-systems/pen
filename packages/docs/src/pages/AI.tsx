export function AIPage() {
	return (
		<>
			<h1>AI boundary</h1>
			<p>
				Pen does not call a model and does not send document text
				anywhere on its own. The host supplies a{" "}
				<code>ModelAdapter</code>. Before that adapter runs, every
				request Pen assembled passes through the{" "}
				<code>pen.aiEgress</code> facet. A host filter can inspect,
				redact, or refuse what would leave the document.
			</p>
			<p>
				<code>pen.aiEgress</code> is defined once in{" "}
				<code>@input/pen-core</code> and re-exported from{" "}
				<code>@input/pen-ai</code>. Install it with{" "}
				<code>aiEgressExtension</code>. The filter is{" "}
				<code>(context) =&gt; context | null</code>. It is synchronous.
			</p>

			<h2>Inspect, redact, refuse</h2>
			<p>
				The filter receives an <code>AIRequestContext</code>:{" "}
				<code>feature</code>, <code>messages</code>,{" "}
				<code>documentExcerpts</code>, and <code>tools</code>. Returning
				the same context is inspect. Returning a new context is redact.
				Returning <code>null</code> is refuse.
			</p>
			<p>
				A refusal means <code>streamThroughEgress</code> returns without
				calling the adapter. The editor emits{" "}
				<code>ai-request-refused</code> at info level. The feature
				completes: generation finishes{" "}
				<code>status: &quot;complete&quot;</code>, suggestions return no
				candidates, autocomplete goes idle. Nothing throws.
			</p>
			<p>
				Several filters compose in registration order. The first{" "}
				<code>null</code> stops the chain. With no filter installed, the
				context passes through unchanged.
			</p>
			<pre>
				<code>{`import { aiEgressFacet, defineExtension } from "@input/pen-core";
import { createEditor } from "@input/pen";
import { aiExtension } from "@input/pen-ai";
import type { AIRequestFilter } from "@input/pen-types";

const inspect: AIRequestFilter = (context) => {
  void context.feature;
  void context.tools;
  void context.documentExcerpts;
  return context;
};

const redact: AIRequestFilter = (context) => {
  const scrub = (text: string) => text.replace(/secret/gi, "[redacted]");
  return {
    ...context,
    documentExcerpts: context.documentExcerpts.map((excerpt) => ({
      ...excerpt,
      text: scrub(excerpt.text),
    })),
    messages: context.messages.map((message) => ({
      ...message,
      content:
        typeof message.content === "string"
          ? scrub(message.content)
          : message.content,
    })),
  };
};

const refuse: AIRequestFilter = (context) =>
  context.feature === "autocomplete" ? null : context;

const editor = createEditor({
  extensions: [
    defineExtension({
      name: "host-ai-egress",
      facets: [
        aiEgressFacet.of(inspect),
        aiEgressFacet.of(redact),
        aiEgressFacet.of(refuse),
      ],
    }),
    aiExtension(),
  ],
});`}</code>
			</pre>
			<p>
				<code>aiEgressExtension(filter)</code> is the same seam with one
				filter. Do not register that helper more than once — extension
				names must be unique. Contribute extra filters through{" "}
				<code>aiEgressFacet.of</code> on your own extension, as above.
			</p>

			<h2>One door</h2>
			<p>
				<code>ModelAdapter</code> declares exactly one method:{" "}
				<code>stream</code>. The non-test workspace has exactly one call
				to it, inside <code>streamThroughEgress</code>, and only after{" "}
				<code>filterAIRequest</code> returns non-null. There is no
				second adapter method and no other production call site. A host
				filter sits in front of the only door.
			</p>
			<p>
				That is the difference between checking the paths someone
				thought of and there being nowhere else to go. Allowed requests
				also emit <code>ai-egress-inventory</code> when a diagnostic
				listener is attached. The inventory lists <code>feature</code>{" "}
				plus each excerpt <code>blockId</code> and <code>kind</code>. It
				does not include excerpt text.
			</p>

			<h2>What each feature sends</h2>
			<p>
				<code>AI_FEATURE_CONTENT</code> on <code>@input/pen-ai</code> is
				the per-feature declaration. A host filter sees those values on{" "}
				<code>context.feature</code>, <code>context.tools</code>, and{" "}
				<code>context.documentExcerpts</code>.
			</p>
			<table>
				<caption>
					What <code>AIRequestContext</code> carries per feature
				</caption>
				<thead>
					<tr>
						<th>Package</th>
						<th>
							<code>feature</code>
						</th>
						<th>
							<code>tools</code>
						</th>
						<th>Excerpt kinds</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>
							<code>@input/pen-ai</code>
						</td>
						<td>
							<code>generation</code>
						</td>
						<td>
							Grant-filtered descriptors from the tool runtime, or{" "}
							<code>[]</code> when the route disables tools or
							uses the local-operation path
						</td>
						<td>
							<code>selection</code>, <code>target</code>,{" "}
							<code>context</code>
						</td>
					</tr>
					<tr>
						<td>
							<code>@input/pen-ai</code>
						</td>
						<td>
							<code>agentic-step</code>
						</td>
						<td>Same grant-filtered list as generation</td>
						<td>
							<code>selection</code>, <code>target</code>,{" "}
							<code>context</code>, <code>tool-result</code>
						</td>
					</tr>
					<tr>
						<td>
							<code>@input/pen-ai/suggestions</code>
						</td>
						<td>
							<code>suggestions</code>
						</td>
						<td>
							<code>[]</code>
						</td>
						<td>
							<code>target</code>, <code>context</code>
						</td>
					</tr>
					<tr>
						<td>
							<code>@input/pen-ai/autocomplete</code>
						</td>
						<td>
							<code>autocomplete</code>
						</td>
						<td>
							<code>[]</code>
						</td>
						<td>
							<code>target</code>, <code>context</code>
						</td>
					</tr>
				</tbody>
			</table>
			<p>
				<code>generation</code> is the first agentic pass and the
				local-operation path. After a tool result re-enters the prompt,
				the same loop stamps <code>agentic-step</code> and adds{" "}
				<code>tool-result</code> excerpts. Those tool-result strings are
				compacted to 1,200 characters (
				<code>
					AI_FEATURE_CONTENT[&quot;agentic-step&quot;].toolResultMaxChars
				</code>
				). Suggestions default to 320 scope characters (
				<code>maxScopeChars</code>). Autocomplete and generation declare
				no character cap on that object.
			</p>
			<p>
				<code>messages</code> is always populated. It is a separate
				field from <code>documentExcerpts</code>. Redacting excerpts
				does not rewrite messages.
			</p>
			<pre>
				<code>{`import { AI_FEATURE_CONTENT } from "@input/pen-ai";

const generationKinds = AI_FEATURE_CONTENT.generation.excerptKinds;
const suggestionKinds = AI_FEATURE_CONTENT.suggestions.excerptKinds;
const autocompleteKinds = AI_FEATURE_CONTENT.autocomplete.excerptKinds;
const agenticKinds = AI_FEATURE_CONTENT["agentic-step"].excerptKinds;`}</code>
			</pre>

			<h2>Tool grants</h2>
			<p>
				<code>createAIToolTurn</code> default-denies mutating tools
				unless <code>allowedMutatingTools</code> lists them.{" "}
				<code>aiExtension</code> defaults that allowlist to{" "}
				<code>[]</code>. A denied call returns{" "}
				<code>
					{
						'{ ok: false, status: "blocked", reason: "tool-not-allowed" }'
					}
				</code>{" "}
				and does not throw.
			</p>
			<p>
				Whether a tool is mutating: an explicit <code>mutating</code>{" "}
				flag on the <code>ToolDefinition</code> wins. Otherwise the name
				is read-only only when it is in{" "}
				<code>
					read_document, get_context, get_cursor_context,
					inspect_target, list_valid_operations, search_document,
					retrieve_document_spans, list_block_types
				</code>
				. An unrecognized name defaults to mutating. Destructive is
				classified per call: <code>destructive</code> is a flag or a
				resolver <code>(input, {"{ staged }"}) =&gt; boolean</code>, else
				the built-in names <code>delete_block</code> and{" "}
				<code>write_document</code>. <code>edit_document</code> declares
				a resolver: a staged call is never destructive, and a direct one
				is only when it removes or replaces existing content.
			</p>
			<p>
				Budgets, first limit hit ends the turn: 20 calls per turn, 32
				ops per call, 128 ops per turn. The agentic loop also caps steps
				at 10 (<code>maxAgenticSteps</code> /{" "}
				<code>AI_AGENTIC_MAX_STEPS_DEFAULT</code>). Exhaustion returns{" "}
				<code>{'{ ok: false, status: "turn-ended", reason }'}</code>{" "}
				where <code>reason</code> is one of{" "}
				<code>
					budget-calls-exhausted, budget-ops-per-call-exhausted,
					budget-total-ops-exhausted
				</code>
				.
			</p>
			<pre>
				<code>{`import { aiExtension } from "@input/pen-ai";
import {
  createAIToolTurn,
  AI_TOOL_MAX_CALLS_PER_TURN,
  AI_TOOL_MAX_OPS_PER_CALL,
  AI_TOOL_MAX_TOTAL_OPS_PER_TURN,
} from "@input/pen-ai/tools";
import type { AIToolCallDenied } from "@input/pen-ai/tools";

aiExtension({
  allowedMutatingTools: ["insert_block", "update_block"],
});

createAIToolTurn({
  allowedMutatingTools: ["insert_block", "update_block"],
  budget: {
    maxCallsPerTurn: AI_TOOL_MAX_CALLS_PER_TURN,
    maxOpsPerCall: AI_TOOL_MAX_OPS_PER_CALL,
    maxTotalOpsPerTurn: AI_TOOL_MAX_TOTAL_OPS_PER_TURN,
  },
});

const denied: AIToolCallDenied = {
  ok: false,
  status: "blocked",
  reason: "tool-not-allowed",
};`}</code>
			</pre>

			<h2>Honest limits</h2>
			<ul>
				<li>
					Tool <code>mutating</code> / <code>destructive</code> flags
					are host-trusted signals for granting authority, not a
					sandbox. A handler that declares{" "}
					<code>mutating: false</code> and then mutates is bounded
					only by the op budget.
				</li>
				<li>
					Without a <code>confirm</code> resolver, a destructive call
					runs and emits <code>ai-tool-unconfirmed</code>: absence is
					not a refuse by default. A production host that exposes the
					external delete and whole-document tools should pass{" "}
					<code>{'unconfirmedDestructive: "refuse"'}</code> to{" "}
					<code>aiExtension</code>, which blocks those calls and
					leaves the document unchanged.
				</li>
				<li>
					<code>executeAITool</code> without a turn allowlists
					nothing. Mutating and destructive calls come back{" "}
					<code>
						{
							'{ ok: false, status: "blocked", reason: "tool-not-allowed" }'
						}
					</code>
					.
				</li>
				<li>
					Redact <code>messages</code> and{" "}
					<code>documentExcerpts</code>. A string-only message scrub
					leaves <code>ModelMessagePart[]</code> content untouched,
					including tool-call parts on <code>agentic-step</code>.
				</li>
				<li>
					<code>stream()</code> is typed to take <code>messages</code>{" "}
					and <code>tools</code>. The runtime call also attaches the
					filtered context as <code>context</code>. An adapter that
					serializes its whole options object will send excerpts
					unless the filter redacted them.
				</li>
				<li>
					A custom <code>analyzer</code> on{" "}
					<code>aiSuggestionsExtension</code> never reaches{" "}
					<code>pen.aiEgress</code>. It receives the suggestion scope,
					including document text, and is entirely host code.
				</li>
				<li>
					A document-scoped generation excerpt can carry{" "}
					<code>text: &quot;&quot;</code>. The document text in that
					case lives in <code>messages</code>.
				</li>
				<li>
					The filter cannot await a classifier. Asynchronous review
					belongs in the host <code>ModelAdapter</code>, which runs
					after the filter has already allowed the request.
				</li>
				<li>
					Pen does not encrypt content, detect PII, meter tokens, or
					sandbox a tool handler.
				</li>
			</ul>

			<h2>Features</h2>
			<p>
				AI packages are headless. They install runtime, controllers, and
				suggestion state. The host owns the model, auth, and transport.
				The playground is a maintainer kitchen sink, not an example.
			</p>
			<p>
				<code>ModelAdapter</code> and <code>PenTransport</code> are
				types on <code>@input/pen-types</code>. An adapter exposes{" "}
				<code>stream()</code>. A transport exposes <code>stream</code>,{" "}
				<code>connect</code>, <code>disconnect</code>, and connection
				listeners. <code>@input/pen-transport/direct</code> exports{" "}
				<code>directTransport</code>.{" "}
				<code>@input/pen-transport/sse</code> exports{" "}
				<code>sseTransport</code> and <code>createSSEHandler</code>.
			</p>
			<p>
				<code>@input/pen-ai</code> installs the AI extension. It depends
				on <code>tools</code>, <code>delta-stream</code>, and{" "}
				<code>undo</code>. <code>defaultPreset()</code> registers those.
				A bare{" "}
				<code>{`createEditor({ extensions: [aiExtension()] })`}</code>{" "}
				throws. Pair the extension with a renderer when you want review
				chrome. React exposes AI surfaces on the{" "}
				<code>@input/pen-react/ai</code> and{" "}
				<code>@input/pen-react/ai-suggestions</code> subpaths.
			</p>
			<pre>
				<code>{`import { createEditor } from "@input/pen";
import { aiExtension, getAIController } from "@input/pen-ai";

const editor = createEditor({
  extensions: [
    aiExtension({
      suggestMode: true,
      author: "Ada",
    }),
  ],
});

const ai = getAIController(editor);`}</code>
			</pre>
			<p>
				Suggest mode sends AI-authored edits through the suggestion and
				review path instead of replacing document text immediately.
				Streaming writes go through <code>editor.openTextStream</code> /{" "}
				<code>@input/pen-ai/stream</code>, not direct Yjs text writes.
				Install <code>@input/pen-ai</code>; suggestions, autocomplete,
				tools, skills, and stream are subpath entries.
			</p>
			<ul>
				<li>
					<code>@input/pen-ai/suggestions</code> —{" "}
					<code>aiSuggestionsExtension</code>, host-provided analyzer
				</li>
				<li>
					<code>@input/pen-ai/autocomplete</code> —{" "}
					<code>autocompleteExtension</code>,{" "}
					<code>getAutocompleteController</code>
				</li>
				<li>
					<code>@input/pen-ai/tools</code> —{" "}
					<code>getAIToolRuntime</code>, <code>listAITools</code>,{" "}
					<code>executeAITool</code>
				</li>
				<li>
					<code>@input/pen-ai/skills</code> — skill descriptions for
					agent workflows
				</li>
				<li>
					<code>@input/pen-tools</code> — structured document
					tools; payloads are validated before ops are built
				</li>
			</ul>
		</>
	);
}
