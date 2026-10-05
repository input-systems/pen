export {
	INGEST_FORBIDDEN_KEYS,
	INGEST_MAX_IMAGE_COUNT,
	INGEST_MAX_NESTING_DEPTH,
	INGEST_MAX_NODE_COUNT,
	INGEST_MAX_TEXT_SIZE,
	INGEST_TIME_BUDGET_MS,
} from "../../ingestBounds";
export {
	boundIngestedBlocks,
	boundPendingBlocks,
	capRawTextSource as capRawHtmlSource,
	createIngestReport,
	emitIngestReport,
	IngestDropCounts,
	normalizeIngestedBlocks,
	type IngestDropReason,
	type IngestDroppedByReason,
	type IngestReport,
} from "../../ingestReport";
