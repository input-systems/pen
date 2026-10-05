import { createEditor, defineExtension, urlPolicyFacet } from "@input/pen-core";
import {
	applyYjsAwarenessUpdate,
	encodeYjsAwarenessUpdate,
} from "@input/pen-yjs/awareness";
import { defaultSchema } from "@input/pen-schema";
import { createTestDocument } from "@input/pen-test";
import type { DiagnosticEvent, Editor } from "@input/pen-types";
import { describe, expect, it } from "vitest";
import { MultiplayerControllerImpl } from "../controller";
import { getMultiplayerController, multiplayerExtension } from "../index";
import {
	validateAwarenessStates,
	type AwarenessValidationOptions,
} from "../presence/awarenessValidator";
import { AuthorLedger } from "../presence/authorLedger";
import {
	MAX_PRESENCE_AVATAR_URL_LENGTH,
	MAX_PRESENCE_BLOCK_SELECTION_IDS,
	MAX_PRESENCE_BYTES_PER_PEER,
	MAX_PRESENCE_DISPLAY_NAME_LENGTH,
	MAX_PRESENCE_ANCHOR_LENGTH,
	MAX_PRESENCE_UPDATES_PER_SECOND,
	MAX_PRESENCE_USER_ID_LENGTH,
	MAX_TRACKED_PEERS,
	PRESENCE_REJECTED_CODE,
} from "../presence/constants";
import { ClientIdentityMap } from "../presence/identityMap";
import type {
	MultiplayerAwarenessState,
	MultiplayerCursorPayload,
} from "../types";
import {
	VALID_WIRE_ANCHOR,
	wireCursor,
	wireTextSelection,
} from "./presenceAnchors";

const LOCAL_CLIENT_ID = 1;
const GOOD_PEER_ID = 77;
const BAD_PEER_ID = 88;
const SCRIPT_NAME = '"><script>window.__xssProbe=1</script>';

const GRID_BLOCK_ID = "t1";
const GRID_ROWS = 3;
const GRID_COLS = 4;

const documentView = {
	blockLength(blockId: string): number | null {
		if (blockId === "b1") return 5;
		return blockId === GRID_BLOCK_ID ? 0 : null;
	},
	gridSize(blockId: string): { rows: number; cols: number } | null {
		return blockId === GRID_BLOCK_ID
			? { rows: GRID_ROWS, cols: GRID_COLS }
			: null;
	},
};

const validPeer = {
	user: { id: "u2", name: "Babbage", color: "#abc123" },
	cursor: { anchor: VALID_WIRE_ANCHOR, clock: 10 },
	selection: {
		kind: "text" as const,
		anchor: VALID_WIRE_ANCHOR,
		head: VALID_WIRE_ANCHOR,
		clock: 11,
	},
};

function validate(
	states: Array<[number, unknown]>,
	options?: AwarenessValidationOptions,
) {
	return validateAwarenessStates(
		new Map(states),
		documentView,
		LOCAL_CLIENT_ID,
		options,
	);
}

function withOwnKey(
	base: Record<string, unknown>,
	key: string,
	value: unknown,
): Record<string, unknown> {
	Object.defineProperty(base, key, {
		value,
		enumerable: true,
		configurable: true,
		writable: true,
	});
	return base;
}

function throwingAfterMeasure(): Record<string, unknown> {
	const state: Record<string, unknown> = {
		user: { id: "u-bad", name: "Ada" },
		toJSON() {
			return { user: { id: "u-bad", name: "Ada" } };
		},
	};
	Object.defineProperty(state, "cursor", {
		enumerable: true,
		get() {
			throw new Error("hostile-getter");
		},
	});
	return state;
}

function createPresenceEditor(now?: () => number) {
	const { crdtDoc } = createTestDocument([
		{ id: "b1", type: "paragraph", content: "Hello" },
		{ id: "b2", type: "paragraph", content: "world" },
	]);
	const editor = createEditor({
		schema: defaultSchema,
		document: crdtDoc,
		extensions: [
			multiplayerExtension({
				user: { id: "u1", name: "Ada" },
			}),
		],
	});
	const controller = now
		? new MultiplayerControllerImpl({
				editor,
				config: { user: { id: "u1", name: "Ada" } },
				authorLedger: new AuthorLedger(),
				identityMap: new ClientIdentityMap(),
				now,
			})
		: (getMultiplayerController(editor) as MultiplayerControllerImpl);
	return {
		editor,
		controller,
		diagnostics: listenDiagnostics(editor),
	};
}

function listenDiagnostics(
	editor: ReturnType<typeof createEditor>,
): DiagnosticEvent[] {
	const diagnostics: DiagnosticEvent[] = [];
	editor.on("diagnostic", (event) => {
		diagnostics.push(event);
	});
	return diagnostics;
}

function localState(
	editor: ReturnType<typeof createEditor>,
): [number, MultiplayerAwarenessState] {
	return [editor.clientId, { user: { id: "u1", name: "Ada" } }];
}

function goodPeerState(editor?: Editor): MultiplayerAwarenessState {
	return {
		user: { id: "u-good", name: "Grace", color: "#abc123" },
		cursor: editor
			? wireCursor(editor, 2)
			: { anchor: VALID_WIRE_ANCHOR, clock: 10 },
	};
}

function applyStates(
	controller: MultiplayerControllerImpl,
	editor: ReturnType<typeof createEditor>,
	entries: Array<
		[number, MultiplayerAwarenessState | Record<string, unknown>]
	>,
): void {
	controller.handleAwarenessChange(
		new Map<number, MultiplayerAwarenessState>([
			localState(editor),
			...(entries as Array<[number, MultiplayerAwarenessState]>),
		]),
	);
	editor.requestDecorationUpdate();
}

function goodPeerDecoration(editor: ReturnType<typeof createEditor>) {
	return editor
		.getDecorations()
		.inlineForBlock("b1")
		.find((decoration) => {
			return decoration.attributes?.["data-user-id"] === "u-good";
		});
}

function rejectedReasons(diagnostics: DiagnosticEvent[]): string[] {
	return diagnostics
		.filter((event) => event.code === PRESENCE_REJECTED_CODE)
		.map((event) => String(event.reason));
}

describe("COL2 awareness is untrusted input", () => {
	it("COL2: oversized ignored — payload over the byte cap drops the peer", () => {
		const result = validate([
			[
				BAD_PEER_ID,
				{
					user: { id: "u-bad", name: "TooBig" },
					padding: "x".repeat(MAX_PRESENCE_BYTES_PER_PEER),
				},
			],
		]);

		expect(result.states.has(BAD_PEER_ID)).toBe(false);
		expect(result.rejections).toEqual([
			{ clientId: BAD_PEER_ID, reason: "oversized" },
		]);
	});

	it("COL2: oversized ignored — circular state that cannot be measured drops the peer", () => {
		const circular: Record<string, unknown> = {
			user: { id: "u-bad", name: "Loop" },
		};
		circular.self = circular;

		const result = validate([[BAD_PEER_ID, circular]]);

		expect(result.states.has(BAD_PEER_ID)).toBe(false);
		expect(result.rejections).toEqual([
			{ clientId: BAD_PEER_ID, reason: "oversized" },
		]);
	});

	it("COL2: oversized ignored — over-long user id, name, or avatar drop the peer", () => {
		const cases: unknown[] = [
			{
				user: {
					id: "i".repeat(MAX_PRESENCE_USER_ID_LENGTH + 1),
					name: "Ada",
				},
			},
			{
				user: {
					id: "u-bad",
					name: "n".repeat(MAX_PRESENCE_DISPLAY_NAME_LENGTH + 1),
				},
			},
			{
				user: {
					id: "u-bad",
					name: "Ada",
					avatar: `https://example.com/${"a".repeat(MAX_PRESENCE_AVATAR_URL_LENGTH)}`,
				},
			},
		];

		for (const state of cases) {
			const result = validate([[BAD_PEER_ID, state]]);
			expect(result.states.has(BAD_PEER_ID)).toBe(false);
			expect(result.rejections).toEqual([
				{ clientId: BAD_PEER_ID, reason: "oversized" },
			]);
		}
	});

	it("COL2: oversized ignored — over-long cursor and selection fields drop those fields only", () => {
		const longAnchor = "a".repeat(MAX_PRESENCE_ANCHOR_LENGTH + 1);
		const tooManyBlockIds = Array.from(
			{ length: MAX_PRESENCE_BLOCK_SELECTION_IDS + 1 },
			(_, index) => `b${index}`,
		);

		const cursorResult = validate([
			[
				BAD_PEER_ID,
				{
					user: { id: "u-bad", name: "Ada" },
					cursor: { anchor: longAnchor },
					selection: validPeer.selection,
				},
			],
		]);
		expect(cursorResult.states.get(BAD_PEER_ID)).toEqual({
			user: { id: "u-bad", name: "Ada" },
			cursor: null,
			selection: validPeer.selection,
			streaming: null,
		});
		expect(cursorResult.rejections).toEqual([
			{ clientId: BAD_PEER_ID, reason: "oversized" },
		]);

		const textSelectionResult = validate([
			[
				BAD_PEER_ID,
				{
					user: { id: "u-bad", name: "Ada" },
					cursor: validPeer.cursor,
					selection: {
						anchor: longAnchor,
						head: VALID_WIRE_ANCHOR,
					},
				},
			],
		]);
		expect(textSelectionResult.states.get(BAD_PEER_ID)).toEqual({
			user: { id: "u-bad", name: "Ada" },
			cursor: validPeer.cursor,
			selection: null,
			streaming: null,
		});
		expect(textSelectionResult.rejections).toEqual([
			{ clientId: BAD_PEER_ID, reason: "oversized" },
		]);

		const blockSelectionResult = validate([
			[
				BAD_PEER_ID,
				{
					user: { id: "u-bad", name: "Ada" },
					selection: { kind: "block", blockIds: tooManyBlockIds },
				},
			],
		]);
		expect(blockSelectionResult.states.get(BAD_PEER_ID)).toEqual({
			user: { id: "u-bad", name: "Ada" },
			cursor: null,
			selection: null,
			streaming: null,
		});
		expect(blockSelectionResult.rejections).toEqual([
			{ clientId: BAD_PEER_ID, reason: "oversized" },
		]);
	});

	it("COL2: wrong-typed ignored — non-record, array, and forbidden keys drop the peer", () => {
		const cases: unknown[] = [
			null,
			"presence",
			["user"],
			withOwnKey({ user: { id: "u-bad", name: "Ada" } }, "__proto__", {}),
			withOwnKey(
				{ user: { id: "u-bad", name: "Ada" } },
				"constructor",
				{},
			),
			withOwnKey({ user: { id: "u-bad", name: "Ada" } }, "prototype", {}),
		];

		for (const state of cases) {
			const result = validate([[BAD_PEER_ID, state]]);
			expect(result.states.has(BAD_PEER_ID)).toBe(false);
			expect(result.rejections).toEqual([
				{ clientId: BAD_PEER_ID, reason: "wrong-typed" },
			]);
		}
	});

	it("COL2: wrong-typed ignored — invalid user drops the peer", () => {
		const cases: unknown[] = [
			{ user: null },
			{ user: ["u-bad", "Ada"] },
			{ user: { id: 2, name: "Ada" } },
			{ user: { id: "u-bad", name: 3 } },
			{ user: { id: "u-bad", name: "Ada", color: 12 } },
			{ user: { id: "u-bad", name: "Ada", avatar: false } },
			{
				user: withOwnKey({ id: "u-bad", name: "Ada" }, "__proto__", {}),
			},
		];

		for (const state of cases) {
			const result = validate([[BAD_PEER_ID, state]]);
			expect(result.states.has(BAD_PEER_ID)).toBe(false);
			expect(result.rejections).toEqual([
				{ clientId: BAD_PEER_ID, reason: "wrong-typed" },
			]);
		}
	});

	it("COL2: wrong-typed ignored — invalid cursor and selection drop those fields only", () => {
		const cursorCases: unknown[] = [
			"caret",
			{ blockId: 1, offset: 0 },
			{ blockId: "b1", offset: Number.NaN },
			{ blockId: "b1", offset: 1, clock: "later" },
			withOwnKey({ blockId: "b1", offset: 1 }, "constructor", {}),
		];

		for (const cursor of cursorCases) {
			const result = validate([
				[BAD_PEER_ID, { user: { id: "u-bad", name: "Ada" }, cursor }],
			]);
			expect(result.states.get(BAD_PEER_ID)).toEqual({
				user: { id: "u-bad", name: "Ada" },
				cursor: null,
				selection: null,
				streaming: null,
			});
			expect(result.rejections).toEqual([
				{ clientId: BAD_PEER_ID, reason: "wrong-typed" },
			]);
		}

		const selectionCases: unknown[] = [
			"range",
			{
				kind: "range",
				anchor: validPeer.selection.anchor,
				head: validPeer.selection.head,
			},
			{ kind: "block", blockIds: "b1" },
			{ kind: "block", blockIds: [1] },
			{ ...validPeer.selection, clock: Number.POSITIVE_INFINITY },
			{ head: validPeer.selection.head },
			withOwnKey(
				{
					anchor: validPeer.selection.anchor,
					head: validPeer.selection.head,
				},
				"prototype",
				{},
			),
		];

		for (const selection of selectionCases) {
			const result = validate([
				[
					BAD_PEER_ID,
					{ user: { id: "u-bad", name: "Ada" }, selection },
				],
			]);
			expect(result.states.get(BAD_PEER_ID)).toEqual({
				user: { id: "u-bad", name: "Ada" },
				cursor: null,
				selection: null,
				streaming: null,
			});
			expect(result.rejections).toEqual([
				{ clientId: BAD_PEER_ID, reason: "wrong-typed" },
			]);
		}
	});

	it("COL2: a cell selection inside the grid is accepted", () => {
		const selection = {
			kind: "cell" as const,
			blockId: GRID_BLOCK_ID,
			anchor: { row: 0, col: 0 },
			head: { row: GRID_ROWS - 1, col: GRID_COLS - 1 },
			clock: 12,
		};

		const result = validate([
			[GOOD_PEER_ID, { user: validPeer.user, selection }],
		]);

		expect(result.states.get(GOOD_PEER_ID)?.selection).toEqual(selection);
		expect(result.rejections).toEqual([]);
	});

	it("COL2: a cell outside the grid is rejected at ingest, not at render", () => {
		const cases = [
			{ anchor: { row: GRID_ROWS, col: 0 }, head: { row: 0, col: 0 } },
			{ anchor: { row: 0, col: 0 }, head: { row: 0, col: GRID_COLS } },
			// a block that exists but holds no grid cannot name a cell
			{
				blockId: "b1",
				anchor: { row: 0, col: 0 },
				head: { row: 0, col: 0 },
			},
		];

		for (const { blockId = GRID_BLOCK_ID, anchor, head } of cases) {
			const result = validate([
				[
					BAD_PEER_ID,
					{
						user: { id: "u-bad", name: "Ada" },
						selection: {
							kind: "cell",
							blockId,
							anchor,
							head,
							clock: 12,
						},
					},
				],
			]);
			expect(result.states.get(BAD_PEER_ID)?.selection).toBeNull();
			expect(result.rejections).toEqual([
				{ clientId: BAD_PEER_ID, reason: "out-of-range-cell" },
			]);
		}
	});

	it("COL2: malformed cell coordinates drop the selection only", () => {
		const cases: Array<{ selection: unknown; reason: string }> = [
			{
				selection: {
					kind: "cell",
					blockId: "missing",
					anchor: { row: 0, col: 0 },
					head: { row: 0, col: 0 },
				},
				reason: "nonexistent-block",
			},
			{
				selection: {
					kind: "cell",
					anchor: { row: 0, col: 0 },
					head: { row: 0, col: 0 },
				},
				reason: "wrong-typed",
			},
			{
				selection: {
					kind: "cell",
					blockId: GRID_BLOCK_ID,
					anchor: { row: -1, col: 0 },
					head: { row: 0, col: 0 },
				},
				reason: "wrong-typed",
			},
			{
				selection: {
					kind: "cell",
					blockId: GRID_BLOCK_ID,
					anchor: { row: 0.5, col: 0 },
					head: { row: 0, col: 0 },
				},
				reason: "wrong-typed",
			},
			{
				selection: {
					kind: "cell",
					blockId: GRID_BLOCK_ID,
					anchor: [0, 0],
					head: { row: 0, col: 0 },
				},
				reason: "wrong-typed",
			},
			{
				selection: {
					kind: "cell",
					blockId: GRID_BLOCK_ID,
					anchor: { row: 0, col: 0 },
				},
				reason: "wrong-typed",
			},
		];

		for (const { selection, reason } of cases) {
			const result = validate([
				[
					BAD_PEER_ID,
					{ user: { id: "u-bad", name: "Ada" }, selection },
				],
			]);
			expect(result.states.get(BAD_PEER_ID)).toEqual({
				user: { id: "u-bad", name: "Ada" },
				cursor: null,
				selection: null,
				streaming: null,
			});
			expect(result.rejections).toEqual([
				{ clientId: BAD_PEER_ID, reason },
			]);
		}
	});

	it("COL2: offset-form cursor payloads are wrong-typed after the anchor wire swap", () => {
		const result = validate([
			[
				BAD_PEER_ID,
				{
					user: { id: "u-bad", name: "Ada" },
					cursor: { blockId: "b1", offset: 99 },
				},
			],
		]);

		expect(result.states.get(BAD_PEER_ID)).toEqual({
			user: { id: "u-bad", name: "Ada" },
			cursor: null,
			selection: null,
			streaming: null,
		});
		expect(result.rejections).toEqual([
			{ clientId: BAD_PEER_ID, reason: "wrong-typed" },
		]);
	});

	it("COL2: hostile serialized anchors are dropped before decode", () => {
		const cases: Array<{ anchor: unknown; reason: string }> = [
			{ anchor: 1, reason: "wrong-typed" },
			{ anchor: "", reason: "wrong-typed" },
			{ anchor: { blockId: "b1", offset: 2 }, reason: "wrong-typed" },
			{
				anchor: "a".repeat(MAX_PRESENCE_ANCHOR_LENGTH + 1),
				reason: "oversized",
			},
		];

		for (const { anchor, reason } of cases) {
			const result = validate([
				[
					BAD_PEER_ID,
					{
						user: { id: "u-bad", name: "Ada" },
						cursor: { anchor, clock: 1 },
					},
				],
			]);
			expect(result.states.get(BAD_PEER_ID)).toEqual({
				user: { id: "u-bad", name: "Ada" },
				cursor: null,
				selection: null,
				streaming: null,
			});
			expect(result.rejections).toEqual([
				{ clientId: BAD_PEER_ID, reason },
			]);
		}

		const accepted = validate([
			[
				BAD_PEER_ID,
				{
					user: { id: "u-stale", name: "Ada" },
					cursor: { anchor: VALID_WIRE_ANCHOR, clock: 3 },
				},
			],
		]);
		expect(accepted.states.get(BAD_PEER_ID)?.cursor).toEqual({
			anchor: VALID_WIRE_ANCHOR,
			clock: 3,
		});
		expect(accepted.rejections).toEqual([]);
	});

	it("COL2: a throwing peer state is wrong-typed and does not drop a good peer", () => {
		const result = validate([
			[GOOD_PEER_ID, validPeer],
			[BAD_PEER_ID, throwingAfterMeasure()],
		]);

		expect(result.states.get(GOOD_PEER_ID)).toEqual({
			user: validPeer.user,
			cursor: validPeer.cursor,
			selection: validPeer.selection,
			streaming: null,
		});
		expect(result.states.has(BAD_PEER_ID)).toBe(false);
		expect(result.rejections).toEqual([
			{ clientId: BAD_PEER_ID, reason: "wrong-typed" },
		]);
	});

	it("COL2: control-character script and javascript: strings are script-bearing", () => {
		const cases: Array<{
			user: { id: string; name: string; avatar?: string };
		}> = [
			{
				user: {
					id: "u-nul",
					name: "<\u0000script>window.__xssProbe=1</script>",
				},
			},
			{
				user: {
					id: "u-js",
					name: "Ada",
					avatar: "java\u0000script:alert(1)",
				},
			},
			{
				user: {
					id: "u-bom",
					name: "\uFEFF<script>window.__xssProbe=1</script>",
				},
			},
		];

		for (const state of cases) {
			const result = validate([[BAD_PEER_ID, state]]);
			expect(result.states.has(BAD_PEER_ID)).toBe(false);
			expect(result.rejections).toEqual([
				{ clientId: BAD_PEER_ID, reason: "script-bearing" },
			]);
		}
	});

	it("COL2: entity-escaped and unicode names are not script-bearing; raw markup still is", () => {
		const escaped = validate([
			[
				BAD_PEER_ID,
				{
					user: {
						id: "u-ent",
						name: "&lt;script&gt;alert(1)&lt;/script&gt;",
					},
				},
			],
		]);
		expect(escaped.states.get(BAD_PEER_ID)?.user?.name).toBe(
			"&lt;script&gt;alert(1)&lt;/script&gt;",
		);
		expect(escaped.rejections).toEqual([]);

		const decodedUnicode = validate([
			[
				BAD_PEER_ID,
				{
					user: {
						id: "u-uni",
						name: "<scr\u0069pt>alert(1)</script>",
					},
				},
			],
		]);
		expect(decodedUnicode.states.has(BAD_PEER_ID)).toBe(false);
		expect(decodedUnicode.rejections).toEqual([
			{ clientId: BAD_PEER_ID, reason: "script-bearing" },
		]);
	});

	it("COL2: whitespace and case variants of hostile avatar schemes are dropped", () => {
		const cases = [
			"\tjavascript:alert(1)",
			"JAVASCRIPT:alert(1)",
			" data:text/html,<script>window.__xssProbe=1</script>",
			"data:TEXT/HTML;base64,PHNjcmlwdD48L3NjcmlwdD4=",
			"vbscript:msgbox(1)",
		];

		for (const avatar of cases) {
			const result = validate([
				[
					BAD_PEER_ID,
					{
						user: { id: "u-url", name: "Ada", avatar },
					},
				],
			]);
			expect(result.states.has(BAD_PEER_ID)).toBe(false);
			expect(result.rejections).toEqual([
				{ clientId: BAD_PEER_ID, reason: "script-bearing" },
			]);
		}
	});

	it("COL2: JSON __proto__ pollution and undeclared keys never reach accepted state", () => {
		const polluted = JSON.parse(
			'{"user":{"id":"u-bad","name":"Ada"},"__proto__":{"polluted":true}}',
		) as Record<string, unknown>;
		const protoResult = validate([[BAD_PEER_ID, polluted]]);
		expect(protoResult.states.has(BAD_PEER_ID)).toBe(false);
		expect(protoResult.rejections).toEqual([
			{ clientId: BAD_PEER_ID, reason: "wrong-typed" },
		]);

		const extraKeys = validate([
			[
				BAD_PEER_ID,
				{
					user: {
						id: "u-extra",
						name: "Ada",
						email: "hidden@example.com",
					},
					prompt: "<script>window.__xssProbe=1</script>",
					ai: { role: "admin" },
					cursor: { anchor: VALID_WIRE_ANCHOR, clock: 10 },
				},
			],
		]);
		expect(extraKeys.states.get(BAD_PEER_ID)).toEqual({
			user: { id: "u-extra", name: "Ada" },
			cursor: { anchor: VALID_WIRE_ANCHOR, clock: 10 },
			selection: null,
			streaming: null,
		});
		expect(extraKeys.states.get(BAD_PEER_ID)).not.toHaveProperty("prompt");
		expect(extraKeys.states.get(BAD_PEER_ID)).not.toHaveProperty("ai");
		expect(extraKeys.states.get(BAD_PEER_ID)?.user).not.toHaveProperty(
			"email",
		);
		expect(extraKeys.rejections).toEqual([]);
	});

	it("COL2: a peer's AI streaming presence is accepted only for a live block", () => {
		const accepted = validate([
			[
				GOOD_PEER_ID,
				{ ...validPeer, streaming: { blockId: "b1" } },
			],
		]);
		expect(accepted.states.get(GOOD_PEER_ID)?.streaming).toEqual({
			blockId: "b1",
		});
		expect(accepted.rejections).toEqual([]);

		const cases: Array<{ streaming: unknown; reason: string }> = [
			{ streaming: { blockId: "missing" }, reason: "nonexistent-block" },
			{ streaming: { blockId: 1 }, reason: "wrong-typed" },
			{ streaming: "b1", reason: "wrong-typed" },
			{
				streaming: { blockId: "javascript:alert(1)" },
				reason: "script-bearing",
			},
			{
				streaming: { blockId: "b".repeat(MAX_PRESENCE_USER_ID_LENGTH + 1) },
				reason: "oversized",
			},
		];

		for (const { streaming, reason } of cases) {
			const result = validate([
				[BAD_PEER_ID, { user: { id: "u-bad", name: "Ada" }, streaming }],
			]);
			expect(result.states.get(BAD_PEER_ID)?.streaming).toBeNull();
			expect(result.rejections).toEqual([
				{ clientId: BAD_PEER_ID, reason },
			]);
		}
	});

	it("COL2: a peer's streaming presence carries no prompt or preview text", () => {
		const result = validate([
			[
				GOOD_PEER_ID,
				{
					...validPeer,
					streaming: {
						blockId: "b1",
						prompt: "rewrite this",
						text: "the model's unaccepted draft",
					},
				},
			],
		]);
		// the payload is rebuilt from declared fields, so extra keys a peer
		// bolts on never reach a decoration.
		expect(result.states.get(GOOD_PEER_ID)?.streaming).toEqual({
			blockId: "b1",
		});
		expect(result.rejections).toEqual([]);
	});

	it("COL2: hostile avatar URL ignored — javascript: and data:text/html drop the peer", () => {
		const cases: unknown[] = [
			{
				user: {
					id: "u-bad",
					name: "Ada",
					avatar: "javascript:alert(1)",
				},
			},
			{
				user: {
					id: "u-bad",
					name: "Ada",
					avatar: "data:text/html,<script>window.__xssProbe=1</script>",
				},
			},
		];

		for (const state of cases) {
			const result = validate([[BAD_PEER_ID, state]]);
			expect(result.states.has(BAD_PEER_ID)).toBe(false);
			expect(result.rejections).toEqual([
				{ clientId: BAD_PEER_ID, reason: "script-bearing" },
			]);
		}
	});

	it("COL2: oversized/wrong-typed ignored — a valid peer still appears beside rejected peers", () => {
		const result = validate([
			[LOCAL_CLIENT_ID, { user: { id: "local", name: "Ada" } }],
			[GOOD_PEER_ID, validPeer],
			[
				BAD_PEER_ID,
				{
					user: { id: "u-bad", name: "TooBig" },
					padding: "x".repeat(MAX_PRESENCE_BYTES_PER_PEER),
				},
			],
			[99, null],
		]);

		expect([...result.states.keys()]).toEqual([
			LOCAL_CLIENT_ID,
			GOOD_PEER_ID,
		]);
		expect(result.states.get(GOOD_PEER_ID)).toEqual({
			user: validPeer.user,
			cursor: validPeer.cursor,
			selection: validPeer.selection,
			streaming: null,
		});
		expect(result.rejections).toEqual([
			{ clientId: BAD_PEER_ID, reason: "oversized" },
			{ clientId: 99, reason: "wrong-typed" },
		]);
	});

	it("COL2: oversized and wrong-typed presence emit diagnostics and do not break good peers", () => {
		const { editor, controller, diagnostics } = createPresenceEditor();

		applyStates(controller, editor, [
			[GOOD_PEER_ID, goodPeerState(editor)],
			[
				BAD_PEER_ID,
				{
					user: {
						id: "u-bad",
						name: "x".repeat(MAX_PRESENCE_DISPLAY_NAME_LENGTH + 1),
					},
					cursor: { anchor: VALID_WIRE_ANCHOR, clock: 11 },
				},
			],
			[
				99,
				{
					user: { id: "u-huge", name: "Pad" },
					padding: "x".repeat(MAX_PRESENCE_BYTES_PER_PEER),
					cursor: { anchor: VALID_WIRE_ANCHOR, clock: 12 },
				} as MultiplayerAwarenessState,
			],
			[
				100,
				{
					user: { id: 2, name: "Invalid" },
					cursor: { anchor: VALID_WIRE_ANCHOR, clock: 11 },
				} as unknown as MultiplayerAwarenessState,
			],
		]);

		const decoration = goodPeerDecoration(editor);
		expect(decoration).toBeDefined();
		expect(decoration?.attributes?.["data-user-name"]).toBe("Grace");
		expect(
			editor
				.getDecorations()
				.inlineForBlock("b1")
				.some((item) => {
					return item.attributes?.["data-user-id"] === "u-bad";
				}),
		).toBe(false);
		expect(
			controller.getRemoteCursors().map((cursor) => cursor.clientId),
		).toEqual([GOOD_PEER_ID]);
		expect(rejectedReasons(diagnostics)).toEqual([
			"oversized",
			"oversized",
			"wrong-typed",
		]);

		editor.destroy();
	});

	it("COL2: a throwing peer never reaches a decoration and does not break good peers", () => {
		const { editor, controller, diagnostics } = createPresenceEditor();

		applyStates(controller, editor, [
			[GOOD_PEER_ID, goodPeerState(editor)],
			[BAD_PEER_ID, throwingAfterMeasure() as MultiplayerAwarenessState],
		]);

		expect(goodPeerDecoration(editor)?.attributes?.["data-user-id"]).toBe(
			"u-good",
		);
		expect(
			controller.getRemoteCursors().map((cursor) => cursor.clientId),
		).toEqual([GOOD_PEER_ID]);
		expect(
			editor
				.getDecorations()
				.inlineForBlock("b1")
				.some((item) => {
					return item.attributes?.["data-user-id"] === "u-bad";
				}),
		).toBe(false);
		expect(rejectedReasons(diagnostics)).toEqual(["wrong-typed"]);

		editor.destroy();
	});

	it("COL2: an anchor whose base64 spells an inline handler is accepted", () => {
		// `p` decodes to bytes, not markup, but lowercases to `...u9oncae=`.
		// The HTML heuristics read `oncae=` as an inline handler and dropped
		// roughly one legitimate remote caret in 150, keyed by the Yjs client
		// id that went into the encoded position.
		const result = validate([
			[
				GOOD_PEER_ID,
				{
					user: { id: "u-good", name: "Grace", color: "#abc123" },
					cursor: {
						anchor: '{"v":1,"b":"b1","a":1,"p":"AJXYu9oNCAE="}',
						clock: 10,
					},
				},
			],
		]);

		expect(result.rejections).toEqual([]);
		expect(result.states.get(GOOD_PEER_ID)?.cursor?.anchor).toBe(
			'{"v":1,"b":"b1","a":1,"p":"AJXYu9oNCAE="}',
		);
	});

	it("COL2: a script-bearing anchor never reaches a decoration", () => {
		const { editor, controller } = createPresenceEditor();
		const user = { id: "u-good", name: "Grace", color: "#abc123" };

		// Positive control: the same peer with a real anchor does render, so
		// the negative below cannot pass by rendering nothing at all.
		applyStates(controller, editor, [
			[GOOD_PEER_ID, { user, cursor: wireCursor(editor, 2) }],
		]);
		expect(goodPeerDecoration(editor)?.attributes?.["data-user-id"]).toBe(
			"u-good",
		);

		applyStates(controller, editor, [
			[
				GOOD_PEER_ID,
				{
					user,
					cursor: {
						anchor: "<script>window.__xssProbe=1</script>",
						clock: 11,
					},
				},
			],
		]);

		expect(goodPeerDecoration(editor)).toBeUndefined();
		expect(controller.getRemoteCursors()).toEqual([]);

		editor.destroy();
	});

	it("COL2: script-bearing presence is dropped with a diagnostic and does not break good peers", () => {
		const { editor, controller, diagnostics } = createPresenceEditor();

		applyStates(controller, editor, [
			[GOOD_PEER_ID, goodPeerState(editor)],
			[
				BAD_PEER_ID,
				{
					user: { id: "u-xss", name: SCRIPT_NAME },
					cursor: { anchor: VALID_WIRE_ANCHOR, clock: 11 },
				},
			],
		]);

		const decorations = editor.getDecorations().inlineForBlock("b1");
		expect(goodPeerDecoration(editor)?.attributes?.["data-user-name"]).toBe(
			"Grace",
		);
		expect(
			JSON.stringify(decorations).includes("<script") ||
				JSON.stringify(decorations).includes(SCRIPT_NAME),
		).toBe(false);
		expect(
			decorations.some((decoration) =>
				Object.keys(decoration.attributes ?? {}).some((key) =>
					key.toLowerCase().startsWith("on"),
				),
			),
		).toBe(false);
		expect(
			controller.getRemoteCursors().map((cursor) => cursor.clientId),
		).toEqual([GOOD_PEER_ID]);
		expect(rejectedReasons(diagnostics)).toEqual(["script-bearing"]);

		editor.destroy();
	});

	it("COL2: offset-form presence is dropped with a diagnostic and does not break good peers", () => {
		const { editor, controller, diagnostics } = createPresenceEditor();

		applyStates(controller, editor, [
			[GOOD_PEER_ID, goodPeerState(editor)],
			[
				BAD_PEER_ID,
				{
					user: { id: "u-ghost", name: "Ghost", color: "#abc123" },
					cursor: { blockId: "missing-block", offset: 0, clock: 11 },
					selection: {
						anchor: { blockId: "missing-block", offset: 0 },
						head: { blockId: "b1", offset: 2 },
						clock: 12,
					},
				} as unknown as MultiplayerAwarenessState,
			],
		]);

		expect(goodPeerDecoration(editor)?.attributes?.["data-user-id"]).toBe(
			"u-good",
		);
		expect(
			controller.getRemoteCursors().map((cursor) => cursor.clientId),
		).toEqual([GOOD_PEER_ID]);
		expect(controller.getRemoteSelections()).toEqual([]);
		expect(
			controller.getPeers().some((peer) => peer.clientId === BAD_PEER_ID),
		).toBe(true);
		expect(rejectedReasons(diagnostics)).toEqual(["wrong-typed"]);

		editor.destroy();
	});

	it("COL2: peer cap counts extra peers and keeps already-tracked presence rendering", () => {
		const { editor, controller, diagnostics } = createPresenceEditor();
		const entries: Array<[number, MultiplayerAwarenessState]> = [];
		for (let index = 0; index < MAX_TRACKED_PEERS + 3; index += 1) {
			entries.push([
				100 + index,
				{
					user: {
						id: `u-${index}`,
						name: `Peer ${index}`,
						color: "#abc123",
					},
					cursor: wireCursor(editor, 1, index),
				},
			]);
		}

		applyStates(controller, editor, entries);

		expect(controller.getRemoteCursors()).toHaveLength(MAX_TRACKED_PEERS);
		expect(controller.getPeers()).toHaveLength(MAX_TRACKED_PEERS);
		expect(rejectedReasons(diagnostics)).toEqual(["peer-cap"]);
		expect(
			diagnostics.find((event) => event.reason === "peer-cap")
				?.untrackedPeerCount,
		).toBe(3);

		editor.destroy();
	});

	it("COL2: offset-form out-of-range presence is dropped with a diagnostic and does not break good peers", () => {
		const { editor, controller, diagnostics } = createPresenceEditor();

		expect(() => {
			applyStates(controller, editor, [
				[GOOD_PEER_ID, goodPeerState(editor)],
				[
					BAD_PEER_ID,
					{
						user: { id: "u-far", name: "Far", color: "#abc123" },
						cursor: {
							blockId: "b1",
							offset: 99,
							clock: 11,
						} as unknown as MultiplayerCursorPayload,
					},
				],
			]);
		}).not.toThrow();

		expect(goodPeerDecoration(editor)?.attributes?.["data-user-id"]).toBe(
			"u-good",
		);
		expect(
			controller.getRemoteCursors().map((cursor) => cursor.clientId),
		).toEqual([GOOD_PEER_ID]);
		expect(rejectedReasons(diagnostics)).toEqual(["wrong-typed"]);

		editor.destroy();
	});

	it("COL2: a commitId-tagged absurd offset never reaches a remote-cursor decoration", () => {
		const { editor, controller, diagnostics } = createPresenceEditor();

		applyStates(controller, editor, [
			[GOOD_PEER_ID, goodPeerState(editor)],
			[
				BAD_PEER_ID,
				{
					user: { id: "u-far", name: "Far", color: "#abc123" },
					cursor: {
						blockId: "b1",
						offset: Number.MAX_VALUE,
						clock: 11,
						commitId: 1,
					} as unknown as MultiplayerCursorPayload,
				},
			],
		]);

		expect(goodPeerDecoration(editor)?.attributes?.["data-user-id"]).toBe(
			"u-good",
		);
		expect(
			controller.getRemoteCursors().map((cursor) => cursor.clientId),
		).toEqual([GOOD_PEER_ID]);
		expect(
			editor
				.getDecorations()
				.inlineForBlock("b1")
				.some((item) => {
					return (
						item.from === Number.MAX_VALUE ||
						item.to === Number.MAX_VALUE
					);
				}),
		).toBe(false);
		expect(rejectedReasons(diagnostics)).toEqual(["wrong-typed"]);

		editor.destroy();
	});

	it("COL2: applyYjsAwarenessUpdate is not a second path — ingest still rejects the payload", () => {
		const { editor, controller, diagnostics } = createPresenceEditor();
		const remote = createPresenceEditor();
		const remoteAwareness = remote.editor.internals.awareness;
		const target = editor.internals.awareness;
		expect(remote.editor.clientId).not.toBe(editor.clientId);
		expect(remoteAwareness && target).toBeTruthy();
		if (!remoteAwareness || !target) {
			remote.editor.destroy();
			editor.destroy();
			return;
		}

		remoteAwareness.setLocalState({
			user: { id: "u-wire", name: SCRIPT_NAME },
			cursor: { anchor: VALID_WIRE_ANCHOR, clock: 11 },
		});
		applyYjsAwarenessUpdate(
			target,
			encodeYjsAwarenessUpdate(
				remoteAwareness,
				Array.from(remoteAwareness.getStates().keys()),
			),
		);
		controller.handleAwarenessChange(target.getStates());
		editor.requestDecorationUpdate();

		expect(
			JSON.stringify(
				editor.getDecorations().inlineForBlock("b1"),
			).includes("<script"),
		).toBe(false);
		expect(
			controller
				.getRemoteCursors()
				.some((cursor) => cursor.user.id === "u-wire"),
		).toBe(false);
		expect(rejectedReasons(diagnostics)).toContain("script-bearing");

		remote.editor.destroy();
		editor.destroy();
	});

	it("COL2: hostile avatar URL is dropped with a diagnostic and does not break good peers", () => {
		const { editor, controller, diagnostics } = createPresenceEditor();

		expect(() => {
			applyStates(controller, editor, [
				[GOOD_PEER_ID, goodPeerState(editor)],
				[
					BAD_PEER_ID,
					{
						user: {
							id: "u-js",
							name: "Hostile",
							avatar: "javascript:alert(1)",
						},
						cursor: { anchor: VALID_WIRE_ANCHOR, clock: 11 },
					},
				],
				[
					99,
					{
						user: {
							id: "u-html",
							name: "Hostile",
							avatar: "data:text/html,<script>window.__xssProbe=1</script>",
						},
						cursor: { anchor: VALID_WIRE_ANCHOR, clock: 12 },
					},
				],
			]);
		}).not.toThrow();

		expect(goodPeerDecoration(editor)?.attributes?.["data-user-id"]).toBe(
			"u-good",
		);
		expect(
			controller.getRemoteCursors().map((cursor) => cursor.clientId),
		).toEqual([GOOD_PEER_ID]);
		expect(rejectedReasons(diagnostics)).toEqual([
			"script-bearing",
			"script-bearing",
		]);

		editor.destroy();
	});

	it("COL2: peer-cap flood stays at MAX_TRACKED_PEERS and never throws", () => {
		const { editor, controller, diagnostics } = createPresenceEditor();
		const floodCount = MAX_TRACKED_PEERS * 64;
		const entries: Array<[number, MultiplayerAwarenessState]> = [];
		for (let index = 0; index < floodCount; index += 1) {
			entries.push([
				100 + index,
				{
					user: {
						id: `u-${index}`,
						name: `Peer ${index}`,
						color: "#abc123",
					},
					cursor: wireCursor(editor, 1, index),
				},
			]);
		}

		expect(() => {
			applyStates(controller, editor, entries);
		}).not.toThrow();

		expect(controller.getRemoteCursors()).toHaveLength(MAX_TRACKED_PEERS);
		expect(controller.getPeers()).toHaveLength(MAX_TRACKED_PEERS);
		expect(
			diagnostics.find((event) => event.reason === "peer-cap")
				?.untrackedPeerCount,
		).toBe(floodCount - MAX_TRACKED_PEERS);

		applyStates(controller, editor, [
			[
				100,
				{
					user: { id: "u-0", name: "Peer 0", color: "#abc123" },
					cursor: wireCursor(editor, 3, 9_001),
				},
			],
			...entries.slice(1),
		]);
		expect(
			controller
				.getRemoteCursors()
				.find((cursor) => cursor.clientId === 100)?.offset,
		).toBe(3);
		expect(controller.getRemoteCursors()).toHaveLength(MAX_TRACKED_PEERS);
		expect(controller.getPeers()).toHaveLength(MAX_TRACKED_PEERS);

		editor.destroy();
	});

	it("COL2: CSS-injectable color is stripped at ingest and never reaches a decoration", () => {
		const injected = "red;position:absolute";
		const result = validate([
			[
				BAD_PEER_ID,
				{
					user: { id: "u-css", name: "Ada", color: injected },
					cursor: { anchor: VALID_WIRE_ANCHOR, clock: 10 },
				},
			],
		]);

		expect(result.states.get(BAD_PEER_ID)?.user).toEqual({
			id: "u-css",
			name: "Ada",
		});
		expect(result.states.get(BAD_PEER_ID)?.user?.color).toBeUndefined();
		expect(result.rejections).toEqual([]);

		const { editor, controller } = createPresenceEditor();
		applyStates(controller, editor, [
			[
				BAD_PEER_ID,
				{
					user: { id: "u-css", name: "Ada", color: injected },
					cursor: wireCursor(editor, 2, 10),
				},
			],
		]);

		const decoration = editor
			.getDecorations()
			.inlineForBlock("b1")
			.find((item) => item.attributes?.["data-user-id"] === "u-css");
		expect(decoration).toBeDefined();
		expect(decoration?.attributes?.style).toBeUndefined();
		expect(JSON.stringify(decoration?.attributes)).not.toContain(injected);

		editor.destroy();
	});

	it("COL2: avatar URLs go through urlPolicy and keep only image schemes", () => {
		const httpsAvatar = "https://example.com/a.png";
		const admitted = validate([
			[
				BAD_PEER_ID,
				{
					user: { id: "u-img", name: "Ada", avatar: httpsAvatar },
				},
			],
		]);
		expect(admitted.states.get(BAD_PEER_ID)?.user?.avatar).toBe(
			httpsAvatar,
		);
		expect(admitted.rejections).toEqual([]);

		const svg = validate([
			[
				BAD_PEER_ID,
				{
					user: {
						id: "u-svg",
						name: "Ada",
						avatar: "data:image/svg+xml,<svg></svg>",
					},
				},
			],
		]);
		expect(svg.states.has(BAD_PEER_ID)).toBe(false);
		expect(svg.rejections).toEqual([
			{ clientId: BAD_PEER_ID, reason: "script-bearing" },
		]);

		const mailto = validate([
			[
				BAD_PEER_ID,
				{
					user: {
						id: "u-mail",
						name: "Ada",
						avatar: "mailto:user@example.com",
					},
				},
			],
		]);
		expect(mailto.states.get(BAD_PEER_ID)?.user?.avatar).toBeUndefined();
		expect(mailto.rejections).toEqual([]);

		const denied = validate(
			[
				[
					BAD_PEER_ID,
					{
						user: {
							id: "u-deny",
							name: "Ada",
							avatar: httpsAvatar,
						},
					},
				],
			],
			{ resolveAvatarUrl: () => null },
		);
		expect(denied.states.get(BAD_PEER_ID)?.user?.avatar).toBeUndefined();
		expect(denied.states.has(BAD_PEER_ID)).toBe(true);
		expect(denied.rejections).toEqual([]);
	});

	it("COL2: host pen.urlPolicy can deny an otherwise-valid avatar at ingest", () => {
		const { crdtDoc } = createTestDocument([
			{ id: "b1", type: "paragraph", content: "Hello" },
		]);
		const editor = createEditor({
			schema: defaultSchema,
			document: crdtDoc,
			extensions: [
				defineExtension({
					name: "deny-avatars",
					facets: [urlPolicyFacet.of({ resolve: () => null })],
				}),
				multiplayerExtension({
					user: { id: "u1", name: "Ada" },
				}),
			],
		});
		const controller = getMultiplayerController(
			editor,
		) as MultiplayerControllerImpl;

		applyStates(controller, editor, [
			[
				GOOD_PEER_ID,
				{
					user: {
						id: "u-good",
						name: "Grace",
						avatar: "https://example.com/a.png",
					},
					cursor: { anchor: VALID_WIRE_ANCHOR, clock: 10 },
				},
			],
		]);

		expect(controller.getPeers()[0]?.user.avatar).toBeUndefined();
		expect(controller.getRemoteCursors()[0]?.user.avatar).toBeUndefined();
		editor.destroy();
	});

	it("COL2: per-peer update rate limit keeps the last accepted presence", () => {
		let now = 1_000_000;
		const { editor, controller, diagnostics } = createPresenceEditor(
			() => now,
		);

		for (
			let index = 0;
			index < MAX_PRESENCE_UPDATES_PER_SECOND;
			index += 1
		) {
			now += 1;
			applyStates(controller, editor, [
				[
					GOOD_PEER_ID,
					{
						user: { id: "u-good", name: "Grace", color: "#abc123" },
						cursor: wireCursor(editor, index % 5, index),
					},
				],
			]);
		}

		const acceptedOffset = controller.getRemoteCursors()[0]?.offset;
		now += 1;
		applyStates(controller, editor, [
			[
				GOOD_PEER_ID,
				{
					user: { id: "u-good", name: "Grace", color: "#abc123" },
					cursor: wireCursor(editor, 4, 99),
				},
			],
		]);

		expect(controller.getRemoteCursors()[0]?.offset).toBe(acceptedOffset);
		expect(controller.getRemoteCursors()[0]?.clock).not.toBe(99);
		expect(rejectedReasons(diagnostics)).toContain("rate-limited");

		now += 1_000;
		applyStates(controller, editor, [
			[
				GOOD_PEER_ID,
				{
					user: { id: "u-good", name: "Grace", color: "#abc123" },
					cursor: wireCursor(editor, 4, 100),
				},
			],
		]);
		expect(controller.getRemoteCursors()[0]?.offset).toBe(4);

		editor.destroy();
	});

	it("COL2: rate-limit flood keeps one cursor and never throws", () => {
		// The clock is held still so the whole flood lands in one rate-limit
		// window: the cap is what a peer gets per second, so a flood that
		// straddled two windows would be allowed twice the cap.
		const now = 1_000_000;
		const { editor, controller, diagnostics } = createPresenceEditor(
			() => now,
		);
		const floodCount = MAX_PRESENCE_UPDATES_PER_SECOND * 64;

		expect(() => {
			for (let index = 0; index < floodCount; index += 1) {
				applyStates(controller, editor, [
					[
						GOOD_PEER_ID,
						{
							user: {
								id: "u-good",
								name: "Grace",
								color: "#abc123",
							},
							cursor: wireCursor(editor, index % 5, index),
						},
					],
				]);
			}
		}).not.toThrow();

		expect(controller.getRemoteCursors()).toHaveLength(1);
		expect(controller.getPeers()).toHaveLength(1);
		expect(
			diagnostics.filter((event) => event.reason === "rate-limited")
				.length,
		).toBe(floodCount - MAX_PRESENCE_UPDATES_PER_SECOND);
		expect(controller.getRemoteCursors()[0]?.clock).toBeLessThan(
			MAX_PRESENCE_UPDATES_PER_SECOND,
		);

		editor.destroy();
	});
});
