#!/usr/bin/env node
/**
 * DOC4 per-package README section check (spec/rules/documentation.md).
 *
 * Every published package README must state: what it does and does not do;
 * install with required peers; a minimal working snippet; options with
 * defaults; a docs-page hash and api-report.md; the MIT license line.
 *
 * Companion packages (@input/pen-types, @input/pen-ingest,
 * @input/pen-markdown) must say in the first sentence that
 * they are not installed alone and name the package to install instead.
 * Extension READMEs must name the facets and commands they contribute
 * and the extensions they require.
 *
 * Hits fail unless listed in scripts/readme-sections-allowlist.json
 * with a reason. Stale allowlist entries fail as loudly as violations.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPublishedManifests } from "./lib/workspacePackages.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_ALLOWLIST = path.join("scripts", "readme-sections-allowlist.json");

const COMPANION_PACKAGES = new Set([
	"@input/pen-types",
	"@input/pen-ingest",
	"@input/pen-markdown",
]);

const DOCS_PAGE_RE =
	/#\/(getting-started|core-concepts|selection|extensions|commands|collaboration|ai|import-export|security|accessibility|support|localization|upgrade|ssr)\b/;

const INSTALL_COMMAND_RE = /\b(?:pnpm add|npm install|yarn add|pnpm add -D|npm install -D)\b/;
const LICENSE_HEADING_RE = /^## License\b/m;
const OPTIONS_HEADING_RE = /^#{2,3} Options\b/m;
const OPTIONS_NONE_RE =
	/\b(?:has no options|has no configuration options|takes no options|takes no effective options|has no configuration)\b/i;
const OPTIONS_DEFAULT_TABLE_RE = /^\|.*\bDefault\b.*\|/m;
const COMING_SOON_RE = /Coming soon/;
const MONOREPO_RELATIVE_LINK_RE = /\]\(\.\.\/\.\.\//;
const REASON_RE = /DOC4|D\.6|parallel|owned|deferred/i;

const INSTALL_ALONE_RE =
	/\balone\b|\bdo not install\b|\bhosts do not install\b|\bnot a package to install\b/i;
const FACET_RE = /\bfacets?\b/i;
const COMMAND_RE = /\bcommands?\b/i;
const REQUIRED_EXTENSION_RE =
	/\brequires?\b|\bdepend(?:s)? on\b|\bno other extension/i;

export function stripEmphasis(text) {
	return text.replace(/[*_]/g, "");
}

export function firstProseParagraph(readme) {
	const withoutTitle = readme.replace(/^#\s+[^\n]+\n+/, "");
	const untilHeading = withoutTitle.split(/^## /m)[0] ?? "";
	const paragraphs = untilHeading
		.split(/\n\s*\n/)
		.map((part) => part.trim())
		.filter(Boolean);
	return paragraphs[0] ?? "";
}

export function fencedBlocks(readme, languages) {
	const lang = languages.join("|");
	const pattern = new RegExp("```(?:" + lang + ")\\b([^`]+?)```", "gi");
	const blocks = [];
	for (const match of readme.matchAll(pattern)) {
		blocks.push(match[1] ?? "");
	}
	return blocks;
}

export function requiredPeerNames(packageJson) {
	const optional = new Set(
		Object.entries(packageJson.peerDependenciesMeta ?? {})
			.filter(([, meta]) => meta?.optional === true)
			.map(([name]) => name),
	);
	return Object.keys(packageJson.peerDependencies ?? {}).filter(
		(name) => !optional.has(name),
	);
}

export function isExtensionPackage(dir) {
	return dir.split("/").slice(0, 2).join("/") === "packages/extensions";
}

export function isCompanionPackage(name) {
	return COMPANION_PACKAGES.has(name);
}

export function evaluateReadme({ name, dir, readme, peers }) {
	const missing = [];
	const collapsed = stripEmphasis(readme);
	const companion = isCompanionPackage(name);
	const extension = isExtensionPackage(dir);
	const installBlocks = fencedBlocks(readme, ["bash", "sh", "shell"]);
	const installText = installBlocks.join("\n");
	const snippetBlocks = fencedBlocks(readme, [
		"ts",
		"tsx",
		"js",
		"jsx",
		"javascript",
		"typescript",
		"vue",
	]);

	if (!/\bdoes not\b/i.test(collapsed) && !/\bdo not\b/i.test(collapsed)) {
		missing.push("does-not");
	}

	const installTokens = installText.split(/\s+/).filter(Boolean);

	if (
		installBlocks.length === 0 ||
		!INSTALL_COMMAND_RE.test(installText) ||
		!installTokens.includes(name)
	) {
		missing.push("install");
	}

	for (const peer of peers) {
		if (!installTokens.includes(peer)) {
			missing.push(`install-peer:${peer}`);
		}
	}

	if (!companion && snippetBlocks.length === 0) {
		missing.push("snippet");
	}

	if (
		!OPTIONS_HEADING_RE.test(readme) &&
		!OPTIONS_NONE_RE.test(readme) &&
		!OPTIONS_DEFAULT_TABLE_RE.test(readme)
	) {
		missing.push("options");
	}

	if (!DOCS_PAGE_RE.test(readme)) {
		missing.push("docs");
	}

	if (!readme.includes("api-report.md")) {
		missing.push("reference");
	}

	if (!LICENSE_HEADING_RE.test(readme) || !/\bMIT\b/.test(readme)) {
		missing.push("license");
	}

	if (companion) {
		const first = firstProseParagraph(readme);
		if (!INSTALL_ALONE_RE.test(first)) {
			missing.push("companion-alone");
		}
		const named = [...first.matchAll(/@input\/pen-[a-z0-9-]+/g)].map(
			(match) => match[0],
		);
		if (!named.some((pkg) => pkg !== name)) {
			missing.push("companion-install-instead");
		}
	}

	if (extension) {
		if (!FACET_RE.test(readme)) {
			missing.push("facets");
		}
		if (!COMMAND_RE.test(readme)) {
			missing.push("commands");
		}
		if (!REQUIRED_EXTENSION_RE.test(readme)) {
			missing.push("required-extensions");
		}
	}

	if (COMING_SOON_RE.test(readme)) {
		missing.push("coming-soon");
	}

	if (MONOREPO_RELATIVE_LINK_RE.test(readme)) {
		missing.push("monorepo-relative-link");
	}

	return { missing };
}

export function parseAllowlist(raw) {
	const packages = raw?.packages;
	if (!Array.isArray(packages)) {
		throw new Error("readme-sections-allowlist.json must have a packages array");
	}
	return packages.map((entry, index) => {
		if (
			typeof entry?.package !== "string" ||
			typeof entry?.reason !== "string" ||
			entry.package.length === 0 ||
			entry.reason.trim().length === 0
		) {
			throw new Error(
				`readme-sections-allowlist.json packages[${index}] needs package and a non-empty reason`,
			);
		}
		if (!REASON_RE.test(entry.reason)) {
			throw new Error(
				`readme-sections-allowlist.json packages[${index}] reason must name DOC4 / D.6 / the owning parallel work`,
			);
		}
		return {
			package: entry.package,
			reason: entry.reason.trim(),
		};
	});
}

export function evaluateReadmes({ packages, allowlist }) {
	const violations = [];
	for (const pkg of packages) {
		const result =
			pkg.missing !== undefined
				? { missing: pkg.missing }
				: evaluateReadme(pkg);
		if (result.missing.length > 0) {
			violations.push({
				package: pkg.name,
				dir: pkg.dir,
				missing: result.missing,
			});
		}
	}
	violations.sort((left, right) => left.package.localeCompare(right.package));

	const allowByName = new Map(
		allowlist.map((entry) => [entry.package, entry]),
	);
	const violationNames = new Set(violations.map((hit) => hit.package));

	const unexpected = violations.filter((hit) => !allowByName.has(hit.package));
	const allowed = violations
		.filter((hit) => allowByName.has(hit.package))
		.map((hit) => ({
			...hit,
			reason: allowByName.get(hit.package).reason,
		}));
	const stale = allowlist.filter((entry) => !violationNames.has(entry.package));

	return { violations, unexpected, allowed, stale };
}

export function hasFailures(result) {
	return result.unexpected.length > 0 || result.stale.length > 0;
}

export function formatReport(result) {
	const lines = ["DOC4 per-package README sections"];
	lines.push("");
	lines.push(
		`violations   ${result.violations.length}  (allowlisted ${result.allowed.length})`,
	);

	if (result.allowed.length > 0) {
		lines.push("");
		lines.push("Allowlisted README contract gaps:");
		for (const hit of result.allowed) {
			lines.push(`  ${hit.package}`);
			lines.push(`    ${hit.missing.join(", ")}`);
			lines.push(`    ${hit.reason}`);
		}
	}

	if (result.unexpected.length > 0) {
		lines.push("");
		lines.push("FAIL missing README contract sections:");
		for (const hit of result.unexpected) {
			lines.push(`  ${hit.package}`);
			lines.push(`    ${hit.missing.join(", ")}`);
		}
	}

	if (result.stale.length > 0) {
		lines.push("");
		lines.push(
			"FAIL stale allowlist entries (README now meets the contract; remove them):",
		);
		for (const entry of result.stale) {
			lines.push(`  ${entry.package}`);
			lines.push(`    ${entry.reason}`);
		}
	}

	if (!hasFailures(result)) {
		lines.push("");
		lines.push(
			`OK: published READMEs match the DOC4 contract (${result.allowed.length} allowlisted).`,
		);
	}

	return lines.join("\n");
}

function completeReadme(name, extras = "") {
	return `# ${name}

This package edits documents. It does not render a surface.

## Install

\`\`\`bash
pnpm add ${name}
\`\`\`

## Usage

\`\`\`ts
import { thing } from "${name}";
void thing;
\`\`\`

## Options

This package has no options.

## Documentation

The docs site covers this area on the Core concepts page (\`#/core-concepts\`).
The public signatures of record are in \`api-report.md\` next to this package's source.

## License

MIT © Input B.V. See [\`LICENSE.md\`](./LICENSE.md).
${extras}`;
}

export function runSelfTests() {
	const complete = completeReadme("@input/pen-core");
	const matching = evaluateReadmes({
		packages: [
			{
				name: "@input/pen-core",
				dir: "packages/core",
				readme: complete,
				peers: [],
			},
		],
		allowlist: [],
	});
	assert(
		matching.unexpected.length === 0 && matching.stale.length === 0,
		"self-test: complete core README must pass",
	);
	assert(!hasFailures(matching), "self-test: matching tree must pass");

	const stub = evaluateReadme({
		name: "@input/pen-core",
		dir: "packages/core",
		readme: `# @input/pen-core\n\nHeadless runtime.\n\n## License\n\nMIT\n`,
		peers: [],
	});
	assert(
		stub.missing.includes("does-not") &&
			stub.missing.includes("install") &&
			stub.missing.includes("snippet") &&
			stub.missing.includes("options") &&
			stub.missing.includes("docs") &&
			stub.missing.includes("reference"),
		"self-test: stub README must fail closed",
	);

	const companionOk = evaluateReadme({
		name: "@input/pen-types",
		dir: "packages/types",
		readme: `# @input/pen-types

\`@input/pen-types\` is not a package to install alone. Install \`@input/pen-core\` instead.

This package does not create an editor.

## Install

\`\`\`bash
pnpm add @input/pen-types
\`\`\`

## Options

This package has no options.

## Documentation

See the Core concepts page (\`#/core-concepts\`). Signatures live in \`api-report.md\`.

## License

MIT © Input B.V.
`,
		peers: [],
	});
	assert(
		companionOk.missing.length === 0,
		"self-test: companion README without a snippet must pass",
	);

	const companionBad = evaluateReadme({
		name: "@input/pen-types",
		dir: "packages/types",
		readme: completeReadme("@input/pen-types"),
		peers: [],
	});
	assert(
		companionBad.missing.includes("companion-alone") &&
			companionBad.missing.includes("companion-install-instead"),
		"self-test: companion without first-sentence redirect must fail",
	);

	const extensionMissing = evaluateReadme({
		name: "@input/pen-shortcuts",
		dir: "packages/extensions/shortcuts",
		readme: complete,
		peers: [],
	});
	assert(
		extensionMissing.missing.includes("facets") &&
			extensionMissing.missing.includes("commands") &&
			extensionMissing.missing.includes("required-extensions"),
		"self-test: extension README must list facets, commands, and required extensions",
	);

	const extensionOk = evaluateReadme({
		name: "@input/pen-shortcuts",
		dir: "packages/extensions/shortcuts",
		readme: completeReadme(
			"@input/pen-shortcuts",
			`
## Facets and commands

Contributes the \`pen.keymap\` facet and the \`pen.toggleMark\` command. Requires no other extension.
`,
		),
		peers: [],
	});
	assert(
		extensionOk.missing.length === 0,
		"self-test: extension README with facet/command/require lines must pass",
	);

	const peerMissing = evaluateReadme({
		name: "@input/pen-react",
		dir: "packages/rendering/react",
		readme: completeReadme("@input/pen-react"),
		peers: ["react", "react-dom"],
	});
	assert(
		peerMissing.missing.includes("install-peer:react") &&
			peerMissing.missing.includes("install-peer:react-dom"),
		"self-test: required peers missing from install must fail",
	);

	const comingSoon = evaluateReadme({
		name: "@input/pen-core",
		dir: "packages/core",
		readme: complete.replace("MIT ©", "Coming soon.\n\nMIT ©"),
		peers: [],
	});
	assert(
		comingSoon.missing.includes("coming-soon"),
		"self-test: Coming soon must fail",
	);

	const relativeLink = evaluateReadme({
		name: "@input/pen-core",
		dir: "packages/core",
		readme: complete.replace(
			"## License",
			"See [STYLING.md](../../packages/rendering/react/STYLING.md).\n\n## License",
		),
		peers: [],
	});
	assert(
		relativeLink.missing.includes("monorepo-relative-link"),
		"self-test: monorepo-relative README link must fail",
	);

	const allowlist = parseAllowlist({
		packages: [
			{
				package: "@input/pen-multiplayer",
				reason: "DOC4 / D.6 README owned by a parallel agent; section check deferred",
			},
		],
	});
	const allowlisted = evaluateReadmes({
		packages: [
			{
				name: "@input/pen-multiplayer",
				dir: "packages/extensions/multiplayer",
				missing: ["install", "docs"],
			},
		],
		allowlist,
	});
	assert(
		allowlisted.allowed.length === 1 && allowlisted.unexpected.length === 0,
		"self-test: allowlisted gap must not fail",
	);
	assert(!hasFailures(allowlisted), "self-test: matching allowlist must pass");

	const unmarked = evaluateReadmes({
		packages: [
			{
				name: "@input/pen-search",
				dir: "packages/extensions/search",
				missing: ["docs"],
			},
		],
		allowlist,
	});
	assert(
		unmarked.unexpected.some((hit) => hit.package === "@input/pen-search"),
		"self-test: unmarked violation must fail",
	);

	const stale = evaluateReadmes({
		packages: [
			{
				name: "@input/pen-core",
				dir: "packages/core",
				missing: [],
			},
		],
		allowlist,
	});
	assert(
		stale.stale.some((entry) => entry.package === "@input/pen-multiplayer"),
		"self-test: unused allowlist entry must be stale",
	);
	assert(hasFailures(stale), "self-test: stale allowlist fails closed");

	assert(
		requiredPeerNames({
			peerDependencies: {
				react: "^19",
				"@input/pen-import-markdown": "workspace:^",
			},
			peerDependenciesMeta: {
				"@input/pen-import-markdown": { optional: true },
			},
		}).join(",") === "react",
		"self-test: optional peers are not required in the install block",
	);
	assert(
		isExtensionPackage("packages/extensions/undo") &&
			!isExtensionPackage("packages/core"),
		"self-test: extension directory detection",
	);
	assert(
		isCompanionPackage("@input/pen-markdown"),
		"self-test: pen-markdown is a companion package",
	);

	const doNotCounts = evaluateReadme({
		name: "@input/pen-transport",
		dir: "packages/transport",
		readme: completeReadme("@input/pen-transport").replace(
			"It does not render a surface.",
			"Do not ship it.",
		),
		peers: [],
	});
	assert(
		!doNotCounts.missing.includes("does-not"),
		"self-test: 'do not' satisfies the does-not section",
	);

	const defaultTable = evaluateReadme({
		name: "@input/pen-core",
		dir: "packages/core",
		readme: completeReadme("@input/pen-core")
			.replace("## Options\n\nThis package has no options.\n", "")
			.replace(
				"## Documentation",
				"| Field | Default |\n| ----- | ------- |\n| locale | unset |\n\n## Documentation",
			),
		peers: [],
	});
	assert(
		!defaultTable.missing.includes("options"),
		"self-test: a Default column counts as the options section",
	);
}

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

export async function loadPublishedPackages(repoRoot) {
	const manifests = await loadPublishedManifests(repoRoot);
	return Promise.all(
		manifests.map(async ({ name, dir, packageJsonPath, packageJson }) => {
			const readmePath = path.join(
				path.dirname(packageJsonPath),
				"README.md",
			);
			let readme = "";
			try {
				readme = await fs.readFile(readmePath, "utf8");
			} catch {
				readme = "";
			}
			return {
				name,
				dir,
				readme,
				peers: requiredPeerNames(packageJson),
				packageJson,
			};
		}),
	);
}

export async function loadAllowlist(
	repoRoot,
	allowlistRel = DEFAULT_ALLOWLIST,
) {
	const text = await fs.readFile(path.join(repoRoot, allowlistRel), "utf8");
	return parseAllowlist(JSON.parse(text));
}

function parseArgs(argv) {
	let repoRoot = DEFAULT_REPO_ROOT;
	let selfTestOnly = false;
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--self-test") {
			selfTestOnly = true;
			continue;
		}
		if (arg === "--repo-root") {
			repoRoot = path.resolve(argv[i + 1] ?? "");
			i += 1;
			continue;
		}
		throw new Error(`Unknown flag: ${arg}`);
	}
	return { repoRoot, selfTestOnly };
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	runSelfTests();
	console.log(
		"DOC4 README sections self-test ok (fixture README; stub, missing peer, companion, extension, Coming soon, relative link, and stale allowlist all fail closed)",
	);
	if (args.selfTestOnly) {
		return;
	}

	const packages = await loadPublishedPackages(args.repoRoot);
	if (packages.length === 0) {
		console.error(
			"readme-sections: cannot check: packages/**/package.json walk matched 0 published manifests",
		);
		process.exitCode = 1;
		return;
	}
	console.log(
		`population: ${packages.length} published manifests (packages/**/package.json)`,
	);
	const allowlist = await loadAllowlist(args.repoRoot);
	const result = evaluateReadmes({ packages, allowlist });
	console.log("");
	console.log(formatReport(result));
	if (hasFailures(result)) {
		process.exitCode = 1;
	}
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}
