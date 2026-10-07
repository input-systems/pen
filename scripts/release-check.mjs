import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";

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
// API7: CI versions and publishes the train. --provenance is an npm flag;
// @changesets/cli 3 receives it through NPM_CONFIG_PROVENANCE instead.

function provenanceWorkflowProblems(workflow, rootReleaseScript) {
	const problems = [];
	let config;
	try {
		config = parse(workflow);
	} catch {
		return ["release.yml must be valid YAML"];
	}
	const job = config?.jobs?.release;
	const steps = job?.steps ?? [];
	const checkout = steps.find((step) =>
		step.uses?.startsWith("actions/checkout@"),
	);
	const setup = steps.find((step) => step.uses === "./.github/actions/setup");
	const action = steps.find((step) =>
		step.uses?.startsWith("changesets/action@"),
	);
	const train = steps.find(
		(step) =>
			step.id === "train" &&
			step.run === "node scripts/release-train.mjs --plan",
	);
	const build = steps.find((step) => step.run === "pnpm build");
	const publish = steps.find((step) => step.run?.startsWith("pnpm release"));
	const prepare = steps.find((step) => step.id === "prepare");
	const finish = steps.find(
		(step) => step.run === "node scripts/release-train.mjs --finish",
	);
	const githubRelease = steps.find(
		(step) =>
			step.run === "node scripts/release-train.mjs --github-release",
	);
	const require = (condition, message) => {
		if (!condition) problems.push(message);
	};
	require(config?.on?.push?.branches?.length === 1 &&
		config.on.push.branches[0] === "main" &&
		!Object.keys(config.on).some(
			(event) => event !== "push" && event !== "workflow_dispatch",
		), "release.yml must run only on main pushes or manual recovery");
	require(job?.if?.includes("github.ref == 'refs/heads/main'") &&
		job.if.includes(
			"github.repository == 'input-systems/pen'",
		), "release job must restrict manual dispatch to main in input-systems/pen");
	for (const permission of ["contents", "pull-requests", "id-token"]) {
		require(job?.permissions?.[permission] ===
			"write", `release job must grant ${permission}: write`);
	}
	require(config?.concurrency?.queue === "max" &&
		config.concurrency["cancel-in-progress"] ===
			false, "release concurrency must queue pending releases without cancelling them");
	require(checkout?.with?.["fetch-depth"] === 0 &&
		checkout.with["fetch-tags"] ===
			true, "release checkout must fetch tags and full history");
	require(setup?.with?.["registry-url"] ===
		"https://registry.npmjs.org", "release toolchain must configure the npm registry-url");
	require(!setup?.with?.[
		"turbo-cache-scope"
	], "release artifacts must be built without a restored Turbo cache");
	require(action?.uses ===
		"changesets/action@ae32849d5ba541f9ae29e40e22a623bc13562f51", "release.yml must use pinned changesets/action v2 with CLI 3");
	require(action?.with?.["github-token"] ===
		"${{ github.token }}", "Changesets must use the built-in github-token input");
	require(action?.with?.["version-script"] ===
		"pnpm version-packages", "Changesets must pass version-script: pnpm version-packages");
	require(action?.with?.["publish-script"] ===
		"pnpm release", "Changesets publish-script must describe automatic publishing in the version PR");
	require(action?.if ===
		"steps.prepare.outputs.current == 'true'", "Changesets must only prepare a PR from the current main commit");
	require(prepare?.if === "steps.train.outputs.has-changesets == 'true'" &&
		prepare.run?.includes(
			"git ls-remote --exit-code origin refs/heads/main",
		) &&
		prepare.run.includes(
			'"${remote_head%%[[:space:]]*}" == "$GITHUB_SHA"',
		), "PR preparation must check pending changesets against the live main commit");
	require(publish?.if ===
		"steps.train.outputs.publish == 'true'", "npm publishing must run pnpm release only for a version commit");
	require(publish?.run === 'pnpm release --no-git-tag --tag "$NPM_TAG"' &&
		publish.env?.NPM_TAG ===
			"${{ steps.train.outputs.npm-tag }}", "npm publishing must pass the planned npm tag through NPM_TAG");
	require(build !== undefined &&
		(build.if === undefined ||
			build.if ===
				publish?.if), "release job must build the version commit whenever it publishes");
	require(publish?.env?.NODE_AUTH_TOKEN ===
		"${{ secrets.NPM_TOKEN }}", "npm publishing must authenticate with NODE_AUTH_TOKEN from secrets.NPM_TOKEN");
	require(String(publish?.env?.NPM_CONFIG_PROVENANCE) ===
		"true", "npm publishing must set NPM_CONFIG_PROVENANCE: true");
	require(!config?.env?.NODE_AUTH_TOKEN &&
		!job?.env?.NODE_AUTH_TOKEN &&
		!action?.env
			?.NODE_AUTH_TOKEN, "NODE_AUTH_TOKEN must stay scoped to release steps");
	require(action?.with?.["push-git-tags"] === false &&
		action.with["create-github-releases"] ===
			false, "Changesets must defer git tags until the entire npm train is verified");
	require(train !==
		undefined, "release job must identify the version commit before publishing");
	require(finish?.if ===
		"steps.train.outputs.publish == 'true'", "release job must verify and finish tags even when a retry publishes nothing");
	require(githubRelease?.if === "steps.train.outputs.publish == 'true'" &&
		githubRelease.env?.GH_TOKEN ===
			"${{ github.token }}", "release job must publish the train's GitHub release with the built-in token");
	const order = [
		train,
		build,
		publish,
		finish,
		githubRelease,
		prepare,
		action,
	].map((step) => steps.indexOf(step));
	require(order.every(
		(index, position) =>
			index !== -1 && (position === 0 || order[position - 1] < index),
	), "release job must plan, build, publish, and finish the train before preparing remaining changesets");
	if (
		typeof rootReleaseScript !== "string" ||
		!/\bchangeset publish\b/.test(rootReleaseScript)
	) {
		problems.push(
			'root package.json "release" script must run changeset publish',
		);
	}
	if (
		typeof rootReleaseScript === "string" &&
		rootReleaseScript.includes("--provenance")
	) {
		problems.push(
			'root package.json "release" script must not pass --provenance; @changesets/cli 3 rejects it',
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
	const healthyConfig = {
		on: { push: { branches: ["main"] }, workflow_dispatch: null },
		concurrency: {
			group: "release-main",
			queue: "max",
			"cancel-in-progress": false,
		},
		jobs: {
			release: {
				if: "github.ref == 'refs/heads/main' && github.repository == 'input-systems/pen'",
				permissions: {
					contents: "write",
					"pull-requests": "write",
					"id-token": "write",
				},
				steps: [
					{
						uses: "actions/checkout@v7",
						with: { "fetch-depth": 0, "fetch-tags": true },
					},
					{
						uses: "./.github/actions/setup",
						with: { "registry-url": "https://registry.npmjs.org" },
					},
					{
						id: "train",
						run: "node scripts/release-train.mjs --plan",
					},
					{
						if: "steps.train.outputs.publish == 'true'",
						run: "pnpm build",
					},
					{
						if: "steps.train.outputs.publish == 'true'",
						run: 'pnpm release --no-git-tag --tag "$NPM_TAG"',
						env: {
							NODE_AUTH_TOKEN: "${{ secrets.NPM_TOKEN }}",
							NPM_CONFIG_PROVENANCE: "true",
							NPM_TAG: "${{ steps.train.outputs.npm-tag }}",
						},
					},
					{
						if: "steps.train.outputs.publish == 'true'",
						run: "node scripts/release-train.mjs --finish",
					},
					{
						if: "steps.train.outputs.publish == 'true'",
						run: "node scripts/release-train.mjs --github-release",
						env: { GH_TOKEN: "${{ github.token }}" },
					},
					{
						id: "prepare",
						if: "steps.train.outputs.has-changesets == 'true'",
						run: 'remote_head=$(git ls-remote --exit-code origin refs/heads/main)\nif [[ "${remote_head%%[[:space:]]*}" == "$GITHUB_SHA" ]]; then\n echo "current=true" >> "$GITHUB_OUTPUT"\nfi',
					},
					{
						if: "steps.prepare.outputs.current == 'true'",
						uses: "changesets/action@ae32849d5ba541f9ae29e40e22a623bc13562f51",
						with: {
							"github-token": "${{ github.token }}",
							"version-script": "pnpm version-packages",
							"publish-script": "pnpm release",
							"push-git-tags": false,
							"create-github-releases": false,
						},
					},
				],
			},
		},
	};
	const healthyWorkflow = stringify(healthyConfig);
	const healthyReleaseScript = "changeset publish";
	const healthy = provenanceWorkflowProblems(
		healthyWorkflow,
		healthyReleaseScript,
	);
	if (healthy.length !== 0)
		throw new Error(
			`self-test: healthy publishing workflow must pass: ${healthy.join("; ")}`,
		);

	const CHECKOUT = 0;
	const SETUP = 1;
	const BUILD = 3;
	const PUBLISH = 4;
	const FINISH = 5;
	const GITHUB_RELEASE = 6;
	const PREPARE = 7;
	const ACTION = 8;
	function mustFail(mutate, expected) {
		const config = structuredClone(healthyConfig);
		mutate(config, config.jobs.release, config.jobs.release.steps);
		const problems = provenanceWorkflowProblems(
			stringify(config),
			healthyReleaseScript,
		);
		if (!problems.some((problem) => problem.includes(expected))) {
			throw new Error(`self-test: missing ${expected} must fail closed`);
		}
	}
	for (const permission of ["contents", "pull-requests", "id-token"]) {
		mustFail((config, job) => {
			delete job.permissions[permission];
		}, `${permission}: write`);
	}
	mustFail((config, job, steps) => {
		delete steps[ACTION].with["publish-script"];
	}, "publish-script");
	mustFail((config, job, steps) => {
		delete steps[PUBLISH].env.NODE_AUTH_TOKEN;
	}, "NODE_AUTH_TOKEN");
	mustFail((config, job, steps) => {
		steps[PUBLISH].env.NPM_CONFIG_PROVENANCE = "false";
	}, "NPM_CONFIG_PROVENANCE");
	mustFail((config, job, steps) => {
		delete steps[PUBLISH].env.NPM_TAG;
	}, "NPM_TAG");
	mustFail((config, job, steps) => {
		steps[PUBLISH].run =
			'pnpm release --no-git-tag --tag "${{ steps.train.outputs.npm-tag }}"';
	}, "NPM_TAG");
	mustFail((config, job, steps) => {
		steps[BUILD].if = "steps.train.outputs.has-changesets == 'true'";
	}, "build the version commit");
	mustFail((config, job, steps) => {
		steps[SETUP].with["registry-url"] = "https://npm.pkg.github.com";
	}, "registry-url");
	mustFail((config, job, steps) => {
		steps[CHECKOUT].with["fetch-depth"] = 1;
	}, "fetch tags");
	mustFail((config, job, steps) => {
		steps[ACTION].uses = "changesets/action@v1";
	}, "changesets/action v2");
	mustFail((config, job, steps) => {
		steps[ACTION].with["github-token"] = "${{ secrets.PAT }}";
	}, "github-token");
	mustFail((config, job, steps) => {
		delete steps[ACTION].with["version-script"];
	}, "version-script");
	mustFail((config) => {
		config.on.pull_request = null;
	}, "main pushes");
	mustFail((config, job) => {
		delete job.if;
	}, "restrict manual dispatch");
	mustFail((config) => {
		config.concurrency.queue = "single";
	}, "queue pending releases");
	mustFail((config, job) => {
		job.env = { NODE_AUTH_TOKEN: "${{ secrets.NPM_TOKEN }}" };
	}, "scoped to release steps");
	mustFail((config, job, steps) => {
		steps[ACTION].with["push-git-tags"] = true;
	}, "defer git tags");
	mustFail((config, job, steps) => {
		steps[FINISH].if = "steps.changesets.outputs.published == 'true'";
	}, "retry publishes nothing");
	mustFail((config, job, steps) => {
		steps[SETUP].with["turbo-cache-scope"] = "release";
	}, "without a restored Turbo cache");
	mustFail((config, job, steps) => {
		steps[PUBLISH].if = "steps.train.outputs.has-changesets == 'false'";
	}, "only for a version commit");
	mustFail((config, job, steps) => {
		delete steps[ACTION].if;
	}, "current main commit");
	mustFail((config, job, steps) => {
		[steps[PUBLISH], steps[ACTION]] = [steps[ACTION], steps[PUBLISH]];
	}, "before preparing remaining changesets");
	mustFail((config, job, steps) => {
		[steps[BUILD], steps[PUBLISH]] = [steps[PUBLISH], steps[BUILD]];
	}, "before preparing remaining changesets");
	mustFail((config, job, steps) => {
		delete steps[PREPARE].if;
	}, "live main commit");
	mustFail((config, job, steps) => {
		delete steps[GITHUB_RELEASE].env;
	}, "GitHub release");
	mustFail((config, job, steps) => {
		[steps[FINISH], steps[GITHUB_RELEASE]] = [
			steps[GITHUB_RELEASE],
			steps[FINISH],
		];
	}, "before preparing remaining changesets");
	const cliProvenanceFlag = provenanceWorkflowProblems(
		healthyWorkflow,
		"changeset publish --provenance",
	);
	if (
		!cliProvenanceFlag.some((problem) =>
			problem.includes("must not pass --provenance"),
		)
	) {
		throw new Error(
			"self-test: changeset publish --provenance must fail closed",
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
		!emptyFixed.some((problem) =>
			problem.includes("exactly one fixed group"),
		)
	) {
		throw new Error("self-test: an empty fixed list must fail closed");
	}

	const versionScriptOk = versionPackagesScriptProblems(
		"changeset version && node scripts/stamp-first-train.mjs",
	);
	if (versionScriptOk.length !== 0) {
		throw new Error("self-test: version-packages with the stamp must pass");
	}
	const versionScriptBare =
		versionPackagesScriptProblems("changeset version");
	if (
		!versionScriptBare.some((problem) =>
			problem.includes("stamp the first train"),
		)
	) {
		throw new Error(
			"self-test: version-packages without the stamp must fail",
		);
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
		"release-check self-test ok (publishing credentials, provenance, main-only triggers, retry tags, and the fixed group are required)",
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
	const cliSpec = rootPackage.devDependencies?.["@changesets/cli"];
	if (typeof cliSpec !== "string" || !/^[\^~]?3(\.|$)/.test(cliSpec)) {
		problems.push(
			"root package.json must depend on @changesets/cli 3.x (changesets/action v2 requires it)",
		);
	}

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
		console.error("Release publishing preconditions failed:");
		for (const problem of problems) {
			console.error(`  ${problem}`);
		}
		return true;
	}

	console.log(
		`Release publishing: ${packages.length} packages share ${EXPECTED_REPOSITORY_URL}; ` +
			"release.yml publishes version commits with NPM_TOKEN and provenance, then verifies the train before pushing tags.",
	);
	console.log(
		`Release trail: ${tagCount} git tag(s), ${changelogPaths.length} packages/**/CHANGELOG.md.`,
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
		await fs.readFile(
			path.join(repoRoot, ".changeset", "config.json"),
			"utf8",
		),
	);
	const fixedProblems = fixedGroupProblems(
		changesetConfig,
		packages.map((pkg) => pkg.name),
	);
	if (fixedProblems.length > 0) {
		console.error(
			"Version-sync failed: the changesets fixed group is not the train.",
		);
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
		console.error(
			"Version-sync failed: version-packages does not stamp the first train.",
		);
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
// `engines.node: "^22.22.2 || ^24.15.0 || >=26.0.0"` and ships an exports map with first-class subpaths
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
