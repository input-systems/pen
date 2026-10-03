import fs from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(
	path.dirname(new URL(import.meta.url).pathname),
	"..",
);
const packagesRoot = path.join(repoRoot, "packages");
// The owner must match the repository the release workflow runs in: npm
// rejects a provenance publish whose repository.url names a different repo.
const repoHomepage = "https://github.com/input-systems/pen#readme";
const repoBugsUrl = "https://github.com/input-systems/pen/issues";
const repoUrl = "https://github.com/input-systems/pen.git";
const licenseValue = "MIT";
// HOST3: one engines.node value on every published package.
// CI (.github/workflows/ci.yml, release.yml, docs.yml) pins setup-node to 22.
// HOST4's Node-reachable bare APIs are older — Object.hasOwn 16.9.0,
// Array.prototype.at 16.6.0 — and E.5 marks both as trivially replaceable.
// Claiming 16.9.0 as the floor would be an unverified range (API7). The
// declared floor is therefore the CI-verified major, not the theoretical
// API minimum, narrowed to the range jsdom 30 declares: @input/pen-interop
// sanitizes through isomorphic-dompurify, which builds its Node window with
// jsdom, and @input/pen, -react, and -vue depend on interop. Matrix
// endpoints live in .github/workflows/node-matrix.yml.
const NODE_ENGINE = "^22.22.2 || ^24.15.0 || >=26.0.0";
const IGNORE_DIR_NAMES = new Set([
	"node_modules",
	"dist",
	"coverage",
	".turbo",
	".git",
	"playwright-report",
	"test-results",
]);

const args = parseArgs(process.argv.slice(2));
runSelfTest();
if (args.check) {
	console.log(
		"package-metadata self-test ok (drifted repository.url and missing engines fail closed; sideEffects and extra files are copied through)",
	);
}

const rootLicense = await fs.readFile(
	path.join(repoRoot, "LICENSE.md"),
	"utf8",
);

const published = await loadPublishedPackages();
if (published.length === 0) {
	console.error("No published packages found under packages/.");
	process.exit(1);
}

if (args.check) {
	const result = await checkPublishedPackages(published, rootLicense);
	const report = formatCheckReport(result);
	if (result.drifted.length > 0) {
		console.error(report);
		process.exit(1);
	}
	console.log(report);
	process.exit(0);
}

for (const pkg of published) {
	await writeJson(pkg.packageJsonPath, pkg.expected);
	await fs.writeFile(path.join(pkg.packageRoot, "LICENSE.md"), rootLicense);
}

function parseArgs(argv) {
	let check = false;
	for (const arg of argv) {
		if (arg === "--check") {
			check = true;
			continue;
		}
		console.error(`Unknown flag: ${arg}`);
		console.error("Usage: node sync-package-metadata.mjs [--check]");
		process.exit(1);
	}
	return { check };
}

async function loadPublishedPackages() {
	const packageJsonPaths = await collectPackageJsonPaths(packagesRoot);
	const published = [];

	for (const packageJsonPath of packageJsonPaths) {
		const packageRoot = path.dirname(packageJsonPath);
		const packageDirectory = path
			.relative(repoRoot, packageRoot)
			.split(path.sep)
			.join(path.posix.sep);
		const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));

		if (packageJson.private === true) {
			continue;
		}

		const readmePath = path.join(packageRoot, "README.md");
		const expected = buildPublicPackageManifest(
			packageJson,
			packageDirectory,
			{
				hasReadme: await exists(readmePath),
			},
		);
		published.push({
			name: typeof packageJson.name === "string" ? packageJson.name : packageDirectory,
			packageJsonPath,
			packageRoot,
			packageDirectory,
			packageJson,
			expected,
		});
	}

	published.sort((left, right) => left.name.localeCompare(right.name));
	return published;
}

async function checkPublishedPackages(packages, licenseText) {
	const drifted = [];

	for (const pkg of packages) {
		const diffs = diffFields(pkg.packageJson, pkg.expected);
		const licenseDiff = await diffLicense(pkg.packageRoot, licenseText);
		if (licenseDiff != null) {
			diffs.push(licenseDiff);
		}
		if (diffs.length > 0) {
			drifted.push({ name: pkg.name, diffs });
		}
	}

	return { checked: packages.length, drifted };
}

async function diffLicense(packageRoot, licenseText) {
	const licensePath = path.join(packageRoot, "LICENSE.md");
	try {
		const onDisk = await fs.readFile(licensePath, "utf8");
		if (onDisk !== licenseText) {
			return {
				field: "LICENSE.md",
				onDisk: "<differs from root LICENSE.md>",
				expected: "<root LICENSE.md>",
			};
		}
	} catch (error) {
		if (error && error.code === "ENOENT") {
			return {
				field: "LICENSE.md",
				onDisk: undefined,
				expected: "<root LICENSE.md>",
			};
		}
		throw error;
	}
	return null;
}

function formatCheckReport(result) {
	const lines = [
		`Published package metadata: ${result.checked} package${result.checked === 1 ? "" : "s"}.`,
	];
	if (result.drifted.length === 0) {
		lines.push(
			`OK: all ${result.checked} published package.json files and LICENSE.md copies match sync-package-metadata.mjs.`,
		);
		return lines.join("\n");
	}

	lines.push("");
	lines.push(
		`Drift in ${result.drifted.length} package${result.drifted.length === 1 ? "" : "s"}:`,
	);
	for (const pkg of result.drifted) {
		lines.push("");
		lines.push(pkg.name);
		for (const diff of pkg.diffs) {
			lines.push(
				`  ${diff.field}: on-disk ${formatValue(diff.onDisk)} expected ${formatValue(diff.expected)}`,
			);
		}
	}
	lines.push("");
	lines.push("Run `pnpm sync:package-metadata` to rewrite, or fix the field by hand.");
	return lines.join("\n");
}

function formatValue(value) {
	if (value === undefined) {
		return "<missing>";
	}
	return JSON.stringify(value);
}

function isPlainObject(value) {
	return value != null && typeof value === "object" && !Array.isArray(value);
}

function fieldPath(prefix, key) {
	const segment = /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
		? key
		: `[${JSON.stringify(key)}]`;
	if (prefix.length === 0) {
		return segment;
	}
	return segment.startsWith("[") ? `${prefix}${segment}` : `${prefix}.${segment}`;
}

function valuesEqual(left, right) {
	if (left === right) {
		return true;
	}
	if (left == null || right == null) {
		return left === right;
	}
	if (typeof left !== "object" || typeof right !== "object") {
		return left === right;
	}
	return JSON.stringify(left) === JSON.stringify(right);
}

function diffFields(actual, expected, prefix = "") {
	if (valuesEqual(actual, expected)) {
		return [];
	}

	if (isPlainObject(actual) && isPlainObject(expected)) {
		const diffs = [];
		const keys = [...new Set([...Object.keys(actual), ...Object.keys(expected)])].sort();
		for (const key of keys) {
			const field = fieldPath(prefix, key);
			const hasActual = Object.hasOwn(actual, key);
			const hasExpected = Object.hasOwn(expected, key);
			if (!hasActual) {
				diffs.push({ field, onDisk: undefined, expected: expected[key] });
				continue;
			}
			if (!hasExpected) {
				diffs.push({ field, onDisk: actual[key], expected: undefined });
				continue;
			}
			diffs.push(...diffFields(actual[key], expected[key], field));
		}
		return diffs;
	}

	return [{ field: prefix.length === 0 ? "<root>" : prefix, onDisk: actual, expected }];
}

function runSelfTest() {
	const matching = buildPublicPackageManifest(
		{
			name: "@input/pen-fixture",
			version: "0.0.1",
			license: licenseValue,
			homepage: repoHomepage,
			bugs: { url: repoBugsUrl },
			repository: {
				type: "git",
				url: repoUrl,
				directory: "packages/fixture",
			},
			publishConfig: {
				access: "public",
				registry: "https://registry.npmjs.org/",
			},
			files: ["dist", "LICENSE.md"],
			engines: { node: NODE_ENGINE },
			sideEffects: false,
		},
		"packages/fixture",
		{ hasReadme: false },
	);

	const cleanDiffs = diffFields(matching, matching);
	if (cleanDiffs.length !== 0) {
		throw new Error("self-test: matching manifest must be clean");
	}

	const driftedUrl = {
		...matching,
		repository: {
			...matching.repository,
			url: "https://github.com/someone-else/pen.git",
		},
	};
	const urlDiffs = diffFields(driftedUrl, matching);
	if (!urlDiffs.some((diff) => diff.field === "repository.url")) {
		throw new Error("self-test: drifted repository.url must be named");
	}

	const { engines: _engines, ...missingEngines } = matching;
	const engineDiffs = diffFields(missingEngines, matching);
	if (
		!engineDiffs.some(
			(diff) => diff.field === "engines" || diff.field === "engines.node",
		)
	) {
		throw new Error("self-test: missing engines.node must be named");
	}

	const sideEffectsTrue = { ...matching, sideEffects: true };
	const expectedSideEffects = buildPublicPackageManifest(
		sideEffectsTrue,
		"packages/fixture",
		{ hasReadme: false },
	);
	if (expectedSideEffects.sideEffects !== true) {
		throw new Error("self-test: sideEffects must be copied through");
	}
	if (diffFields(sideEffectsTrue, expectedSideEffects).length !== 0) {
		throw new Error("self-test: honest sideEffects variation must not be drift");
	}

	const extraFiles = {
		...matching,
		files: ["dist", "LICENSE.md", "FIDELITY.md"],
	};
	const expectedFiles = buildPublicPackageManifest(
		extraFiles,
		"packages/fixture",
		{ hasReadme: false },
	);
	if (!expectedFiles.files.includes("FIDELITY.md")) {
		throw new Error("self-test: extra files entries must be copied through");
	}
	if (diffFields(extraFiles, expectedFiles).length !== 0) {
		throw new Error("self-test: extra files entries must not be drift");
	}

	if (!IGNORE_DIR_NAMES.has("node_modules") || !IGNORE_DIR_NAMES.has("dist")) {
		throw new Error(
			"self-test: walker must skip node_modules and dist (write mode has already stamped a Vite prebundle)",
		);
	}

	const withExports = buildPublicPackageManifest(
		{
			...matching,
			exports: {
				".": {
					import: {
						types: "./dist/index.d.ts",
						default: "./dist/index.mjs",
					},
					require: {
						types: "./dist/index.d.cts",
						default: "./dist/index.cjs",
					},
				},
			},
		},
		"packages/fixture",
		{ hasReadme: false },
	);
	if (withExports.exports?.["./package.json"] !== "./package.json") {
		throw new Error(
			"self-test: every exports map must include ./package.json",
		);
	}
}

function buildPublicPackageManifest(packageJson, packageDirectory, options) {
	const files = ensureFiles(packageJson.files, options);
	const publishConfig = {
		...(packageJson.publishConfig ?? {}),
		access: "public",
		registry: "https://registry.npmjs.org/",
	};
	const exports = ensurePackageJsonExport(normalizeExports(packageJson.exports));
	const types = resolveRootTypesPath(packageJson, exports);

	const ordered = {};
	copyIfPresent(ordered, packageJson, "name");
	copyIfPresent(ordered, packageJson, "version");
	copyIfPresent(ordered, packageJson, "description");
	ordered.license = licenseValue;
	ordered.homepage = repoHomepage;
	ordered.bugs = { url: repoBugsUrl };
	ordered.repository = {
		type: "git",
		url: repoUrl,
		directory: packageDirectory,
	};
	copyIfPresent(ordered, packageJson, "type");
	ordered.publishConfig = publishConfig;
	if (exports != null) {
		ordered.exports = exports;
	}
	copyIfPresent(ordered, packageJson, "main");
	if (typeof packageJson.module === "string") {
		ordered.module = rewriteEsmJsToMjs(packageJson.module);
	}
	if (types != null) {
		ordered.types = types;
	}
	ordered.files = files;
	ordered.engines = { node: NODE_ENGINE };
	copyIfPresent(ordered, packageJson, "sideEffects");
	copyIfPresent(ordered, packageJson, "scripts");
	if (packageJson.dependencies) {
		ordered.dependencies = rewriteWorkspacePins(packageJson.dependencies);
	}
	if (packageJson.peerDependencies) {
		ordered.peerDependencies = rewriteWorkspacePins(
			packageJson.peerDependencies,
		);
	}
	copyIfPresent(ordered, packageJson, "peerDependenciesMeta");
	copyIfPresent(ordered, packageJson, "devDependencies");

	for (const [key, value] of Object.entries(packageJson)) {
		if (!(key in ordered)) {
			ordered[key] = value;
		}
	}

	return ordered;
}

function ensureFiles(existingFiles, options) {
	const files = Array.isArray(existingFiles)
		? existingFiles.filter((entry) => entry !== "src")
		: [];
	const requiredEntries = [
		"dist",
		"LICENSE.md",
		...(options?.hasReadme ? ["README.md"] : []),
	];
	for (const entry of requiredEntries) {
		if (!files.includes(entry)) {
			files.push(entry);
		}
	}
	return files;
}

function copyIfPresent(target, source, key) {
	if (key in source) {
		target[key] = source[key];
	}
}

async function collectPackageJsonPaths(directory) {
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

async function exists(targetPath) {
	try {
		await fs.access(targetPath);
		return true;
	} catch {
		return false;
	}
}

async function writeJson(targetPath, data) {
	await fs.writeFile(targetPath, `${JSON.stringify(data, null, 2)}\n`);
}

function normalizeExports(exportsField) {
	if (
		!exportsField ||
		typeof exportsField !== "object" ||
		Array.isArray(exportsField)
	) {
		return exportsField;
	}

	return Object.fromEntries(
		Object.entries(exportsField).map(([exportPath, exportValue]) => [
			exportPath,
			normalizeExportValue(exportValue),
		]),
	);
}

function ensurePackageJsonExport(exportsField) {
	if (
		!exportsField ||
		typeof exportsField !== "object" ||
		Array.isArray(exportsField)
	) {
		return exportsField;
	}
	return {
		...exportsField,
		"./package.json": "./package.json",
	};
}

function normalizeExportValue(exportValue) {
	if (
		!exportValue ||
		typeof exportValue !== "object" ||
		Array.isArray(exportValue)
	) {
		return exportValue;
	}

	const nextValue = { ...exportValue };
	if ("import" in nextValue) {
		nextValue.import = normalizeModuleCondition(nextValue.import, "esm");
	}
	if ("require" in nextValue) {
		nextValue.require = normalizeModuleCondition(nextValue.require, "cjs");
	}
	if ("default" in nextValue && typeof nextValue.default === "string") {
		nextValue.types = resolveDeclarationPath(nextValue.default, "esm");
	}
	return nextValue;
}

function rewriteWorkspacePins(deps) {
	return Object.fromEntries(
		Object.entries(deps).map(([name, spec]) => [
			name,
			spec === "workspace:*" ? "workspace:^" : spec,
		]),
	);
}

function rewriteEsmJsToMjs(value) {
	if (typeof value !== "string") {
		return value;
	}
	if (value.endsWith("/dist/index.js") && !value.endsWith(".mjs")) {
		return `${value.slice(0, -3)}.mjs`;
	}
	return value;
}

function normalizeModuleCondition(conditionValue, format) {
	if (
		!conditionValue ||
		typeof conditionValue !== "object" ||
		Array.isArray(conditionValue)
	) {
		return conditionValue;
	}

	const nextValue = { ...conditionValue };
	if (format === "esm" && typeof nextValue.default === "string") {
		nextValue.default = rewriteEsmJsToMjs(nextValue.default);
	}
	const declarationSource =
		typeof nextValue.default === "string"
			? nextValue.default
			: typeof nextValue.types === "string"
				? nextValue.types
				: null;
	if (declarationSource) {
		nextValue.types = resolveDeclarationPath(declarationSource, format);
	}
	return nextValue;
}

function resolveRootTypesPath(packageJson, exportsField) {
	if (typeof packageJson.types === "string") {
		return resolveDeclarationPath(packageJson.types, "esm");
	}
	const rootImportDefault = exportsField?.["."]?.import?.default;
	if (typeof rootImportDefault === "string") {
		return resolveDeclarationPath(rootImportDefault, "esm");
	}
	return undefined;
}

function resolveDeclarationPath(value, format) {
	if (typeof value !== "string") {
		return value;
	}
	if (value.includes("/dist/")) {
		return value
			.replace(/\.mjs$/, ".d.ts")
			.replace(/\.cjs$/, ".d.cts")
			.replace(/\.js$/, format === "cjs" ? ".d.cts" : ".d.ts");
	}
	return value
		.replace("/src/", "/dist/")
		.replace(/\.tsx?$/, format === "cjs" ? ".d.cts" : ".d.ts");
}
