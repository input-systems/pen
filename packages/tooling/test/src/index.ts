export type {
	TestBlock,
	TestEditorOptions,
	TestEditor,
	TestCollaboration,
	TestMarkDelta,
	TestTableCell,
	TestTableRow,
	DeterministicYDocFixture,
	DeterministicYDocFixtureOptions,
	NormalizedYDocSnapshot,
	NormalizedYjsValue,
	YjsRootExpectation,
	YjsRootType,
	TwoPeer,
	TwoPeerHarness,
	TwoPeerHarnessOptions,
	TwoPeerId,
	TwoPeerInterleaving,
} from "./types";
export { createTestDocument, populateYDoc } from "./createTestDocument";
export { createTestEditor } from "./createTestEditor";
export { ASSERT_DOC_EQUALS_FIELDS, assertDocEquals } from "./assertDocEquals";
export { assertPeerEditsSurvive } from "./assertPeerEditsSurvive";
export type { AssertPeerEditsSurviveOptions } from "./assertPeerEditsSurvive";
export { createTestCollaboration } from "./createTestCollaboration";
export {
	createTwoPeerHarness,
	runBothInterleavings,
	TWO_PEER_INTERLEAVINGS,
} from "./twoPeerHarness";
export {
	collectInlineText,
	concatenatedInlineText,
	countEmptyInlineBlocks,
	countMemberships,
	findParentCycle,
	getChildrenIds,
	getParentId,
	hasParentCycle,
	listBlockIds,
	parentsOf,
	visibleText,
} from "./twoPeerInspect";
// simulateKeypress / simulateTyping stay off the barrel. Hosts call
// those methods on the TestEditor returned by createTestEditor.
export { resetTestIdCounter } from "./helpers";
export {
	DEFAULT_PEN_ROOTS,
	PenFixtureError,
	assertDocumentRoots,
	createDeterministicYDocFixture,
	encodeFixtureUpdate,
	normalizeDocumentForSnapshot,
} from "./fixtures";
export {
	runCRDTStateVectorContract,
	runExportContract,
	runHeadlessEditorContract,
} from "./contracts";
export type {
	CRDTStateVectorContractOptions,
	CRDTStateVectorContractResult,
	ExportContractOptions,
	ExportContractResult,
	HeadlessEditorContractOptions,
	HeadlessEditorContractResult,
} from "./contracts";
export {
	createModelDouble,
	abortHalfwayGenerationParts,
	failingToolCallParts,
	hostileMutatingTurnCalls,
} from "./modelDouble";
export type {
	ModelDouble,
	ModelDoubleEvent,
	ModelDoubleFeature,
	ModelDoubleMalformedPart,
	ModelDoubleOptions,
	ModelDoublePart,
	ModelDoubleResponse,
	ModelDoubleToolCall,
} from "./modelDouble";
export {
	MIXED_FIXTURE_SIZES,
	generateMixedBlockSpecs,
	mixedBlockId,
	mixedFixtureIdentity,
	mixedFixtureOps,
	mixedFixtureTargets,
} from "./fixtures/scale/mixed";
export type {
	MixedFixtureIdentity,
	MixedFixtureTargets,
} from "./fixtures/scale/mixed";
export { createScanProbe } from "./scanProbe";
export type { ScanCounts, ScanProbe } from "./scanProbe";
