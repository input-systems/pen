/**
 * API2 helpers for `core-clean-install.mjs`: which third-party peers a
 * consumer of `@input/pen-core` must install, and whether a source entry
 * reaches a module specifier through relative imports.
 */

import path from "node:path";

const WORKSPACE_SCOPE = "@input/pen-";

/** Required (non-optional) peers outside the workspace scope. */
export function requiredThirdPartyPeers(packageJson) {
	const optional = packageJson.peerDependenciesMeta ?? {};
	return Object.keys(packageJson.peerDependencies ?? {}).filter(
		(name) =>
			!name.startsWith(WORKSPACE_SCOPE) && optional[name]?.optional !== true,
	);
}

/** Union of required third-party peers across the closure, sorted. */
export function closureThirdPartyPeers(packages, closureNames) {
	const names = new Set(closureNames);
	const peers = packages
		.filter((pkg) => names.has(pkg.name))
		.flatMap((pkg) => pkg.thirdPartyPeers ?? []);
	return [...new Set(peers)].sort();
}

const IMPORT_RE = /(?:from|import)\s*["']([^"']+)["']/g;
const SOURCE_EXTENSIONS = ["", ".ts", ".tsx", "/index.ts"];

function resolveRelative(fromFile, specifier, exists) {
	const base = path.posix.join(path.posix.dirname(fromFile), specifier);
	return SOURCE_EXTENSIONS.map((ext) => `${base}${ext}`).find(exists) ?? null;
}

/**
 * Walks relative imports from `entry` and returns the bare specifiers it
 * reaches. `readFile(file)` returns source text; `exists(file)` tests a path.
 */
export function reachableBareSpecifiers(entry, { readFile, exists }) {
	const seen = new Set();
	const bare = new Set();
	const queue = [entry];
	while (queue.length > 0) {
		const file = queue.shift();
		if (!seen.has(file)) {
			seen.add(file);
			queue.push(...relativeImportsOf(file, { readFile, exists, bare }));
		}
	}
	return bare;
}

/** Records bare specifiers of `file` in `bare`; returns its resolved relative imports. */
function relativeImportsOf(file, { readFile, exists, bare }) {
	const specifiers = [...readFile(file).matchAll(IMPORT_RE)].map(([, s]) => s);
	for (const specifier of specifiers.filter((s) => !s.startsWith("."))) {
		bare.add(specifier);
	}
	return specifiers
		.filter((s) => s.startsWith("."))
		.map((s) => resolveRelative(file, s, exists))
		.filter((resolved) => resolved != null);
}
