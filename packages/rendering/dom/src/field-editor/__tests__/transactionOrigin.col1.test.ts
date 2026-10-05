import { HISTORY_ORIGIN_TAG } from "@input/pen-types";
import { describe, expect, it } from "vitest";
import {
	isCollaboratorTransaction,
	isHistoryTransactionOrigin,
} from "../transactionOrigin";

class ProviderLike {}

describe("COL1 transaction classification for raw Y.Text observers", () => {
	it("COL1: a non-local transaction is a collaborator edit whatever its origin object", () => {
		for (const origin of [
			{},
			new ProviderLike(),
			"remote",
			null,
			{ type: "user" },
		]) {
			expect(isCollaboratorTransaction({ local: false, origin })).toBe(true);
		}
	});

	it("COL1: a structured collaborator origin is a collaborator edit even when local", () => {
		expect(
			isCollaboratorTransaction({
				local: true,
				origin: { type: "collaborator" },
			}),
		).toBe(true);
	});

	it("COL1: a string origin is never compared, so a local \"collaborator\" string is not one", () => {
		expect(
			isCollaboratorTransaction({ local: true, origin: "collaborator" }),
		).toBe(false);
		expect(isCollaboratorTransaction({ local: true, origin: "remote" })).toBe(
			false,
		);
	});

	it("COL1: local user, history, and missing transactions are not collaborator edits", () => {
		const history = { [HISTORY_ORIGIN_TAG]: true };
		expect(isHistoryTransactionOrigin(history)).toBe(true);
		expect(isCollaboratorTransaction({ local: true, origin: history })).toBe(
			false,
		);
		expect(
			isCollaboratorTransaction({ local: true, origin: { type: "user" } }),
		).toBe(false);
		expect(isCollaboratorTransaction(undefined)).toBe(false);
	});
});
