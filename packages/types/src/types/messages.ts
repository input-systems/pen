import type { A11yMessageKey } from "./a11yMessages";

type NoMessageParams = Record<never, never>;

type A11yMessageParams = {
	blockConverted: { blockType: string };
	undoApplied: { hint: string };
	redoApplied: { hint: string };
	blockSelectionEntered: { count: number };
	blockSelectionChanged: { count: number };
	cellSelectionChanged: { rows: number; columns: number };
	suggestionAppeared: NoMessageParams;
	suggestionAccepted: NoMessageParams;
	suggestionRejected: NoMessageParams;
	streamingStarted: NoMessageParams;
	streamingFinished: NoMessageParams;
	findMatches: { count: number };
	atomSelected: { atomType: string };
	collaboratorJoined: { name: string };
	collaboratorEditing: { name: string };
};

export type PluralMessage = {
	readonly other: string;
} & Partial<Record<Exclude<Intl.LDMLPluralRule, "other">, string>>;

export type MessageValue = string | PluralMessage;

export type MessageParamsByKey = {
	[K in A11yMessageKey as `pen.a11y.${K}`]: A11yMessageParams[K];
} & {
	/** AX1: the focus sink's label for a text range in a D5 substitute state; `count` blocks. */
	"pen.a11y.textRangeSelected": { count: number };
	"pen.selection.blocksSelected": { count: number };
	"pen.ai.review.accept": NoMessageParams;
	"pen.schema.paragraph.title": NoMessageParams;
	"pen.schema.paragraph.description": NoMessageParams;
	"pen.schema.paragraph.placeholder": NoMessageParams;
	"pen.schema.heading.title": NoMessageParams;
	"pen.schema.heading.placeholder": NoMessageParams;
	"pen.display.group.basic": NoMessageParams;
	"pen.display.group.lists": NoMessageParams;
	"pen.display.group.other": NoMessageParams;
	"pen.schema.document.emptyPlaceholder": NoMessageParams;
	"pen.editor.label": NoMessageParams;
	"pen.toolbar.formatting": NoMessageParams;
	"pen.drag.reorderBlock": NoMessageParams;
	"pen.blockHandle.reorder": NoMessageParams;
	"pen.blockHandle.moveUp": NoMessageParams;
	"pen.blockHandle.moveDown": NoMessageParams;
	"pen.search.input.placeholder": NoMessageParams;
	"pen.search.input.label": NoMessageParams;
	"pen.search.replace.placeholder": NoMessageParams;
	"pen.search.replace.label": NoMessageParams;
	"pen.search.results.label": NoMessageParams;
	"pen.search.results.none": NoMessageParams;
	"pen.search.results.count": { current: number; count: number };
	"pen.search.next": NoMessageParams;
	"pen.search.previous": NoMessageParams;
	"pen.search.replaceMatch": NoMessageParams;
	"pen.search.replaceAll": NoMessageParams;
	"pen.search.toggle.caseSensitive": NoMessageParams;
	"pen.search.toggle.regex": NoMessageParams;
	"pen.search.toggle.wholeWord": NoMessageParams;
	"pen.slash.input.placeholder": NoMessageParams;
	"pen.slash.list.label": NoMessageParams;
	"pen.suggestion.list.label": NoMessageParams;
	"pen.table.addColumn": NoMessageParams;
	"pen.table.addRow": NoMessageParams;
	"pen.table.columnPlaceholder": { index: number };
	"pen.table.columnMenu.label": { title: string };
	"pen.table.columnMenu.type": NoMessageParams;
	"pen.table.columnMenu.insertLeft": NoMessageParams;
	"pen.table.columnMenu.insertRight": NoMessageParams;
	"pen.table.columnMenu.delete": NoMessageParams;
	"pen.table.columnType.text": NoMessageParams;
	"pen.table.columnType.number": NoMessageParams;
	"pen.table.columnType.select": NoMessageParams;
	"pen.table.columnType.checkbox": NoMessageParams;
	"pen.table.columnType.date": NoMessageParams;
	"pen.table.columnType.url": NoMessageParams;
	"pen.table.columnType.email": NoMessageParams;
	"pen.toggle.collapse": NoMessageParams;
	"pen.toggle.expand": NoMessageParams;
	"pen.toggle.empty": NoMessageParams;
	"pen.checklist.toggle": NoMessageParams;
	"pen.ai.suggestion.previous": NoMessageParams;
	"pen.ai.suggestion.next": NoMessageParams;
	"pen.ai.suggestion.count": { current: number; count: number };
	"pen.ai.suggestion.groupPrevious": NoMessageParams;
	"pen.ai.suggestion.groupNext": NoMessageParams;
	"pen.ai.prompt.placeholder": NoMessageParams;
	"pen.ai.turn.pending": { count: number };
	"pen.ai.turn.working": NoMessageParams;
	"pen.ai.turn.accepted": NoMessageParams;
	"pen.ai.turn.rejected": NoMessageParams;
	"pen.ai.turn.error": NoMessageParams;
	"pen.ai.turn.done": NoMessageParams;
	"pen.ai.review.reject": NoMessageParams;
	"pen.ai.session.inlineEdit": NoMessageParams;
	"pen.ai.session.selectedRange": NoMessageParams;
	"pen.ai.session.selectedText": NoMessageParams;
	"pen.ai.session.targetActive": NoMessageParams;
	"pen.ai.session.targetPinned": NoMessageParams;
	"pen.ai.session.followUp": NoMessageParams;
	"pen.ai.session.runEdit": NoMessageParams;
	"pen.ai.commandMenu.placeholder": NoMessageParams;
	"pen.ai.commandMenu.label": NoMessageParams;
	"pen.ai.command.rewrite": NoMessageParams;
	"pen.ai.command.rewrite.description": NoMessageParams;
	"pen.ai.command.continue": NoMessageParams;
	"pen.ai.command.continue.description": NoMessageParams;
	"pen.ai.command.summarize": NoMessageParams;
	"pen.ai.command.summarize.description": NoMessageParams;
	"pen.ai.command.fixGrammar": NoMessageParams;
	"pen.ai.command.fixGrammar.description": NoMessageParams;
	"pen.ai.command.simplify": NoMessageParams;
	"pen.ai.command.simplify.description": NoMessageParams;
	"pen.ai.command.expand": NoMessageParams;
	"pen.ai.command.expand.description": NoMessageParams;
	"pen.ai.command.translate": NoMessageParams;
	"pen.ai.command.translate.description": NoMessageParams;
	"pen.ai.shortcut.undoInline": NoMessageParams;
	"pen.ai.shortcut.redoInline": NoMessageParams;
	"pen.ai.suggestion.keep": NoMessageParams;
	"pen.ai.suggestion.undo": NoMessageParams;
	"pen.ai.suggestion.heading": NoMessageParams;
	"pen.ai.suggestion.applyHint": NoMessageParams;
	"pen.ai.suggestion.dismiss": NoMessageParams;
	"pen.ai.suggestion.apply": NoMessageParams;
	"pen.ai.suggestion.kind.spelling": NoMessageParams;
	"pen.ai.suggestion.kind.grammar": NoMessageParams;
	"pen.ai.suggestion.kind.clarity": NoMessageParams;
	"pen.ai.suggestion.kind.rephrase": NoMessageParams;
	"pen.ai.suggestion.kind.other": NoMessageParams;
	"pen.ai.review.section.content": NoMessageParams;
	"pen.ai.review.section.block": NoMessageParams;
	"pen.ai.review.section.row": NoMessageParams;
	"pen.ai.review.section.cell": NoMessageParams;
	"pen.ai.review.section.schema": NoMessageParams;
	"pen.ai.review.section.view": NoMessageParams;
	"pen.ai.review.kind.added": NoMessageParams;
	"pen.ai.review.kind.removed": NoMessageParams;
	"pen.ai.review.kind.updated": NoMessageParams;
	"pen.ai.review.kind.moved": NoMessageParams;
	"pen.ai.review.subgroup.content.added": NoMessageParams;
	"pen.ai.review.subgroup.content.removed": NoMessageParams;
	"pen.ai.review.subgroup.content.updated": NoMessageParams;
	"pen.ai.review.subgroup.content.moved": NoMessageParams;
	"pen.ai.review.subgroup.block.added": NoMessageParams;
	"pen.ai.review.subgroup.block.removed": NoMessageParams;
	"pen.ai.review.subgroup.block.updated": NoMessageParams;
	"pen.ai.review.subgroup.block.moved": NoMessageParams;
	"pen.ai.review.subgroup.row.added": NoMessageParams;
	"pen.ai.review.subgroup.row.removed": NoMessageParams;
	"pen.ai.review.subgroup.row.updated": NoMessageParams;
	"pen.ai.review.subgroup.row.moved": NoMessageParams;
	"pen.ai.review.subgroup.cell.added": NoMessageParams;
	"pen.ai.review.subgroup.cell.removed": NoMessageParams;
	"pen.ai.review.subgroup.cell.updated": NoMessageParams;
	"pen.ai.review.subgroup.cell.moved": NoMessageParams;
	"pen.ai.review.subgroup.schema.added": NoMessageParams;
	"pen.ai.review.subgroup.schema.removed": NoMessageParams;
	"pen.ai.review.subgroup.schema.updated": NoMessageParams;
	"pen.ai.review.subgroup.schema.moved": NoMessageParams;
	"pen.ai.review.subgroup.view.added": NoMessageParams;
	"pen.ai.review.subgroup.view.removed": NoMessageParams;
	"pen.ai.review.subgroup.view.updated": NoMessageParams;
	"pen.ai.review.subgroup.view.moved": NoMessageParams;
	"pen.ai.review.action.insert": NoMessageParams;
	"pen.ai.review.action.delete": NoMessageParams;
	"pen.ai.review.action.move": NoMessageParams;
	"pen.ai.review.action.convert": NoMessageParams;
	"pen.ai.review.action.change": NoMessageParams;
	"pen.ai.review.blockSuggestion.insert": { blockType: string };
	"pen.ai.review.blockSuggestion.delete": { blockType: string };
	"pen.ai.review.blockSuggestion.move": { blockType: string };
	"pen.ai.review.blockSuggestion.convert": { blockType: string };
	"pen.ai.review.blockType.fallback": NoMessageParams;
	"pen.ai.review.acceptGroup": NoMessageParams;
	"pen.ai.review.rejectGroup": NoMessageParams;
	"pen.ai.review.acceptSubgroup": NoMessageParams;
	"pen.ai.review.rejectSubgroup": NoMessageParams;
	"pen.ai.review.expand": NoMessageParams;
	"pen.ai.review.collapse": NoMessageParams;
	"pen.ai.review.structuralSuggestion": NoMessageParams;
	"pen.ai.review.noPendingChanges": NoMessageParams;
	"pen.ai.session.close": NoMessageParams;
};

export type MessageKey = keyof MessageParamsByKey;

export type MessageParams<K extends MessageKey> = MessageParamsByKey[K];

export type MessageCatalog = {
	[K in MessageKey]: MessageValue;
};

export type MessageArgs<K extends MessageKey> = [
	keyof MessageParamsByKey[K],
] extends [never]
	? [params?: MessageParamsByKey[K]]
	: [params: MessageParamsByKey[K]];

export const DEFAULT_MESSAGE_CATALOG: MessageCatalog = {
	"pen.a11y.blockConverted": "Converted to {blockType}",
	"pen.a11y.undoApplied": "Undid {hint}",
	"pen.a11y.redoApplied": "Redid {hint}",
	"pen.a11y.blockSelectionEntered": {
		one: "{count} block selected",
		other: "{count} blocks selected",
	},
	"pen.a11y.blockSelectionChanged": {
		one: "{count} block selected",
		other: "{count} blocks selected",
	},
	"pen.a11y.cellSelectionChanged": "{rows} by {columns} cells selected",
	"pen.a11y.suggestionAppeared": "Suggestion appeared",
	"pen.a11y.suggestionAccepted": "Suggestion accepted",
	"pen.a11y.suggestionRejected": "Suggestion rejected",
	"pen.a11y.streamingStarted": "Streaming started",
	"pen.a11y.streamingFinished": "Streaming finished",
	"pen.a11y.findMatches": {
		one: "{count} match",
		other: "{count} matches",
	},
	"pen.a11y.atomSelected": "{atomType} selected",
	"pen.a11y.collaboratorJoined": "{name} joined",
	"pen.a11y.collaboratorEditing": "{name} is editing",
	"pen.a11y.textRangeSelected": {
		one: "Text selected in {count} block",
		other: "Text selected across {count} blocks",
	},
	"pen.selection.blocksSelected": {
		one: "{count} block selected",
		other: "{count} blocks selected",
	},
	"pen.ai.review.accept": "Accept",
	"pen.schema.paragraph.title": "Paragraph",
	"pen.schema.paragraph.description": "Plain text paragraph",
	"pen.schema.paragraph.placeholder": "Text",
	"pen.schema.heading.title": "Heading",
	"pen.schema.heading.placeholder": "Heading",
	"pen.display.group.basic": "Basic",
	"pen.display.group.lists": "Lists",
	"pen.display.group.other": "Other",
	"pen.schema.document.emptyPlaceholder": "Start writing...",
	"pen.editor.label": "Editor",
	"pen.toolbar.formatting": "Formatting",
	"pen.drag.reorderBlock": "Drag to reorder block",
	"pen.blockHandle.reorder": "Reorder block",
	"pen.blockHandle.moveUp": "Move up",
	"pen.blockHandle.moveDown": "Move down",
	"pen.search.input.placeholder": "Search...",
	"pen.search.input.label": "Find in document",
	"pen.search.replace.placeholder": "Replace...",
	"pen.search.replace.label": "Replace with",
	"pen.search.results.label": "Search results",
	"pen.search.results.none": "No matches",
	"pen.search.results.count": {
		one: "{current} of {count} matches",
		other: "{current} of {count} matches",
	},
	"pen.search.next": "Next match",
	"pen.search.previous": "Previous match",
	"pen.search.replaceMatch": "Replace match",
	"pen.search.replaceAll": "Replace all matches",
	"pen.search.toggle.caseSensitive": "Toggle case-sensitive search",
	"pen.search.toggle.regex": "Toggle regular expression search",
	"pen.search.toggle.wholeWord": "Toggle whole-word search",
	"pen.slash.input.placeholder": "Search blocks...",
	"pen.slash.list.label": "Slash menu",
	"pen.suggestion.list.label": "Suggestions",
	"pen.table.addColumn": "Add column",
	"pen.table.addRow": "Add row",
	"pen.table.columnPlaceholder": "Column {index}",
	"pen.table.columnMenu.label": "{title} column",
	"pen.table.columnMenu.type": "Type",
	"pen.table.columnMenu.insertLeft": "← Insert left",
	"pen.table.columnMenu.insertRight": "Insert right →",
	"pen.table.columnMenu.delete": "Delete column",
	"pen.table.columnType.text": "Text",
	"pen.table.columnType.number": "Number",
	"pen.table.columnType.select": "Select",
	"pen.table.columnType.checkbox": "Checkbox",
	"pen.table.columnType.date": "Date",
	"pen.table.columnType.url": "URL",
	"pen.table.columnType.email": "Email",
	"pen.toggle.collapse": "Collapse toggle",
	"pen.toggle.expand": "Expand toggle",
	"pen.toggle.empty": "Empty toggle. Click to add a block.",
	"pen.checklist.toggle": "Toggle checkbox",
	"pen.ai.suggestion.previous": "Previous suggestion",
	"pen.ai.suggestion.next": "Next suggestion",
	"pen.ai.suggestion.count": {
		one: "{current} of {count}",
		other: "{current} of {count}",
	},
	"pen.ai.suggestion.groupPrevious": "Previous suggestion group",
	"pen.ai.suggestion.groupNext": "Next suggestion group",
	"pen.ai.prompt.placeholder": "Edit selection",
	"pen.ai.turn.pending": {
		one: "{count} pending",
		other: "{count} pending",
	},
	"pen.ai.turn.working": "Working",
	"pen.ai.turn.accepted": "Accepted",
	"pen.ai.turn.rejected": "Rejected",
	"pen.ai.turn.error": "Error",
	"pen.ai.turn.done": "Done",
	"pen.ai.review.reject": "Reject",
	"pen.ai.session.inlineEdit": "Inline edit",
	"pen.ai.session.selectedRange": "Selected range",
	"pen.ai.session.selectedText": "Selected text",
	"pen.ai.session.targetActive": "AI target is active",
	"pen.ai.session.targetPinned": "Pinned to the original selection",
	"pen.ai.session.followUp": "Add follow-up",
	"pen.ai.session.runEdit": "Run edit",
	"pen.ai.commandMenu.placeholder": "Search AI commands",
	"pen.ai.commandMenu.label": "AI command menu",
	"pen.ai.command.rewrite": "Rewrite",
	"pen.ai.command.rewrite.description": "Rewrite the selected text",
	"pen.ai.command.continue": "Continue writing",
	"pen.ai.command.continue.description":
		"Continue writing from the current position",
	"pen.ai.command.summarize": "Summarize",
	"pen.ai.command.summarize.description": "Summarize the selected text",
	"pen.ai.command.fixGrammar": "Fix grammar",
	"pen.ai.command.fixGrammar.description": "Fix grammar and spelling",
	"pen.ai.command.simplify": "Simplify",
	"pen.ai.command.simplify.description":
		"Make the text simpler and more concise",
	"pen.ai.command.expand": "Expand",
	"pen.ai.command.expand.description": "Expand the text with more detail",
	"pen.ai.command.translate": "Translate",
	"pen.ai.command.translate.description": "Translate to another language",
	"pen.ai.shortcut.undoInline": "Undo AI inline turn",
	"pen.ai.shortcut.redoInline": "Redo AI inline turn",
	"pen.ai.suggestion.keep": "Keep",
	"pen.ai.suggestion.undo": "Undo",
	"pen.ai.suggestion.heading": "Suggestion",
	"pen.ai.suggestion.applyHint": "Apply to accept this edit.",
	"pen.ai.suggestion.dismiss": "Dismiss",
	"pen.ai.suggestion.apply": "Apply",
	"pen.ai.suggestion.kind.spelling": "Spelling",
	"pen.ai.suggestion.kind.grammar": "Grammar",
	"pen.ai.suggestion.kind.clarity": "Clarity",
	"pen.ai.suggestion.kind.rephrase": "Rephrase",
	"pen.ai.suggestion.kind.other": "Suggestion",
	"pen.ai.review.section.content": "Content changes",
	"pen.ai.review.section.block": "Block changes",
	"pen.ai.review.section.row": "Row changes",
	"pen.ai.review.section.cell": "Cell changes",
	"pen.ai.review.section.schema": "Schema changes",
	"pen.ai.review.section.view": "View changes",
	"pen.ai.review.kind.added": "Added",
	"pen.ai.review.kind.removed": "Removed",
	"pen.ai.review.kind.updated": "Updated",
	"pen.ai.review.kind.moved": "Moved",
	"pen.ai.review.subgroup.content.added": "Content additions",
	"pen.ai.review.subgroup.content.removed": "Content removals",
	"pen.ai.review.subgroup.content.updated": "Content updates",
	"pen.ai.review.subgroup.content.moved": "Content moves",
	"pen.ai.review.subgroup.block.added": "Block additions",
	"pen.ai.review.subgroup.block.removed": "Block removals",
	"pen.ai.review.subgroup.block.updated": "Block updates",
	"pen.ai.review.subgroup.block.moved": "Block moves",
	"pen.ai.review.subgroup.row.added": "Row additions",
	"pen.ai.review.subgroup.row.removed": "Row removals",
	"pen.ai.review.subgroup.row.updated": "Row updates",
	"pen.ai.review.subgroup.row.moved": "Row moves",
	"pen.ai.review.subgroup.cell.added": "Cell additions",
	"pen.ai.review.subgroup.cell.removed": "Cell removals",
	"pen.ai.review.subgroup.cell.updated": "Cell updates",
	"pen.ai.review.subgroup.cell.moved": "Cell moves",
	"pen.ai.review.subgroup.schema.added": "Schema additions",
	"pen.ai.review.subgroup.schema.removed": "Schema removals",
	"pen.ai.review.subgroup.schema.updated": "Schema updates",
	"pen.ai.review.subgroup.schema.moved": "Schema moves",
	"pen.ai.review.subgroup.view.added": "View additions",
	"pen.ai.review.subgroup.view.removed": "View removals",
	"pen.ai.review.subgroup.view.updated": "View updates",
	"pen.ai.review.subgroup.view.moved": "View moves",
	"pen.ai.review.action.insert": "Insert",
	"pen.ai.review.action.delete": "Delete",
	"pen.ai.review.action.move": "Move",
	"pen.ai.review.action.convert": "Convert",
	"pen.ai.review.action.change": "Change",
	"pen.ai.review.blockSuggestion.insert": "Insert {blockType}",
	"pen.ai.review.blockSuggestion.delete": "Delete {blockType}",
	"pen.ai.review.blockSuggestion.move": "Move {blockType}",
	"pen.ai.review.blockSuggestion.convert": "Convert {blockType}",
	"pen.ai.review.blockType.fallback": "block",
	"pen.ai.review.acceptGroup": "Accept group",
	"pen.ai.review.rejectGroup": "Reject group",
	"pen.ai.review.acceptSubgroup": "Accept subgroup",
	"pen.ai.review.rejectSubgroup": "Reject subgroup",
	"pen.ai.review.expand": "Expand",
	"pen.ai.review.collapse": "Collapse",
	"pen.ai.review.structuralSuggestion": "(structural suggestion)",
	"pen.ai.review.noPendingChanges": "No pending changes.",
	"pen.ai.session.close": "Close",
};

export function isMessageKey(value: string): value is MessageKey {
	return Object.prototype.hasOwnProperty.call(DEFAULT_MESSAGE_CATALOG, value);
}

export function isPluralMessage(value: unknown): value is PluralMessage {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { other?: unknown }).other === "string"
	);
}
