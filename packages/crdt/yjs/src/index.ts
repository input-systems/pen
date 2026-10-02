export { PenDocumentUnreadableError } from "./unreadableError";
export { yjsAdapter } from "./adapter";
export {
	ORIGIN_UNKNOWN_CODE,
	createRemoteUpdateOrigin,
	originToOpOrigin,
} from "./events";
export type {
	YjsAdapterOptions,
	YjsAwarenessFactory,
	CRDTDiagnostic,
} from "./adapter";
export { YJS_SINGLETON_MISMATCH_CODE } from "./yjsSingleton";
export {
	createYjsProviderSession,
	getYjsDoc,
} from "./collaboration/providerSession";
export type {
	YjsProviderAdapter,
	YjsProviderStatus,
} from "./collaboration/providerSession";
export {
	createYjsSubdocument,
	getDocumentProfile,
	initBlockMap,
	isYjsDoc,
	isYjsMap,
	isYjsCRDTDocument,
	setDocumentProfile,
	wrapYjsDocument,
	validateDocument,
	DOCUMENT_PROFILE,
	SUBDOCUMENT,
} from "./document";
export { readFormatStamp, refreshFormatStamp } from "./formatStamp";
export {
	getDocumentLoadReport,
	recordDocumentLoadMigration,
} from "./loadDocument";
export type { DocumentLoadReport, DocumentLoadState } from "./loadDocument";
export type {
	BlockContentType,
	YjsCRDTDocument,
	YjsDoc,
	YjsMap,
	YjsPenDocument,
	DocumentValidationResult,
	DocumentValidationError,
} from "./document";
export {
	compareYjsStateVectorBase64,
	compareYjsStateVectors,
	decodeYjsStateVectorBase64,
	encodeYjsStateVector,
	encodeYjsStateVectorBase64,
	isYjsStateVectorBase64Satisfied,
	isYjsStateVectorSatisfied,
} from "./stateVector";
export type {
	YjsStateVectorComparison,
	YjsStateVectorMissingClient,
} from "./stateVector";
export {
	createYArrayFieldAdapter,
	createYTextFieldAdapter,
} from "./fieldAdapters";
export type {
	CreateYArrayFieldAdapterOptions,
	CreateYTextFieldAdapterOptions,
	YArrayFieldAdapter,
	YTextFieldAdapter,
	YjsFieldObserver,
	YjsFieldUnsubscribe,
} from "./fieldAdapters";
export {
	YjsExtensionRootError,
	ensureExtensionRoot,
	readExtensionRoot,
} from "./extensionRoots";
export type {
	YjsExtensionRoot,
	YjsExtensionRootFieldType,
	YjsExtensionRootOptions,
	YjsExtensionRootReadOptions,
	YjsExtensionRootShape,
} from "./extensionRoots";
export {
	createSummarySource,
	STRUCTURAL_ORIGIN_META_KEY,
} from "./summarySource";
export type {
	RawCommitDelta,
	StructuralOriginTag,
	YArrayDelta,
	YArrayDeltaOp,
	YTextDelta,
	YTextDeltaOp,
} from "./summarySource";
