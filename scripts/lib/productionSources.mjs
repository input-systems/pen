/**
 * Production source listing shared by the AST gates
 * (overlay-measure-free, selection-origin-check): every file under `root`
 * whose name matches `extension`, minus `.d.ts`, `__tests__/` and
 * `*.test.*` / `*.spec.*`, as repo-relative POSIX paths. A missing root
 * throws unless `allowMissingRoot` is set.
 */

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

function isTestFile(file) {
	return (
		/(^|\/)__tests__\//.test(file) ||
		/\.(test|spec)\.[cm]?[jt]sx?$/.test(file)
	);
}

export function listProductionSources(
	repoRoot,
	root,
	extension,
	{ allowMissingRoot = false } = {},
) {
	const files = [];
	const walk = (dir) => {
		if (allowMissingRoot && !existsSync(dir)) {
			return;
		}
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full);
			} else if (
				extension.test(entry.name) &&
				!entry.name.endsWith(".d.ts")
			) {
				files.push(full);
			}
		}
	};
	walk(path.join(repoRoot, root));
	return files
		.map((file) => path.relative(repoRoot, file).replace(/\\/g, "/"))
		.filter((file) => !isTestFile(file));
}
