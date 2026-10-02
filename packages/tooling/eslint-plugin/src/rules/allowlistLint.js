import { readFileSync } from "node:fs";
import { REPO_ROOT } from "./lintPaths.js";

/**
 * The allowlist ratchet shared by rules whose waivers live in a committed
 * JSON file: entries load from `scripts/`, an incomplete entry fails, and an
 * entry no site consumed fails (I15), so the list only shrinks with the code.
 */

export function loadAllowlistEntries(relativePath) {
	try {
		const parsed = JSON.parse(
			readFileSync(`${REPO_ROOT}/${relativePath}`, "utf8"),
		);
		return Array.isArray(parsed.entries) ? parsed.entries : [];
	} catch {
		return [];
	}
}

/** The first required field `entry` lacks, or null. */
export function missingAllowlistField(entry, requiredFields) {
	if (!entry || typeof entry !== "object") return "file";
	return (
		requiredFields.find(
			(field) =>
				typeof entry[field] !== "string" ||
				entry[field].trim().length === 0,
		) ?? null
	);
}

/**
 * `Program` reports incomplete entries for this file (or any entry without a
 * file); `Program:exit` reports every slot still `used: false`.
 */
export function allowlistLifecycleListeners(
	context,
	{ allowlist, relative, slots, missingField },
) {
	return {
		Program() {
			for (const entry of allowlist) {
				const field = missingField(entry);
				if (field && (entry?.file === relative || field === "file")) {
					context.report({
						loc: { line: 1, column: 0 },
						messageId: "incompleteAllowlist",
						data: { field },
					});
				}
			}
		},
		"Program:exit"() {
			for (const slot of slots.filter((entry) => !entry.used)) {
				context.report({
					loc: { line: 1, column: 0 },
					messageId: "orphanedAllowlist",
					data: {
						file: slot.file,
						symbol: slot.symbol,
						api: slot.api,
					},
				});
			}
		},
	};
}
