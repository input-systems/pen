import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadAllowlistEntries } from "./allowlistLint.js";
import { posixFilename, REPO_ROOT, repoRelativeFilename } from "./lintPaths.js";

/**
 * API4 (`spec/rules/api.md`): no `@input/pen-*` import through `/src/`,
 * `/dist/`, or an unpublished subpath.
 */

const ALLOWLIST_PATH = "scripts/pen-deep-imports-allowlist.json";

const ESCAPE_HATCH_RE = /\/(?:src|dist)(?:\/|$)/;
const SKIP_DIRS = new Set([
	"node_modules",
	"dist",
	"coverage",
	".turbo",
	".git",
]);

function publishedExportKeys(manifest) {
	const keys = new Set();
	const exportsField = manifest.exports;
	if (exportsField == null || typeof exportsField === "string") {
		keys.add(".");
		return keys;
	}
	if (typeof exportsField !== "object" || Array.isArray(exportsField)) {
		keys.add(".");
		return keys;
	}
	for (const key of Object.keys(exportsField)) {
		keys.add(key);
	}
	if (keys.size === 0) {
		keys.add(".");
	}
	return keys;
}

function collectPackageJsonFiles(directory, files) {
	let entries;
	try {
		entries = readdirSync(directory, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			if (!SKIP_DIRS.has(entry.name)) {
				collectPackageJsonFiles(entryPath, files);
			}
			continue;
		}
		if (entry.isFile() && entry.name === "package.json") {
			files.push(entryPath);
		}
	}
}

function loadWorkspacePackages(repoRoot) {
	const files = [];
	collectPackageJsonFiles(path.join(repoRoot, "packages"), files);
	const exports = new Map();
	for (const filePath of files) {
		let manifest;
		try {
			manifest = JSON.parse(readFileSync(filePath, "utf8"));
		} catch {
			continue;
		}
		if (
			typeof manifest.name !== "string" ||
			!manifest.name.startsWith("@input/pen-")
		) {
			continue;
		}
		exports.set(manifest.name, publishedExportKeys(manifest));
	}
	const names = [...exports.keys()].sort(
		(left, right) => right.length - left.length,
	);
	return { names, exports };
}

function resolvePackageName(specifier, packageNames) {
	for (const name of packageNames) {
		if (specifier === name || specifier.startsWith(`${name}/`)) {
			return name;
		}
	}
	return null;
}

function exportKeyForSpecifier(packageName, specifier) {
	if (specifier === packageName) {
		return ".";
	}
	return `.${specifier.slice(packageName.length)}`;
}

function matchesExportKey(exportKey, publishedKeys) {
	if (publishedKeys.has(exportKey)) {
		return true;
	}
	for (const key of publishedKeys) {
		if (!key.includes("*")) {
			continue;
		}
		const pattern = key
			.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
			.replaceAll("*", ".*");
		if (new RegExp(`^${pattern}$`).test(exportKey)) {
			return true;
		}
	}
	return false;
}

export function isDeepImport(specifier, packages) {
	if (typeof specifier !== "string" || !specifier.startsWith("@input/pen-")) {
		return false;
	}
	if (ESCAPE_HATCH_RE.test(specifier)) {
		return true;
	}
	const packageName = resolvePackageName(specifier, packages.names);
	if (!packageName) {
		return /^@input\/pen-[^/]+\//.test(specifier);
	}
	if (specifier === packageName) {
		return false;
	}
	const exportKey = exportKeyForSpecifier(packageName, specifier);
	const publishedKeys = packages.exports.get(packageName) ?? new Set(["."]);
	return !matchesExportKey(exportKey, publishedKeys);
}

const committedAllowlist = loadAllowlistEntries(ALLOWLIST_PATH);
const workspacePackages = loadWorkspacePackages(REPO_ROOT);

function specifierFromNode(node) {
	if (!node) {
		return null;
	}
	if (node.type === "Literal" && typeof node.value === "string") {
		return node.value;
	}
	if (
		node.type === "TemplateLiteral" &&
		node.expressions.length === 0 &&
		node.quasis.length === 1
	) {
		return node.quasis[0].value.cooked;
	}
	return null;
}

export const noPenDeepImports = {
	meta: {
		type: "problem",
		docs: {
			description:
				"Ban @input/pen-* imports through /src/, /dist/, or unpublished subpaths",
			specRule: "API4",
		},
		schema: [
			{
				type: "object",
				properties: {
					allowlist: { type: "array" },
					packages: { type: "object" },
				},
				additionalProperties: false,
			},
		],
		messages: {
			deep: "`{{specifier}}` is not a published `@input/pen-*` export (API4). Import a documented subpath, not `/src/` or `/dist/`.",
			unusedAllowlist:
				"API4 allowlist entry for `{{specifier}}` in {{file}} was not consumed. Remove it in the same change that deleted the import.",
		},
	},
	create(context) {
		const filename = context.filename ?? context.getFilename();
		const relative = repoRelativeFilename(filename);
		const allowlist = context.options[0]?.allowlist ?? committedAllowlist;
		const packages = context.options[0]?.packages
			? {
					names: context.options[0].packages.names,
					exports: new Map(
						Object.entries(context.options[0].packages.exports).map(
							([name, keys]) => [name, new Set(keys)],
						),
					),
				}
			: workspacePackages;
		const slots = allowlist
			.filter(
				(entry) =>
					entry &&
					typeof entry.file === "string" &&
					typeof entry.specifier === "string" &&
					posixFilename(entry.file) === relative,
			)
			.map((entry) => ({ ...entry, used: false }));

		function consume(specifier) {
			const slot = slots.find((entry) => entry.specifier === specifier);
			if (!slot) {
				return false;
			}
			slot.used = true;
			return true;
		}

		function checkSpecifier(node, specifier) {
			if (!isDeepImport(specifier, packages)) {
				return;
			}
			if (consume(specifier)) {
				return;
			}
			context.report({
				node,
				messageId: "deep",
				data: { specifier },
			});
		}

		return {
			"Program:exit"() {
				for (const slot of slots) {
					if (!slot.used) {
						context.report({
							loc: { line: 1, column: 0 },
							messageId: "unusedAllowlist",
							data: {
								file: slot.file,
								specifier: slot.specifier,
							},
						});
					}
				}
			},
			ImportDeclaration(node) {
				const specifier = specifierFromNode(node.source);
				if (specifier) {
					checkSpecifier(node.source, specifier);
				}
			},
			ExportNamedDeclaration(node) {
				const specifier = specifierFromNode(node.source);
				if (specifier) {
					checkSpecifier(node.source, specifier);
				}
			},
			ExportAllDeclaration(node) {
				const specifier = specifierFromNode(node.source);
				if (specifier) {
					checkSpecifier(node.source, specifier);
				}
			},
			ImportExpression(node) {
				const specifier = specifierFromNode(node.source);
				if (specifier) {
					checkSpecifier(node.source, specifier);
				}
			},
			CallExpression(node) {
				if (
					node.callee.type !== "Identifier" ||
					node.callee.name !== "require" ||
					node.arguments.length === 0
				) {
					return;
				}
				const specifier = specifierFromNode(node.arguments[0]);
				if (specifier) {
					checkSpecifier(node.arguments[0], specifier);
				}
			},
		};
	},
};
