import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(
	path.dirname(new URL(import.meta.url).pathname),
	"..",
);
const EXPECTED_REPOSITORY_URL = "https://github.com/input-systems/pen.git";

// Commands this script runs. Pin later as root devDependencies if desired:
//   pnpm exec publint --pack pnpm <packageDir>
//   pnpm exec attw --pack <packageDir>
//   pnpm dlx publint --pack pnpm <packageDir>
//   pnpm dlx @arethetypeswrong/cli --pack <packageDir>
// Publish (API7): changeset publish --provenance
//   uses the workflow id-token: write grant (trusted publishing / OIDC);
//   no NPM_TOKEN.

function provenanceWorkflowProblems(workflow, rootReleaseScript) {
	const problems = [];
	if (!/id-token:\s*write/.test(workflow)) {
		problems.push(
			".github/workflows/release.yml is missing permissions.id-token: write",
		);
	}
	if (!/NPM_CONFIG_PROVENANCE:\s*true/.test(workflow)) {
		problems.push(
			".github/workflows/release.yml is missing NPM_CONFIG_PROVENANCE: true",
		);
	}
	if (
		/secrets\.NPM_TOKEN/.test(workflow) ||
		/^\s*NPM_TOKEN:/m.test(workflow)
	) {
		problems.push(
			".github/workflows/release.yml must not set NPM_TOKEN; trusted publishing uses OIDC",
		);
	}
	if (!/npm install -g npm@11\.5/.test(workflow)) {
		problems.push(
			".github/workflows/release.yml must install npm CLI >= 11.5.1 for trusted publishing",
		);
	}
	if (!/-u NODE_AUTH_TOKEN/.test(workflow)) {
		problems.push(
			".github/workflows/release.yml must unset NODE_AUTH_TOKEN around changeset publish so OIDC is not shadowed",
		);
	}
	if (/changesets\/action@\S+ # v2/.test(workflow)) {
		problems.push(
			".github/workflows/release.yml must stay on changesets/action v1 while @changesets/cli is 2.x",
		);
	}
	if (!/fetch-tags:\s*true/.test(workflow) || !/fetch-depth:\s*0/.test(workflow)) {
		problems.push(
			".github/workflows/release.yml must fetch tags (fetch-depth: 0 and fetch-tags: true) so stamp-first-train can see a v* train tag",
		);
	}
	if (
		typeof rootReleaseScript !== "string" ||
		!rootReleaseScript.includes("--provenance")
	) {
		problems.push(
			'root package.json "release" script must pass --provenance',
		);
	}
	return problems;
}

export function fixedGroupProblems(config, publishedNames) {
	const problems = [];
	const expected = [...publishedNames].sort();
	if (!Array.isArray(config.fixed) || config.fixed.length !== 1) {
		problems.push(
			".changeset/config.json must have exactly one fixed group (the release train)",
		);
		return problems;
	}
	const group = [...config.fixed[0]].sort();
	if (group.join("\0") !== expected.join("\0")) {
		const missing = expected.filter((name) => !group.includes(name));
		const extra = group.filter((name) => !expected.includes(name));
		if (missing.length > 0) {
			problems.push(
				`fixed group is missing published packages: ${missing.join(", ")}`,
			);
		}
		if (extra.length > 0) {
			problems.push(
				`fixed group lists packages that are not published: ${extra.join(", ")}`,
			);
		}
	}
	return problems;
}

function versionPackagesScriptProblems(versionPackagesScript) {
	const problems = [];
	if (
		typeof versionPackagesScript !== "string" ||
		!versionPackagesScript.includes("changeset version")
	) {
		problems.push(
			'root package.json "version-packages" must run changeset version',
		);
	}
	if (
		typeof versionPackagesScript !== "string" ||
		!versionPackagesScript.includes("stamp-first-train.mjs")
	) {
		problems.push(
			'root package.json "version-packages" must stamp the first train to 0.1.0',
		);
	}
	return problems;
}

function versionSyncGroups(packages) {
	const versions = new Map();
	for (const pkg of packages) {
		const list = versions.get(pkg.version) ?? [];
		list.push(pkg.name);
		versions.set(pkg.version, list);
	}
	return versions;
}

function runSelfTests() {
	const healthyWorkflow =
		"permissions:\n  id-token: write\nenv:\n  NPM_CONFIG_PROVENANCE: true\nrun: npm install -g npm@11.5.1\nversion-script: pnpm version-packages\npublish-script: env -u NODE_AUTH_TOKEN pnpm release\nfetch-depth: 0\nfetch-tags: true\n";
	const healthy = provenanceWorkflowProblems(
		healthyWorkflow,
		"changeset publish --provenance",
	);
	if (healthy.length !== 0) {
		throw new Error(
			`self-test: healthy provenance workflow must pass, got: ${healthy.join("; ")}`,
		);
	}

	const missingToken = provenanceWorkflowProblems(
		"env:\n  NPM_CONFIG_PROVENANCE: true\nrun: npm install -g npm@11.5.1\npublish: env -u NODE_AUTH_TOKEN pnpm release\nfetch-depth: 0\nfetch-tags: true\n",
		"changeset publish --provenance",
	);
	if (!missingToken.some((problem) => problem.includes("id-token: write"))) {
		throw new Error("self-test: missing id-token: write must fail closed");
	}

	const missingEnv = provenanceWorkflowProblems(
		"permissions:\n  id-token: write\nrun: npm install -g npm@11.5.1\npublish: env -u NODE_AUTH_TOKEN pnpm release\nfetch-depth: 0\nfetch-tags: true\n",
		"changeset publish --provenance",
	);
	if (
		!missingEnv.some((problem) => problem.includes("NPM_CONFIG_PROVENANCE"))
	) {
		throw new Error(
			"self-test: missing NPM_CONFIG_PROVENANCE must fail closed",
		);
	}

	const missingFlag = provenanceWorkflowProblems(
		healthyWorkflow,
		"changeset publish",
	);
	if (!missingFlag.some((problem) => problem.includes("--provenance"))) {
		throw new Error(
			"self-test: release script without --provenance must fail closed",
		);
	}

	const leakedToken = provenanceWorkflowProblems(
		`${healthyWorkflow}          NPM_TOKEN: \${{ secrets.NPM_TOKEN }}\n`,
		"changeset publish --provenance",
	);
	if (!leakedToken.some((problem) => problem.includes("must not set NPM_TOKEN"))) {
		throw new Error("self-test: NPM_TOKEN in the workflow must fail closed");
	}

	const missingTags = provenanceWorkflowProblems(
		"permissions:\n  id-token: write\nenv:\n  NPM_CONFIG_PROVENANCE: true\nrun: npm install -g npm@11.5.1\npublish: env -u NODE_AUTH_TOKEN pnpm release\n",
		"changeset publish --provenance",
	);
	if (!missingTags.some((problem) => problem.includes("fetch tags"))) {
		throw new Error("self-test: a checkout without tags must fail closed");
	}

	const missingNpmCli = provenanceWorkflowProblems(
		"permissions:\n  id-token: write\nenv:\n  NPM_CONFIG_PROVENANCE: true\nrun: npm install -g npm@11.0.0\npublish: env -u NODE_AUTH_TOKEN pnpm release\nfetch-depth: 0\nfetch-tags: true\n",
		"changeset publish --provenance",
	);
	if (!missingNpmCli.some((problem) => problem.includes("npm CLI"))) {
		throw new Error("self-test: missing npm 11 install must fail closed");
	}

	const actionV2 = provenanceWorkflowProblems(
		"permissions:\n  id-token: write\nenv:\n  NPM_CONFIG_PROVENANCE: true\nrun: npm install -g npm@11.5.1\nuses: changesets/action@deadbeef # v2.1.1\nversion: pnpm version-packages\npublish: env -u NODE_AUTH_TOKEN pnpm release\nfetch-depth: 0\nfetch-tags: true\n",
		"changeset publish --provenance",
	);
	if (!actionV2.some((problem) => problem.includes("changesets/action v1"))) {
		throw new Error(
			"self-test: changesets/action v2 while CLI is 2.x must fail closed",
		);
	}

	const alignedFixed = fixedGroupProblems(
		{ fixed: [["@input/pen-core", "@input/pen-types"]] },
		["@input/pen-types", "@input/pen-core"],
	);
	if (alignedFixed.length !== 0) {
		throw new Error("self-test: matching fixed group must pass");
	}

	const missingFromFixed = fixedGroupProblems(
		{ fixed: [["@input/pen-core"]] },
		["@input/pen-core", "@input/pen-types"],
	);
	if (
		!missingFromFixed.some((problem) =>
			problem.includes("@input/pen-types"),
		)
	) {
		throw new Error("self-test: a short fixed group must fail closed");
	}

	const emptyFixed = fixedGroupProblems({ fixed: [] }, ["@input/pen-core"]);
	if (
		!emptyFixed.some((problem) => problem.includes("exactly one fixed group"))
	) {
		throw new Error("self-test: an empty fixed list must fail closed");
	}

	const versionScriptOk = versionPackagesScriptProblems(
		"changeset version && node scripts/stamp-first-train.mjs",
	);
	if (versionScriptOk.length !== 0) {
		throw new Error("self-test: version-packages with the stamp must pass");
	}
	const versionScriptBare = versionPackagesScriptProblems("changeset version");
	if (
		!versionScriptBare.some((problem) =>
			problem.includes("stamp the first train"),
		)
	) {
		throw new Error("self-test: version-packages without the stamp must fail");
	}

	const split = versionSyncGroups([
		{ name: "@input/pen-core", version: "0.0.1" },
		{ name: "@input/pen-types", version: "0.0.2" },
	]);
	if (split.size !== 2) {
		throw new Error("self-test: mixed train versions must fail closed");
	}
	const aligned = versionSyncGroups([
		{ name: "@input/pen-core", version: "0.0.1" },
		{ name: "@input/pen-types", version: "0.0.1" },
	]);
	if (aligned.size !== 1) {
		throw new Error("self-test: one train version must pass");
	}

	console.log(
		"release-check self-test ok (missing id-token, NPM_CONFIG_PROVENANCE, --provenance, NPM_TOKEN, npm 11, action v2, and a short fixed group fail closed)",
	);
}

const requested = new Set(process.argv.slice(2));
const runAll = requested.size === 0;
const shouldRunVersionSync = runAll || requested.has("--version-sync");
const shouldRunPublint = runAll || requested.has("--publint");
const shouldRunAttw = runAll || requested.has("--attw");
const shouldRunProvenance =
	runAll || requested.has("--provenance-preconditions");

if (!runAll) {
	for (const flag of requested) {
		if (
			flag !== "--version-sync" &&
			flag !== "--publint" &&
			flag !== "--attw" &&
			flag !== "--provenance-preconditions"
		) {
			console.error(`Unknown flag: ${flag}`);
			console.error(
				"Usage: node scripts/release-check.mjs [--version-sync] [--publint] [--attw] [--provenance-preconditions]",
			);
			process.exit(1);
		}
	}
}

runSelfTests();

const publishedPackages = await collectPublishedPackages(
	path.join(repoRoot, "packages"),
);

if (publishedPackages.length === 0) {
	console.error("No published packages found under packages/.");
	process.exit(1);
}

let failed = false;

if (shouldRunVersionSync) {
	failed = (await checkVersionSync(publishedPackages)) || failed;
}

if (shouldRunPublint) {
	failed = (await lintPublishedPackages(publishedPackages)) || failed;
}

if (shouldRunAttw) {
	failed = (await checkPublishedPackageTypes(publishedPackages)) || failed;
}

if (shouldRunProvenance) {
	failed = (await checkProvenancePreconditions(publishedPackages)) || failed;
}

process.exit(failed ? 1 : 0);

async function checkProvenancePreconditions(packages) {
	const workflowPath = path.join(
		repoRoot,
		".github",
		"workflows",
		"release.yml",
	);
	const rootPackagePath = path.join(repoRoot, "package.json");
	const workflow = await fs.readFile(workflowPath, "utf8");
	const rootPackage = JSON.parse(await fs.readFile(rootPackagePath, "utf8"));
	const problems = provenanceWorkflowProblems(
		workflow,
		rootPackage.scripts?.release,
	);

	const urls = new Set();
	for (const pkg of packages) {
		const packageJson = JSON.parse(
			await fs.readFile(path.join(pkg.dir, "package.json"), "utf8"),
		);
		const url = packageJson.repository?.url;
		const directory = packageJson.repository?.directory;
		if (typeof url !== "string" || url.length === 0) {
			problems.push(`${pkg.name} is missing repository.url`);
		} else {
			urls.add(url);
			if (url !== EXPECTED_REPOSITORY_URL) {
				problems.push(
					`${pkg.name} repository.url is ${url}, expected ${EXPECTED_REPOSITORY_URL}`,
				);
			}
		}
		if (typeof directory !== "string" || directory.length === 0) {
			problems.push(`${pkg.name} is missing repository.directory`);
		}
	}
	if (urls.size > 1) {
		problems.push(
			`published packages do not share one repository.url: ${[...urls].join(", ")}`,
		);
	}

	const tagResult = spawnSync("git", ["tag"], {
		cwd: repoRoot,
		encoding: "utf8",
	});
	const tagCount = (tagResult.stdout ?? "")
		.split("\n")
		.filter(Boolean).length;
	const changelogPaths = await collectChangelogPaths(
		path.join(repoRoot, "packages"),
	);

	if (problems.length > 0) {
		console.error("Provenance preconditions failed:");
		for (const problem of problems) {
			console.error(`  ${problem}`);
		}
		return true;
	}

	console.log(
		`Provenance preconditions: ${packages.length} packages share ${EXPECTED_REPOSITORY_URL}; ` +
			"release.yml has id-token: write, npm 11, no NPM_TOKEN, and unsets NODE_AUTH_TOKEN; root release passes --provenance.",
	);
	console.log(
		`Provenance UNEXERCISED: ${tagCount} git tag(s), ${changelogPaths.length} packages/**/CHANGELOG.md. ` +
			"Preconditions are not a publish. The first real provenance run still has not happened.",
	);
	return false;
}

async function collectChangelogPaths(directory) {
	const entries = await fs.readdir(directory, { withFileTypes: true });
	const found = [];
	for (const entry of entries) {
		const entryPath = path.join(directory, entry.name);
		if (
			entry.isDirectory() &&
			entry.name !== "node_modules" &&
			entry.name !== "dist"
		) {
			found.push(...(await collectChangelogPaths(entryPath)));
			continue;
		}
		if (entry.isFile() && entry.name === "CHANGELOG.md") {
			found.push(entryPath);
		}
	}
	return found;
}

async function checkVersionSync(packages) {
	const versions = versionSyncGroups(packages);
	let failed = false;

	if (versions.size === 1) {
		const [version] = versions.keys();
		console.log(
			`Version-sync: ${packages.length} published packages share ${version}.`,
		);
	} else {
		console.error(
			"Version-sync failed: published packages are not on a single train version.",
		);
		for (const [version, names] of [...versions.entries()].sort()) {
			console.error(`  ${version}: ${names.join(", ")}`);
		}
		failed = true;
	}

	const changesetConfig = JSON.parse(
		await fs.readFile(path.join(repoRoot, ".changeset", "config.json"), "utf8"),
	);
	const fixedProblems = fixedGroupProblems(
		changesetConfig,
		packages.map((pkg) => pkg.name),
	);
	if (fixedProblems.length > 0) {
		console.error("Version-sync failed: the changesets fixed group is not the train.");
		for (const problem of fixedProblems) {
			console.error(`  ${problem}`);
		}
		failed = true;
	} else {
		console.log(
			`Version-sync: .changeset/config.json fixed group lists all ${packages.length} published packages.`,
		);
	}

	const rootPackage = JSON.parse(
		await fs.readFile(path.join(repoRoot, "package.json"), "utf8"),
	);
	const versionScriptProblems = versionPackagesScriptProblems(
		rootPackage.scripts?.["version-packages"],
	);
	if (versionScriptProblems.length > 0) {
		console.error("Version-sync failed: version-packages does not stamp the first train.");
		for (const problem of versionScriptProblems) {
			console.error(`  ${problem}`);
		}
		failed = true;
	}

	return failed;
}

async function lintPublishedPackages(packages) {
	let failed = false;

	for (const pkg of packages) {
		console.log(`publint: ${pkg.name}`);
		const ok = runPackageTool({
			localBin: "publint",
			dlxSpec: "publint",
			args: ["--pack", "pnpm", pkg.dir],
			cwd: repoRoot,
		});
		if (!ok) {
			failed = true;
		}
	}

	return failed;
}

// Pen resolves under node16 and bundler, not node10. Every package declares
// `engines.node: ">=22"` and ships an exports map with first-class subpaths
// (API6); a node10 resolver cannot read exports maps at all, so each subpath
// would need a duplicated `typesVersions` entry that no gate keeps in sync.
// The root entry still resolves under node10 — only subpaths do not.
async function checkPublishedPackageTypes(packages) {
	let failed = false;

	for (const pkg of packages) {
		console.log(`are-the-types-wrong: ${pkg.name}`);
		const ok = runPackageTool({
			localBin: "attw",
			dlxSpec: "@arethetypeswrong/cli",
			args: ["--pack", pkg.dir, "--profile", "node16"],
			cwd: repoRoot,
		});
		if (!ok) {
			failed = true;
		}
	}

	return failed;
}

function runPackageTool(options) {
	const localBin = path.join(
		repoRoot,
		"node_modules",
		".bin",
		options.localBin,
	);
	const result = existsSync(localBin)
		? spawnSync(localBin, options.args, spawnOptions(options.cwd))
		: spawnSync(
				"pnpm",
				["dlx", options.dlxSpec, ...options.args],
				spawnOptions(options.cwd),
			);

	if (result.error) {
		console.error(result.error.message);
		return false;
	}

	return result.status === 0;
}

function spawnOptions(cwd) {
	return {
		cwd,
		stdio: "inherit",
		env: process.env,
	};
}

async function collectPublishedPackages(packagesRoot) {
	const packageJsonPaths = await collectPackageJsonPaths(packagesRoot);
	const published = [];

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
		if (typeof packageJson.version !== "string") {
			console.error(
				`${packageJsonPath} is published but has no version.`,
			);
			process.exit(1);
		}
		published.push({
			name: packageJson.name,
			version: packageJson.version,
			dir: path.dirname(packageJsonPath),
		});
	}

	published.sort((left, right) => left.name.localeCompare(right.name));
	return published;
}

async function collectPackageJsonPaths(directory) {
	const entries = await fs.readdir(directory, { withFileTypes: true });
	const packageJsonPaths = [];

	for (const entry of entries) {
		const entryPath = path.join(directory, entry.name);

		if (entry.isDirectory()) {
			packageJsonPaths.push(
				...(await collectPackageJsonPaths(entryPath)),
			);
			continue;
		}

		if (entry.isFile() && entry.name === "package.json") {
			packageJsonPaths.push(entryPath);
		}
	}

	return packageJsonPaths;
}
