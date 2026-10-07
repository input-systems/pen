import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parse } from "yaml";

import {
	choosePublishTag,
	finishRelease,
	planRelease,
} from "../release-train.mjs";

const execFileAsync = promisify(execFile);
const NO_WAIT = {
	attempts: 1,
	delayMs: 0,
};
const changesetsCli = fileURLToPath(
	new URL("../../node_modules/@changesets/cli/bin.js", import.meta.url),
);
const { packageManager } = JSON.parse(
	fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
);

function git(repoRoot, ...args) {
	return execFileSync("git", args, {
		cwd: repoRoot,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}

function fixture(t) {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pen-release-"));
	t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
	const repoRoot = path.join(directory, "repo");
	const remote = path.join(directory, "remote.git");
	fs.mkdirSync(repoRoot);
	git(directory, "init", "--bare", remote);
	git(repoRoot, "init", "-b", "main");
	git(repoRoot, "config", "user.name", "Release test");
	git(repoRoot, "config", "user.email", "release@example.test");
	git(repoRoot, "config", "commit.gpgSign", "false");
	git(repoRoot, "config", "tag.gpgSign", "false");
	git(repoRoot, "remote", "add", "origin", remote);
	for (const name of ["core", "types", "private"]) {
		const packageRoot = path.join(repoRoot, "packages", name);
		fs.mkdirSync(packageRoot, { recursive: true });
		fs.writeFileSync(
			path.join(packageRoot, "package.json"),
			JSON.stringify({
				name: `@input/pen-${name}`,
				version: "0.3.0",
				...(name === "private" ? { private: true } : {}),
			}),
		);
	}
	git(repoRoot, "add", ".");
	git(repoRoot, "commit", "-m", "Previous train");
	git(repoRoot, "push", "origin", "main");
	return { repoRoot, remote };
}

function versionCommit(repoRoot) {
	for (const name of ["core", "types"]) {
		const file = path.join(repoRoot, "packages", name, "package.json");
		const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
		manifest.version = "0.4.0";
		fs.writeFileSync(file, JSON.stringify(manifest));
	}
	git(repoRoot, "add", ".");
	git(repoRoot, "commit", "-m", "Version Packages");
	git(repoRoot, "push", "origin", "main");
}

async function registry(t, versions) {
	const server = http.createServer((request, response) => {
		const key = decodeURIComponent(request.url.slice(1));
		const manifest = versions.get(key);
		response.writeHead(manifest ? 200 : 404, {
			"Content-Type": "application/json",
		});
		response.end(JSON.stringify(manifest ?? { error: "Not found" }));
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => new Promise((resolve) => server.close(resolve)));
	return `http://127.0.0.1:${server.address().port}`;
}

function published(version = "0.4.0") {
	return new Map(
		["core", "types"].map((name) => [
			`@input/pen-${name}/${version}`,
			{ name: `@input/pen-${name}`, version },
		]),
	);
}

test("API7: only a commit that versions the train can publish", (t) => {
	const { repoRoot } = fixture(t);
	fs.writeFileSync(path.join(repoRoot, "note.md"), "Ordinary change");
	git(repoRoot, "add", ".");
	git(repoRoot, "commit", "-m", "Update notes");
	assert.equal(planRelease(repoRoot).publish, false);
	assert.equal(planRelease(repoRoot).hasChangesets, false);
	fs.mkdirSync(path.join(repoRoot, ".changeset"));
	fs.writeFileSync(path.join(repoRoot, ".changeset", "README.md"), "Guide");
	assert.equal(planRelease(repoRoot).hasChangesets, false);
	fs.writeFileSync(
		path.join(repoRoot, ".changeset", "pending.md"),
		'---\n"@input/pen-core": patch\n---\nChange\n',
	);
	assert.equal(planRelease(repoRoot).hasChangesets, true);
	versionCommit(repoRoot);
	const plan = planRelease(repoRoot);
	assert.equal(plan.publish, true);
	assert.equal(plan.hasChangesets, true);
	assert.equal(plan.version, "0.4.0");
	assert.equal(plan.commit, git(repoRoot, "rev-parse", "HEAD"));
	assert.deepEqual(plan.packages.map((pkg) => pkg.name).sort(), [
		"@input/pen-core",
		"@input/pen-types",
	]);
});

test("API7: older retries preserve latest by using a version-specific npm tag", async (t) => {
	const { repoRoot } = fixture(t);
	versionCommit(repoRoot);
	const versions = new Map([
		[
			"@input/pen-core/latest",
			{ name: "@input/pen-core", version: "0.3.0" },
		],
		[
			"@input/pen-types/latest",
			{ name: "@input/pen-types", version: "0.3.0" },
		],
	]);
	const url = await registry(t, versions);
	const plan = planRelease(repoRoot);
	assert.equal(await choosePublishTag(plan, url), "latest");
	versions.set("@input/pen-core/latest", {
		name: "@input/pen-core",
		version: "0.5.0",
	});
	assert.equal(await choosePublishTag(plan, url), "release-0.4.0");
	versions.clear();
	assert.equal(await choosePublishTag(plan, url), "latest");
});

test("API7: the workflow prepares version PRs only from the current main commit", (t) => {
	const { repoRoot } = fixture(t);
	const workflow = parse(
		fs.readFileSync(
			new URL("../../.github/workflows/release.yml", import.meta.url),
			"utf8",
		),
	);
	const step = workflow.jobs.release.steps.find(
		(entry) => entry.id === "prepare",
	);
	const output = path.join(repoRoot, "github-output");
	const originalCommit = git(repoRoot, "rev-parse", "HEAD");
	const run = () =>
		execFileSync("bash", ["-e", "-o", "pipefail", "-c", step.run], {
			cwd: repoRoot,
			env: {
				...process.env,
				GITHUB_SHA: originalCommit,
				GITHUB_OUTPUT: output,
			},
			stdio: ["ignore", "pipe", "pipe"],
		});
	run();
	assert.equal(fs.readFileSync(output, "utf8"), "current=true\n");
	versionCommit(repoRoot);
	fs.writeFileSync(output, "");
	run();
	assert.equal(fs.readFileSync(output, "utf8"), "current=false\n");
});

test("API7: mixed train versions fail before publishing", (t) => {
	const { repoRoot } = fixture(t);
	const file = path.join(repoRoot, "packages", "core", "package.json");
	const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
	manifest.version = "0.4.0";
	fs.writeFileSync(file, JSON.stringify(manifest));
	assert.throws(() => planRelease(repoRoot), /one train version/);
});

test("API7: a partial publish cannot create or push the train tag", async (t) => {
	const { repoRoot, remote } = fixture(t);
	versionCommit(repoRoot);
	const versions = published();
	versions.delete("@input/pen-types/0.4.0");
	const url = await registry(t, versions);
	await assert.rejects(
		finishRelease(repoRoot, url, NO_WAIT),
		/pen-types@0\.4\.0/,
	);
	assert.equal(git(remote, "tag", "--list"), "");
	assert.equal(git(repoRoot, "tag", "--list"), "");
});

test("API7: completion waits for npm to serve a version it just accepted", async (t) => {
	const { repoRoot, remote } = fixture(t);
	versionCommit(repoRoot);
	const versions = published();
	const lagging = "@input/pen-types/0.4.0";
	let lookups = 0;
	const url = await registry(t, {
		get(key) {
			if (key !== lagging) return versions.get(key);
			lookups += 1;
			return lookups > 1 ? versions.get(key) : undefined;
		},
	});
	await finishRelease(repoRoot, url, {
		attempts: 2,
		delayMs: 1,
	});
	assert.equal(lookups, 2);
	assert.deepEqual(git(remote, "tag", "--list").split("\n"), [
		"@input/pen-core@0.4.0",
		"@input/pen-types@0.4.0",
		"v0.4.0",
	]);
});

test("API7: retry completes all tags even when npm has nothing left to publish", async (t) => {
	const { repoRoot, remote } = fixture(t);
	versionCommit(repoRoot);
	const url = await registry(t, published());
	const expectedCommit = git(repoRoot, "rev-parse", "HEAD");
	git(
		repoRoot,
		"tag",
		"-a",
		"@input/pen-core@0.4.0",
		"-m",
		"Existing Changesets tag",
	);
	git(repoRoot, "push", "origin", "refs/tags/@input/pen-core@0.4.0");
	await finishRelease(repoRoot, url);
	const tags = ["@input/pen-core@0.4.0", "@input/pen-types@0.4.0", "v0.4.0"];
	assert.deepEqual(git(remote, "tag", "--list").split("\n"), tags);
	for (const tag of tags)
		assert.equal(
			git(remote, "rev-parse", `${tag}^{commit}`),
			expectedCommit,
		);
	const before = git(remote, "show-ref", "--tags");
	await finishRelease(repoRoot, url);
	assert.equal(git(remote, "show-ref", "--tags"), before);
});

test("API7: a conflicting release tag is never moved", async (t) => {
	const { repoRoot, remote } = fixture(t);
	git(repoRoot, "tag", "-a", "v0.4.0", "-m", "Conflicting tag");
	git(repoRoot, "push", "origin", "refs/tags/v0.4.0");
	versionCommit(repoRoot);
	const before = git(remote, "show-ref", "--tags");
	await assert.rejects(
		finishRelease(repoRoot, await registry(t, published())),
		/v0\.4\.0.*different commit/,
	);
	assert.equal(git(remote, "show-ref", "--tags"), before);
});

test("API7: registry metadata must identify the expected package version", async (t) => {
	const { repoRoot, remote } = fixture(t);
	versionCommit(repoRoot);
	const versions = published();
	versions.set("@input/pen-core/0.4.0", {
		name: "@input/pen-core",
		version: "0.3.0",
	});
	await assert.rejects(
		finishRelease(repoRoot, await registry(t, versions)),
		/pen-core@0\.4\.0/,
	);
	assert.equal(git(remote, "tag", "--list"), "");
});

for (const newerTrain of [false, true]) {
	test(`API7: real Changesets resumes a partial train${newerTrain ? " after a newer release" : ""}`, async (t) => {
		const { repoRoot, remote } = fixture(t);
		const documents = new Map();
		let rejectCore = true;
		const server = http.createServer(async (request, response) => {
			const key = decodeURIComponent(request.url.slice(1).split("?")[0]);
			response.setHeader("Content-Type", "application/json");
			if (request.method === "PUT") {
				if (key === "@input/pen-core" && rejectCore) {
					response.writeHead(403);
					response.end(
						JSON.stringify({
							error: "Simulated missing publish permission",
						}),
					);
					return;
				}
				const chunks = [];
				for await (const chunk of request) chunks.push(chunk);
				const uploaded = JSON.parse(Buffer.concat(chunks).toString());
				const previous = documents.get(key);
				documents.set(key, {
					...uploaded,
					versions: { ...previous?.versions, ...uploaded.versions },
					"dist-tags": {
						...previous?.["dist-tags"],
						...uploaded["dist-tags"],
					},
				});
				response.writeHead(201);
				response.end(JSON.stringify({ ok: true }));
				return;
			}
			const slash = key.indexOf("/", key.indexOf("/") + 1);
			const document = documents.get(
				slash === -1 ? key : key.slice(0, slash),
			);
			const requestedVersion = key.slice(slash + 1);
			const result =
				slash === -1
					? document
					: document?.versions[
							document["dist-tags"]?.[requestedVersion] ??
								requestedVersion
						];
			response.writeHead(result ? 200 : 404);
			response.end(JSON.stringify(result ?? { error: "Not found" }));
		});
		await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
		t.after(() => new Promise((resolve) => server.close(resolve)));
		const url = `http://127.0.0.1:${server.address().port}`;
		fs.writeFileSync(
			path.join(repoRoot, "package.json"),
			JSON.stringify({
				name: "release-fixture",
				private: true,
				packageManager,
			}),
		);
		fs.writeFileSync(
			path.join(repoRoot, "pnpm-workspace.yaml"),
			'packages:\n  - "packages/*"\n',
		);
		fs.writeFileSync(
			path.join(repoRoot, ".npmrc"),
			`registry=${url}\n//127.0.0.1:${server.address().port}/:_authToken=test-token\n`,
		);
		fs.mkdirSync(path.join(repoRoot, ".changeset"));
		fs.writeFileSync(
			path.join(repoRoot, ".changeset", "config.json"),
			JSON.stringify({
				fixed: [["@input/pen-core", "@input/pen-types"]],
				access: "public",
				baseBranch: "main",
				ignore: ["@input/pen-private"],
				privatePackages: { version: false, tag: false },
			}),
		);
		for (const name of ["core", "types"]) {
			const packageRoot = path.join(repoRoot, "packages", name);
			const file = path.join(packageRoot, "package.json");
			const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
			manifest.main = "index.js";
			manifest.publishConfig = { access: "public", registry: url };
			if (name === "core")
				manifest.dependencies = { "@input/pen-types": "workspace:^" };
			fs.writeFileSync(file, JSON.stringify(manifest));
			fs.writeFileSync(
				path.join(packageRoot, "index.js"),
				"module.exports = {};\n",
			);
		}
		git(repoRoot, "add", ".");
		git(repoRoot, "commit", "-m", "Set up local publishing fixture");
		versionCommit(repoRoot);
		await execFileAsync(
			"pnpm",
			["install", "--offline", "--ignore-scripts"],
			{
				cwd: repoRoot,
				timeout: 60_000,
			},
		);
		const publish = async () => {
			const npmTag = await choosePublishTag(planRelease(repoRoot), url);
			return execFileAsync(
				process.execPath,
				[changesetsCli, "publish", "--no-git-tag", "--tag", npmTag],
				{
					cwd: repoRoot,
					env: {
						...process.env,
						NPM_CONFIG_USERCONFIG: path.join(repoRoot, ".npmrc"),
						NPM_CONFIG_PROVENANCE: "false",
					},
					timeout: 60_000,
				},
			);
		};
		await assert.rejects(publish(), /Command failed/);
		assert.deepEqual([...documents.keys()], ["@input/pen-types"]);
		await assert.rejects(
			finishRelease(repoRoot, url, NO_WAIT),
			/pen-core@0\.4\.0/,
		);
		assert.equal(git(remote, "tag", "--list"), "");
		assert.equal(git(repoRoot, "tag", "--list"), "");
		if (newerTrain) {
			for (const name of ["@input/pen-core", "@input/pen-types"]) {
				const document = documents.get(name);
				documents.set(name, {
					name,
					versions: {
						...document?.versions,
						"0.5.0": { name, version: "0.5.0" },
					},
					"dist-tags": { latest: "0.5.0" },
				});
			}
		}
		rejectCore = false;
		await publish();
		await finishRelease(repoRoot, url);
		assert.deepEqual([...documents.keys()].sort(), [
			"@input/pen-core",
			"@input/pen-types",
		]);
		assert.equal(
			documents.get("@input/pen-core").versions["0.4.0"].dependencies[
				"@input/pen-types"
			],
			"^0.4.0",
		);
		for (const name of ["@input/pen-core", "@input/pen-types"]) {
			assert.equal(
				documents.get(name)["dist-tags"].latest,
				newerTrain ? "0.5.0" : "0.4.0",
			);
		}
		const before = git(remote, "show-ref", "--tags");
		await publish();
		await finishRelease(repoRoot, url);
		assert.equal(git(remote, "show-ref", "--tags"), before);
	});
}
