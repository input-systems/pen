export function CollaborationPage() {
	return (
		<>
			<h1>Collaboration</h1>
			<p>
				Pen guarantees two things when more than one client is on a
				document: <strong>CRDT convergence</strong> and{" "}
				<strong>origin labeling</strong>. The host owns everything else
				that looks like a product: auth, persistence, permissions,
				presence-payload policy, and schema agreement across peers.
			</p>
			<p>
				This is COL5. The same statement lives in{" "}
				<code>packages/crdt/yjs/COLLABORATION.md</code>.
			</p>

			<h2>Setup</h2>
			<p>
				<code>@input/pen-yjs</code> is the Yjs adapter (
				<code>yjsAdapter</code>
				). <code>yjs</code> is a peer, not bundled. <code>y-protocols</code>{" "}
				is needed only for awareness, on the{" "}
				<code>@input/pen-yjs/awareness</code> subpath. <code>@input/pen-multiplayer</code> owns local
				awareness, peer derivation, remote cursors, and decorations.
				Neither package ships a transport, provider, server, or rooms.
				The host constructs a <code>MultiplayerSession</code> (or a{" "}
				<code>sessionFactory</code>) and hands it to{" "}
				<code>multiplayerExtension</code>.
			</p>
			<pre>
				<code>{`import { multiplayerExtension } from "@input/pen-multiplayer";
import type { MultiplayerSession } from "@input/pen-multiplayer";

function install(session: MultiplayerSession) {
  return multiplayerExtension({
    user: { id: "u1", name: "Ada" },
    session,
  });
}`}</code>
			</pre>
			<p>
				<code>session</code> is host-owned. For Yjs, wrap the provider
				with <code>createYjsProviderSession</code> and pass the native
				document and awareness through <code>getYjsDoc(editor)</code>{" "}
				and <code>getYjsAwareness(awareness)</code> from{" "}
				<code>@input/pen-yjs/awareness</code>. The canonical{" "}
				<code>y-websocket</code> wiring is in the{" "}
				<code>@input/pen-yjs</code> README. The playground file is
				a demo.
			</p>
			<p>
				<code>config.user</code> is broadcast to every peer. Do not put
				an email or internal id in presence unless it is meant to be
				seen. Attribution does not treat awareness names as authors.
			</p>

			<h2>What Pen guarantees</h2>
			<p>
				<strong>Convergence.</strong> The document store is a Yjs{" "}
				<code>Y.Doc</code>. Concurrent edits merge. After exchange,
				peers hold the same shared types (<code>blockOrder</code>,{" "}
				<code>blocks</code>, <code>apps</code>, <code>metadata</code>).
				Pen does not add operational transform, rebasing, a conflict UI,
				or a second merge algorithm. Where a result is Yjs's rather than
				Pen's (delete-beats-edit), that is a law, not a Pen choice.
			</p>
			<p>
				<strong>Origin labeling.</strong> A remote update is labeled so
				this client's undo, suggestions, input rules, and history can
				tell it apart from local typing. <code>"user"</code> means this
				client's user. It is never a default for an unlabeled remote
				transaction. The label is for local reasoning; it is not a
				capability a peer can grant itself.
			</p>
			<p data-col5="no-infrastructure">
				Pen does not provide a transport, a provider, a server, rooms,
				or presence infrastructure. The Yjs adapter and the multiplayer
				extension consume a host-provided provider. The playground{" "}
				<code>y-websocket</code> wiring is a demo.
			</p>

			<h2>What the host owns</h2>
			<ul>
				<li data-col5="no-auth">
					<strong>Auth.</strong> There is no session, token, or
					trusted peer in the library. A peer that can write to the
					Yjs room can write to the whole document. Access control
					lives in the host's transport.
				</li>
				<li data-col5="offline-is-yjs">
					<strong>Persistence.</strong> Pen does not store documents,
					manage rooms, or replay history. Offline editing is Yjs's
					guarantee: an offline client's edits converge when its
					provider reconnects. Pen adds no queue, backoff, or conflict
					UI.
				</li>
				<li data-col5="readonly-is-ui">
					<strong>Permissions.</strong> Pen does not enforce per-user
					or per-block permissions. <code>pen.ariaReadOnly</code> sets{" "}
					<code>aria-readonly</code> only. Local typing stops when the
					host passes the <code>readonly</code> prop. Neither is a
					security boundary: both stop nothing arriving over the wire,
					and neither stops <code>editor.apply</code>.
				</li>
				<li>
					<strong>Presence-payload policy.</strong> Awareness contents
					are host-provided and visible to every peer. An email or
					internal id put in presence is broadcast. Pen does not
					authenticate those strings.
				</li>
				<li data-col5="no-schema-merge">
					<strong>Schema agreement.</strong> Pen does not merge
					document schemas between peers. Two clients on different
					registries against one document is a host deployment
					concern.
				</li>
			</ul>

			<h2>Schema mismatch</h2>
			<p>
				Peers with different schema registries still{" "}
				<strong>converge on the CRDT</strong> and{" "}
				<strong>diverge on rendering</strong>. A block type one registry
				knows and the other does not remains in the shared document; the
				older (or different) client cannot edit it in place and will not
				render it as the authoring client did.
			</p>
			<p>
				DUR3 is what keeps that mismatch non-destructive. Unknown blocks
				keep their type, props, content, and children through load,
				normalization, re-encode, copy, and JSON export. Both built-in
				registry factories set <code>onUnknownBlock</code> to{" "}
				<code>"passthrough"</code>. Apply still refuses to{" "}
				<em>create</em> an unknown type — preservation is about existing
				content, not about inventing writes the schema cannot describe.
			</p>
			<p>
				A staged rollout that ships a new block type to some clients
				first survives because the others keep the bytes.
			</p>

			<h2>Evidence plan</h2>
			<p>
				Do not read this page as a claim that the full collaboration
				suite is in-tree. The scenarios below are the proof plan for the{" "}
				<code>COL</code> rules in{" "}
				<code>spec/rules/collaboration.md</code>:
			</p>
			<table>
				<caption>
					These scenarios are the evidence plan, not a report of
					in-tree passes.
				</caption>
				<thead>
					<tr>
						<th>Step</th>
						<th>Rule</th>
						<th>Planned evidence</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>C.1</td>
						<td>COL1</td>
						<td>
							Two-peer: remote edit arrives as{" "}
							<code>origin: "collaborator"</code>, stays out of
							the local undo stack, and does not fire local-edit
							paths
						</td>
					</tr>
					<tr>
						<td>C.2</td>
						<td>COL2</td>
						<td>
							Hostile presence (oversize, wrong type,
							script-bearing, nonexistent block) does not break
							rendering
						</td>
					</tr>
					<tr>
						<td>C.3</td>
						<td>COL3</td>
						<td>
							Attribution uses the host resolver (or an opaque
							client handle), never a peer-asserted name as
							verified identity
						</td>
					</tr>
					<tr>
						<td>C.4</td>
						<td>COL4</td>
						<td>
							Two-peer harness; concurrent split, move, cycle,
							list, and table rows converge; cycles break
							deterministically
						</td>
					</tr>
				</tbody>
			</table>
		</>
	);
}
