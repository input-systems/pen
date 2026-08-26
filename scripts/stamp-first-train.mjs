#!/usr/bin/env node
/**
 * First-train stamp (API7).
 *
 * Unpublished placeholders stay at 0.0.1. `changeset version` treats the
 * staged first-release `minor` bumps as 0.0.1 → 0.1.0, which is the first
 * published train (`spec/rules/api.md` API7). That path is a no-op.
 *
 * `@input/pen-react` lists other train packages as optional
 * peerDependencies. Changesets treats a minor bump of a peer as major for
 * the dependent, and the `fixed` group then lifts the whole train to
 * 1.0.0. This script rewrites that mechanical 1.0.0 to 0.1.0 once, and
 * only when no train tag exists yet.
 *
 * After `v0.1.0` lands the script is a no-op: later trains are whatever
 * changesets computes. A first `changeset version` that is not 0.1.0 or
 * 1.0.0 fails closed rather than publishing a surprise number.
 *
 * Wired from `pnpm version-packages`. Do not run it by hand against a
 * tree that still has unconsumed changesets — `changeset version` has to
 * go first, so CHANGELOG headings match the package.json versions.
 */

import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

export const FIRST_TRAIN_VERSION = "0.1.0";
export const PEER_PROMOTED_MAJOR = "1.0.0";

const IGNORE_DIR_NAMES = new Set([
	"node_modules",
	"dist",
	"coverage",
	".turbo",
	".git",
	"playwright-report",
	"test-results",
]);

export function decideStamp({ tags, versions }) {
	const trainTags = tags.filter((tag) => /^v\d/.test(tag));
	if (trainTags.length > 0) {
		return { action: "noop", reason: "a train tag already exists" };
	}

	const unique = [...new Set(versions.map((pkg) => pkg.version))];
	if (unique.length !== 1) {
		return {
			action: "fail",
			reason: `published packages do not share one version: ${unique.join(", ")}`,
		};
	}

	const version = unique[0];
	if (version === FIRST_TRAIN_VERSION) {
		return { action: "noop", reason: "already at the first train version" };
	}
	if (version === "0.0.1") {
		return {
			action: "noop",
			reason: "unpublished placeholder; changeset version has not run",
		};
	}
	if (version === PEER_PROMOTED_MAJOR) {
		return {
			action: "stamp",
			from: version,
			to: FIRST_TRAIN_VERSION,
		};
	}
	return {
		action: "fail",
		reason:
			`first train must land at ${FIRST_TRAIN_VERSION}; changeset version produced ${version}`,
	};
}

export function rewriteChangelogHeading(markdown, from, to) {
	const heading = new RegExp(`^## ${escapeRegExp(from)}$`, "gm");
	return markdown.replace(heading, `## ${to}`);
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

export function runSelfTests() {
	const noopTagged = decideStamp({
		tags: ["v0.1.0"],
		versions: [{ name: "@input/pen-core", version: PEER_PROMOTED_MAJOR }],
	});
	assert(
		noopTagged.action === "noop",
		"self-test: an existing train tag must skip the stamp",
	);

	const already = decideStamp({
		tags: [],
		versions: [{ name: "@input/pen-core", version: FIRST_TRAIN_VERSION }],
	});
	assert(
		already.action === "noop",
		"self-test: a tree already at 0.1.0 must skip the stamp",
	);

	const placeholder = decideStamp({
		tags: [],
		versions: [{ name: "@input/pen-core", version: "0.0.1" }],
	});
	assert(
		placeholder.action === "noop",
		"self-test: the unpublished 0.0.1 placeholder must not stamp",
	);

	const stamp = decideStamp({
		tags: [],
		versions: [
			{ name: "@input/pen-core", version: PEER_PROMOTED_MAJOR },
			{ name: "@input/pen-types", version: PEER_PROMOTED_MAJOR },
		],
	});
	assert(
		stamp.action === "stamp" &&
			stamp.from === PEER_PROMOTED_MAJOR &&
			stamp.to === FIRST_TRAIN_VERSION,
		"self-test: peer-promoted 1.0.0 stamps to 0.1.0",
	);

	const mixed = decideStamp({
		tags: [],
		versions: [
			{ name: "@input/pen-core", version: "0.1.0" },
			{ name: "@input/pen-types", version: "0.0.1" },
		],
	});
	assert(mixed.action === "fail", "self-test: mixed versions fail closed");

	const surprise = decideStamp({
		tags: [],
		versions: [{ name: "@input/pen-core", version: "0.0.2" }],
	});
	assert(
		surprise.action === "fail",
		"self-test: a first bump that is not 0.1.0 or 1.0.0 fails closed",
	);

	const changelog = rewriteChangelogHeading(
		"# @input/pen-core\n\n## 1.0.0\n\nMentions 1.0.0 in body.\n",
		"1.0.0",
		"0.1.0",
	);
	assert(
		changelog.includes("## 0.1.0") && changelog.includes("Mentions 1.0.0 in body."),
		"self-test: only the CHANGELOG heading is rewritten",
	);

	const remote = parseLsRemoteTags(
		"abc\trefs/tags/v0.1.0\ndef\trefs/tags/v0.1.0^{}\n",
	);
	assert(
		remote.join(",") === "v0.1.0",
		"self-test: ls-remote peeled tags are dropped",
	);
}

export function parseLsRemoteTags(stdout) {
	const tags = [];
	for (const line of stdout.split("\n")) {
		const match = /\trefs\/tags\/([^\s]+)$/.exec(line);
		if (match == null) {
			continue;
		}
		const tag = match[1];
		if (tag.endsWith("^{}")) {
			continue;
		}
		tags.push(tag);
	}
	return tags;
}

function gitOutput(repoRoot, args) {
	const result = spawnSync("git", args, {
		cwd: repoRoot,
		encoding: "utf8",
	});
	if (result.error) {
		throw new Error(`git ${args.join(" ")}: ${result.error.message}`);
	}
	if (result.status !== 0) {
		throw new Error(
			`git ${args.join(" ")} failed: ${(result.stderr ?? "").trim()}`,
		);
	}
	return result.stdout ?? "";
}

function gitTags(repoRoot) {
	const local = gitOutput(repoRoot, ["tag"])
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	if (local.some((tag) => /^v\d/.test(tag))) {
		return local;
	}
	// Depth-1 checkouts omit tags. A remote v* still means the first train
	// already shipped, so the stamp must no-op rather than fail closed.
	try {
		return parseLsRemoteTags(gitOutput(repoRoot, ["ls-remote", "--tags", "origin"]));
	} catch {
		return local;
	}
}

function collectPackageJsonPaths(directory) {
	const found = [];
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			if (!IGNORE_DIR_NAMES.has(entry.name)) {
				found.push(...collectPackageJsonPaths(entryPath));
			}
			continue;
		}
		if (entry.isFile() && entry.name === "package.json") {
			found.push(entryPath);
		}
	}
	return found;
}

function loadPublishedPackages(repoRoot) {
	const packages = [];
	for (const packageJsonPath of collectPackageJsonPaths(
		path.join(repoRoot, "packages"),
	)) {
		const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
		if (packageJson.private === true || typeof packageJson.name !== "string") {
			continue;
		}
		if (typeof packageJson.version !== "string") {
			throw new Error(`${packageJsonPath} is published but has no version`);
		}
		packages.push({
			name: packageJson.name,
			version: packageJson.version,
			packageJsonPath,
			packageRoot: path.dirname(packageJsonPath),
		});
	}
	packages.sort((left, right) => left.name.localeCompare(right.name));
	return packages;
}

function stampPackages(packages, from, to) {
	for (const pkg of packages) {
		const packageJson = JSON.parse(fs.readFileSync(pkg.packageJsonPath, "utf8"));
		if (packageJson.version !== from) {
			throw new Error(
				`${pkg.name} version is ${packageJson.version}, expected ${from} before stamp`,
			);
		}
		packageJson.version = to;
		fs.writeFileSync(
			pkg.packageJsonPath,
			`${JSON.stringify(packageJson, null, 2)}\n`,
		);

		const changelogPath = path.join(pkg.packageRoot, "CHANGELOG.md");
		if (!fs.existsSync(changelogPath)) {
			continue;
		}
		const before = fs.readFileSync(changelogPath, "utf8");
		const after = rewriteChangelogHeading(before, from, to);
		if (after !== before) {
			fs.writeFileSync(changelogPath, after);
		}
	}
}

function parseArgs(argv) {
	let repoRoot = DEFAULT_REPO_ROOT;
	let selfTestOnly = false;
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--repo-root") {
			repoRoot = path.resolve(argv[i + 1] ?? "");
			i += 1;
			continue;
		}
		if (arg === "--self-test") {
			selfTestOnly = true;
			continue;
		}
		throw new Error(`Unknown flag: ${arg}`);
	}
	return { repoRoot, selfTestOnly };
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	runSelfTests();
	console.log(
		"stamp-first-train self-test ok (tagged trees and surprise versions fail closed; 1.0.0 stamps to 0.1.0)",
	);
	if (args.selfTestOnly) {
		return;
	}

	const packages = loadPublishedPackages(args.repoRoot);
	if (packages.length === 0) {
		throw new Error("stamp-first-train: no published packages under packages/");
	}
	const decision = decideStamp({
		tags: gitTags(args.repoRoot),
		versions: packages,
	});
	if (decision.action === "fail") {
		throw new Error(`stamp-first-train: ${decision.reason}`);
	}
	if (decision.action === "noop") {
		console.log(`stamp-first-train: ${decision.reason}`);
		return;
	}

	stampPackages(packages, decision.from, decision.to);
	console.log(
		`stamp-first-train: rewrote ${packages.length} published packages from ${decision.from} to ${decision.to}`,
	);
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
	try {
		main();
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	}
}
