export function UpgradePage() {
	return (
		<>
			<h1>Upgrade guides</h1>
			<p>
				Pen <code>0.1.0</code> will be the first published release.
				There is nothing on the registry to upgrade from, so this
				repository carries no migration guide. If
				you are assembling Pen for the first time, start at{" "}
				<a href="#/getting-started">Getting started</a>.
			</p>

			<h2>Versioning</h2>
			<p>
				Pen is on a <code>0.x</code> train. A breaking change is
				released as a <strong>minor</strong> and an additive change as a{" "}
				<strong>patch</strong>; there is no <code>major</code> bump
				before <code>1.0</code>. Pin an exact minor if you need
				stability, because a minor may break you by design.
			</p>
			<p>
				Every published package carries a generated{" "}
				<code>CHANGELOG.md</code>, written by changesets and committed
				with the release, and every release train is tagged. Read the
				changelog of the package you pin rather than the repository
				commit log.
			</p>

			<h2>Support</h2>
			<p>
				Security fixes land on the latest published <code>0.x</code>{" "}
				minor. How to report a vulnerability is in{" "}
				<code>SECURITY.md</code>. See also{" "}
				<a href="#/security">Security for embedders</a>.
			</p>
			<p>
				The release, changelog, and support rules on this page are
				DOC6 in <code>spec/rules/documentation.md</code>.
			</p>
		</>
	);
}
