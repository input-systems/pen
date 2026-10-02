export function SupportPage() {
	return (
		<>
			<h1>Browser and Node support</h1>
			<p>
				This is the HOST3 runtime floor in{" "}
				<code>spec/rules/host.md</code>. Package manifests declare{" "}
				<code>engines.node: &quot;^22.22.2 || ^24.15.0 || &gt;=26.0.0&quot;</code>. The same table
				is in the repository root README. Raising the floor is a
				minor-version change. Lowering it is never silent.
			</p>
			<table>
				<caption>
					Input backend is the field-editor path for that browser.
					Expanded field-editor mode and table-cell editing always use
					contenteditable, even when EditContext exists.
				</caption>
				<thead>
					<tr>
						<th>Runtime</th>
						<th>Minimum</th>
						<th>Input backend</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>Node</td>
						<td>
							<code>&gt;=22</code>
						</td>
						<td>n/a (headless)</td>
					</tr>
					<tr>
						<td>Chromium</td>
						<td>93</td>
						<td>
							contenteditable on 93–120; EditContext when{" "}
							<code>EditContext</code> is a function (Chromium
							121+)
						</td>
					</tr>
					<tr>
						<td>Firefox</td>
						<td>92</td>
						<td>contenteditable</td>
					</tr>
					<tr>
						<td>Safari / WebKit</td>
						<td>15.4</td>
						<td>contenteditable</td>
					</tr>
				</tbody>
			</table>
			<p>
				APIs newer than that floor — EditContext,{" "}
				<code>structuredClone</code>, <code>ResizeObserver</code>,{" "}
				<code>color-mix()</code>, <code>crypto.randomUUID</code>,{" "}
				<code>Intl.Segmenter</code> — are feature-detected with a
				defined fallback. A missing UUID API degrades ID quality, not
				the ability to construct an editor. Non-secure origins ( plain{" "}
				<code>http://</code> on a LAN IP) construct an editor.
			</p>
			<p>
				<code>@input/pen-react</code> peers are React 18 or 19.{" "}
				<code>@input/pen-vue</code> peers Vue <code>^3.4.0</code>. There
				is no polyfill bundle. Hosts that must run below the floor bring
				their own polyfills.
			</p>
			<p>
				SSR is shell-only. See <a href="#/ssr">Server rendering</a>.
			</p>
		</>
	);
}
