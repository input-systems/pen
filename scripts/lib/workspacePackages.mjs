/**
 * Workspace manifest discovery shared by the package gates (core-clean-install,
 * dag-check, readme-sections, release-check, sync-package-metadata,
 * workspace-pins).
 */

import fs from "node:fs/promises";
import path from "node:path";

const IGNORE_DIR_NAMES = new Set([
	"node_modules",
	"dist",
	"coverage",
	".turbo",
	".git",
	"playwright-report",
	"test-results",
]);

/** Every `package.json` under `directory`, skipping build and tool output. */
export async function collectPackageJsonPaths(directory) {
	const entries = await fs.readdir(directory, { withFileTypes: true });
	const packageJsonPaths = [];

	for (const entry of entries) {
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			if (!IGNORE_DIR_NAMES.has(entry.name)) {
				packageJsonPaths.push(
					...(await collectPackageJsonPaths(entryPath)),
				);
			}
			continue;
		}
		if (entry.isFile() && entry.name === "package.json") {
			packageJsonPaths.push(entryPath);
		}
	}

	return packageJsonPaths;
}

/**
 * Every published package under `packages/` (not private, named), sorted by
 * name: `{ name, dir, packageJsonPath, packageJson }` with `dir` the
 * repo-relative POSIX directory.
 */
export async function loadPublishedManifests(repoRoot) {
	const packageJsonPaths = await collectPackageJsonPaths(
		path.join(repoRoot, "packages"),
	);
	const packages = [];

	for (const packageJsonPath of packageJsonPaths) {
		const packageJson = JSON.parse(
			await fs.readFile(packageJsonPath, "utf8"),
		);
		if (
			packageJson.private === true ||
			typeof packageJson.name !== "string"
		) {
			continue;
		}
		const dir = path
			.relative(repoRoot, path.dirname(packageJsonPath))
			.split(path.sep)
			.join(path.posix.sep);
		packages.push({
			name: packageJson.name,
			dir,
			packageJsonPath,
			packageJson,
		});
	}

	packages.sort((left, right) => left.name.localeCompare(right.name));
	return packages;
}
