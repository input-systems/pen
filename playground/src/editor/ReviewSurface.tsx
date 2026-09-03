import type { ReactNode } from "react";
import { useAIActions, useSuggestions } from "@input/pen-react";
import type { Editor } from "@input/pen-types";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { keepCaret } from "../ui/keepCaret";
import { ScrollArea } from "../ui/ScrollArea";
import {
	describeSuggestionChange,
	describeSuggestionLocation,
	isDeletion,
	sortSuggestionsByDocumentOrder,
	suggestionActionLabel,
} from "./reviewSuggestions";

interface ReviewSurfaceProps {
	editor: Editor;
	children: ReactNode;
}

/**
 * Hosts the document review bar.
 *
 * Accept and reject stay on the AI controller — this is presentation, not a
 * second suggestion store. The bar is the only review surface: one list in
 * document order, no floating controls competing for geometry.
 */
export function ReviewSurface({ editor, children }: ReviewSurfaceProps) {
	const suggestions = useSuggestions(editor);
	const aiActions = useAIActions(editor);

	const pendingCount = suggestions.length;
	const orderedSuggestions = sortSuggestionsByDocumentOrder(
		editor,
		suggestions,
	);

	const suggestionRows = orderedSuggestions.map((suggestion) => (
		<ReviewChangeRow
			key={suggestion.id}
			badge={suggestionActionLabel(suggestion)}
			badgeColor={
				isDeletion(suggestion)
					? "var(--palette-b40)"
					: "var(--palette-purple)"
			}
			where={describeSuggestionLocation(editor, suggestion)}
			summary={describeSuggestionChange(editor, suggestion)}
			onAccept={() => aiActions.acceptSuggestion(suggestion.id)}
			onReject={() => aiActions.rejectSuggestion(suggestion.id)}
		/>
	));

	const reviewBar =
		pendingCount > 0 ? (
			<div className="review-bar">
				<div className="review-bar-copy">
					{pendingCount === 1
						? "1 proposed change"
						: `${pendingCount} proposed changes`}
				</div>
				<div className="review-bar-actions">
					<Button
						kind="faded"
						size="sm"
						onClick={aiActions.rejectAllSuggestions}
					>
						Reject all
					</Button>
					<Button
						kind="primary"
						size="sm"
						onClick={aiActions.acceptAllSuggestions}
					>
						Accept all
					</Button>
				</div>
				<div className="review-change-list">
					<ScrollArea>{suggestionRows}</ScrollArea>
				</div>
			</div>
		) : null;

	return (
		<div className="review-surface">
			{children}
			{reviewBar}
		</div>
	);
}

interface ReviewChangeRowProps {
	badge: string;
	badgeColor: string;
	where: string;
	summary: string;
	onAccept: () => void;
	onReject: () => void;
}

function ReviewChangeRow({
	badge,
	badgeColor,
	where,
	summary,
	onAccept,
	onReject,
}: ReviewChangeRowProps) {
	return (
		<div className="review-change-row">
			<Badge color={badgeColor}>{badge}</Badge>
			<div className="review-change-copy">
				<div className="review-change-where">{where}</div>
				<div className="review-change-summary">{summary}</div>
			</div>
			<div className="review-change-actions">
				<Button
					kind="faded"
					size="sm"
					onMouseDown={keepCaret}
					onClick={onReject}
				>
					Reject
				</Button>
				<Button
					kind="primary"
					size="sm"
					onMouseDown={keepCaret}
					onClick={onAccept}
				>
					Accept
				</Button>
			</div>
		</div>
	);
}
