#!/usr/bin/env node
// API7: finish a coordinated train, including retries after npm succeeded
// but pushing tags failed. Ordinary main commits must not cut a release.
import { execFileSync } from "node:child_process";
import fs, { globSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const NPM_REGISTRY = "https://registry.npmjs.org";
const NO_PROPAGATION_WAIT = {
	attempts: 1,
	delayMs: 0,
};
// npm can answer 404 for a short time after accepting a publish
const PUBLISH_PROPAGATION = {
	attempts: 8,
	delayMs: 15_000,
};

function git(repoRoot, ...args) {
	return execFileSync("git", args, {
		cwd: repoRoot,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		timeout: 60_000,
	}).trim();
}

function getPublicPackages(repoRoot) {
	return globSync("packages/**/package.json", {
		cwd: repoRoot,
		exclude: ["**/node_modules/**", "**/dist/**"],
	})
		.map((file) => ({
			...JSON.parse(fs.readFileSync(path.join(repoRoot, file), "utf8")),
			packageDir: path.dirname(file),
		}))
		.filter((pkg) => pkg.private !== true);
}

export function planRelease(repoRoot) {
	const packages = getPublicPackages(repoRoot);
	const versions = new Set(packages.map((pkg) => pkg.version));
	if (packages.length === 0 || versions.size !== 1) {
		throw new Error("Published packages must share one train version");
	}
	const [version] = versions;
	if (typeof version !== "string" || !/^0\.\d+\.\d+$/.test(version)) {
		throw new Error(`Release train must stay 0.x, got ${version}`);
	}
	const previous = JSON.parse(
		git(repoRoot, "show", "HEAD^:packages/core/package.json"),
	);
	return {
		version,
		commit: git(repoRoot, "rev-parse", "HEAD"),
		publish: previous.version !== version,
		hasChangesets:
			globSync(".changeset/*.md", {
				cwd: repoRoot,
				exclude: [".changeset/README.md"],
			}).length > 0,
		packages,
	};
}

const CHANGE_HEADINGS = ["Major Changes", "Minor Changes", "Patch Changes"];
const DEPENDENCY_ENTRY = /^- (Updated dependencies\b|@\S+@\d+\.\d+\.\d+\s*$)/;

// one fixed group repeats each changeset in every package changelog
export function getReleaseNotes(repoRoot, version) {
	const packages = getPublicPackages(repoRoot);
	const sections = new Map();
	for (const pkg of packages) {
		const file = path.join(repoRoot, pkg.packageDir, "CHANGELOG.md");
		if (!fs.existsSync(file)) continue;
		const lines = fs.readFileSync(file, "utf8").split("\n");
		const start = lines.indexOf(`## ${version}`);
		if (start === -1) continue;
		let heading = "Changes";
		let entry = null;
		const addEntry = () => {
			if (entry && !DEPENDENCY_ENTRY.test(entry[0])) {
				const entries = sections.get(heading) ?? new Set();
				entries.add(entry.join("\n").trimEnd());
				sections.set(heading, entries);
			}
			entry = null;
		};
		for (const line of lines.slice(start + 1)) {
			if (line.startsWith("## ")) break;
			if (line.startsWith("### ")) {
				addEntry();
				heading = line.slice(4).trim();
			} else if (line.startsWith("- ")) {
				addEntry();
				entry = [line];
			} else if (entry) {
				entry.push(line);
			}
		}
		addEntry();
	}
	const rank = (heading) =>
		CHANGE_HEADINGS.includes(heading)
			? CHANGE_HEADINGS.indexOf(heading)
			: CHANGE_HEADINGS.length;
	const blocks = [...sections]
		.sort(([left], [right]) => rank(left) - rank(right))
		.map(
			([heading, entries]) =>
				`## ${heading}\n\n${[...entries].join("\n\n")}`,
		);
	if (blocks.length === 0) {
		blocks.push("No changelog entries beyond dependency updates.");
	}
	blocks.push(`Every public Pen package is on npm at \`${version}\`.`);
	return `${blocks.join("\n\n")}\n`;
}

async function getRegistryManifest(
	registry,
	name,
	spec,
	propagation = NO_PROPAGATION_WAIT,
) {
	for (let attempt = 1; ; attempt += 1) {
		const response = await fetch(
			`${registry}/${encodeURIComponent(name)}/${spec}`,
			{
				signal: AbortSignal.timeout(15_000),
			},
		);
		if (response.ok) {
			const manifest = await response.json();
			if (manifest.name !== name) {
				throw new Error(
					`${name}@${spec}: registry returned different package metadata`,
				);
			}
			return manifest;
		}
		if (response.status !== 404) {
			throw new Error(
				`${name}@${spec}: registry returned HTTP ${response.status}`,
			);
		}
		if (attempt >= propagation.attempts) return null;
		await sleep(propagation.delayMs);
	}
}

export async function choosePublishTag(plan, registry = NPM_REGISTRY) {
	const train = plan.version.split(".").map(Number);
	const newerVersions = await Promise.all(
		plan.packages.map(async (pkg) => {
			const manifest = await getRegistryManifest(
				registry,
				pkg.name,
				"latest",
			);
			if (manifest === null) return false;
			if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
				throw new Error(
					`${pkg.name}: cannot compare the registry's latest version`,
				);
			}
			const latest = manifest.version.split(".").map(Number);
			return (
				(latest[0] - train[0] ||
					latest[1] - train[1] ||
					latest[2] - train[2]) > 0
			);
		}),
	);
	return newerVersions.some(Boolean) ? `release-${plan.version}` : "latest";
}

export async function finishRelease(
	repoRoot,
	registry = NPM_REGISTRY,
	propagation = PUBLISH_PROPAGATION,
) {
	const plan = planRelease(repoRoot);
	if (!plan.publish) {
		throw new Error(
			"Retry the original version commit to finish a release",
		);
	}
	const results = await Promise.allSettled(
		plan.packages.map(async (pkg) => {
			const manifest = await getRegistryManifest(
				registry,
				pkg.name,
				pkg.version,
				propagation,
			);
			if (manifest === null) {
				throw new Error(
					`${pkg.name}@${pkg.version}: not found on the registry`,
				);
			}
			if (manifest.version !== pkg.version) {
				throw new Error(
					`${pkg.name}@${pkg.version}: registry returned different package metadata`,
				);
			}
		}),
	);
	const failures = results.filter((result) => result.status === "rejected");
	if (failures.length > 0) {
		throw new Error(
			`Release train is incomplete:\n${failures.map((result) => result.reason.message).join("\n")}`,
		);
	}

	git(repoRoot, "fetch", "--tags", "origin");
	const tags = [
		...plan.packages.map((pkg) => `${pkg.name}@${pkg.version}`),
		`v${plan.version}`,
	];
	const existing = new Set(git(repoRoot, "tag", "--list").split("\n"));
	for (const tag of tags) {
		if (
			existing.has(tag) &&
			git(repoRoot, "rev-parse", `refs/tags/${tag}^{commit}`) !==
				plan.commit
		) {
			throw new Error(
				`${tag} already points to a different commit; refusing to move it`,
			);
		}
	}
	for (const tag of tags) {
		if (!existing.has(tag)) {
			git(
				repoRoot,
				"-c",
				"user.name=github-actions[bot]",
				"-c",
				"user.email=41898282+github-actions[bot]@users.noreply.github.com",
				"tag",
				"-a",
				tag,
				"-m",
				tag,
				plan.commit,
			);
		}
	}
	git(
		repoRoot,
		"push",
		"--atomic",
		"origin",
		...tags.map((tag) => `refs/tags/${tag}`),
	);
	return plan;
}

function gh(repoRoot, args, input) {
	return execFileSync("gh", args, {
		cwd: repoRoot,
		encoding: "utf8",
		input,
		stdio: ["pipe", "pipe", "pipe"],
		timeout: 60_000,
	}).trim();
}

function hasGitHubRelease(repoRoot, tag) {
	try {
		gh(repoRoot, ["release", "view", tag, "--json", "tagName"]);
		return true;
	} catch (error) {
		if (String(error.stderr).includes("release not found")) return false;
		throw error;
	}
}

async function publishGitHubRelease(repoRoot, plan) {
	const tag = `v${plan.version}`;
	if (hasGitHubRelease(repoRoot, tag)) return false;
	const latest = (await choosePublishTag(plan)) === "latest";
	gh(
		repoRoot,
		[
			"release",
			"create",
			tag,
			"--verify-tag",
			"--title",
			tag,
			"--notes-file",
			"-",
			`--latest=${latest}`,
		],
		getReleaseNotes(repoRoot, plan.version),
	);
	return true;
}

const USAGE =
	"Usage: node scripts/release-train.mjs --plan | --finish | --github-release | --notes <version>";

async function main() {
	const [command, version] = process.argv.slice(2);
	if (command === "--notes") {
		if (process.argv.length !== 4 || !/^\d+\.\d+\.\d+$/.test(version)) {
			throw new Error(USAGE);
		}
		process.stdout.write(getReleaseNotes(REPO_ROOT, version));
		return;
	}
	if (
		process.argv.length !== 3 ||
		!["--plan", "--finish", "--github-release"].includes(command)
	) {
		throw new Error(USAGE);
	}
	const plan = planRelease(REPO_ROOT);
	if (process.env.GITHUB_SHA && process.env.GITHUB_SHA !== plan.commit) {
		throw new Error(
			"Release checkout must match the triggering GitHub commit",
		);
	}
	if (command === "--plan") {
		const npmTag = plan.publish ? await choosePublishTag(plan) : "latest";
		if (process.env.GITHUB_OUTPUT) {
			fs.appendFileSync(
				process.env.GITHUB_OUTPUT,
				`publish=${plan.publish}\nhas-changesets=${plan.hasChangesets}\nnpm-tag=${npmTag}\n`,
			);
		}
		console.log(
			`Train ${plan.version}: ${plan.publish ? "publish version commit" : "prepare PR or no-op"}`,
		);
		if (plan.publish)
			console.log(`npm tag: ${npmTag}; newer releases keep latest`);
		return;
	}
	if (command === "--github-release") {
		if (!plan.publish) {
			throw new Error(
				"Retry the original version commit to finish a release",
			);
		}
		const created = await publishGitHubRelease(REPO_ROOT, plan);
		console.log(
			created
				? `Created GitHub release v${plan.version}`
				: `GitHub release v${plan.version} already exists`,
		);
		return;
	}
	await finishRelease(REPO_ROOT);
	console.log(
		`Released ${plan.packages.length} packages at ${plan.version}; all tags point to ${plan.commit}`,
	);
	if (process.env.GITHUB_STEP_SUMMARY) {
		fs.appendFileSync(
			process.env.GITHUB_STEP_SUMMARY,
			`### npm release ${plan.version}\n\nVerified ${plan.packages.length} public packages and pushed package tags plus \`v${plan.version}\` at \`${plan.commit}\`.\n`,
		);
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(error.message);
		process.exitCode = 1;
	});
}
