# @input/pen-test

## .

`./dist/index.d.ts`

### class

- PeerHarnessQuiesceError
- PenFixtureError

### function

- abortHalfwayGenerationParts
- assertDocEquals
- assertDocumentRoots
- assertPeerEditsSurvive
- assertStructuralInvariants
- collectInlineText
- concatenatedInlineText
- countEmptyInlineBlocks
- countMemberships
- createDeterministicYDocFixture
- createModelDouble
- createPeerHarness
- createScanProbe
- createTestCollaboration
- createTestDocument
- createTestEditor
- createTwoPeerHarness
- encodeFixtureUpdate
- failingToolCallParts
- findParentCycle
- findStructuralViolations
- generateMixedBlockSpecs
- getChildrenIds
- getParentId
- hasParentCycle
- hostileMutatingTurnCalls
- listBlockIds
- mixedBlockId
- mixedFixtureIdentity
- mixedFixtureOps
- mixedFixtureTargets
- normalizeDocumentForSnapshot
- parentsOf
- populateYDoc
- resetTestIdCounter
- runBothInterleavings
- runCRDTStateVectorContract
- runExportContract
- runHeadlessEditorContract
- runPeerSchedules
- visibleText

### value

- ASSERT_DOC_EQUALS_FIELDS
- DEFAULT_PEN_ROOTS
- MAX_QUIESCE_ROUNDS
- MIXED_FIXTURE_SIZES
- PEER_HARNESS_MAX_PEERS
- PEER_HARNESS_MIN_PEERS
- PEER_SCHEDULES
- TWO_PEER_INTERLEAVINGS

### type

- AssertPeerEditsSurviveOptions
- CRDTStateVectorContractOptions
- CRDTStateVectorContractResult
- DeterministicYDocFixture
- DeterministicYDocFixtureOptions
- ExportContractOptions
- ExportContractResult
- HeadlessEditorContractOptions
- HeadlessEditorContractResult
- MixedFixtureIdentity
- MixedFixtureTargets
- ModelDouble
- ModelDoubleEvent
- ModelDoubleFeature
- ModelDoubleMalformedPart
- ModelDoubleOptions
- ModelDoublePart
- ModelDoubleResponse
- ModelDoubleToolCall
- NormalizedYDocSnapshot
- NormalizedYjsValue
- Peer
- PeerDeliverOptions
- PeerDeliveryPath
- PeerHarness
- PeerHarnessOptions
- PeerIndex
- PeerSchedule
- PeerScheduleName
- PeerStep
- ScanCounts
- ScanProbe
- StructuralArray
- StructuralViolation
- TestBlock
- TestCollaboration
- TestEditor
- TestEditorOptions
- TestMarkDelta
- TestTableCell
- TestTableRow
- TwoPeer
- TwoPeerHarness
- TwoPeerHarnessOptions
- TwoPeerId
- TwoPeerInterleaving
- YjsRootExpectation
- YjsRootType
