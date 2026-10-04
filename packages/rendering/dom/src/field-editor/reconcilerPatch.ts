import {
	areInlineAtomElementDataEqual,
	copyInlineAtomElementData,
	isInlineAtomChipNode,
	isInlineAtomHostNode,
	isInlineAtomNode,
} from "./inlineAtomDom";

export function patchDOM(target: HTMLElement, source: DocumentFragment): void {
	const targetNodes = Array.from(target.childNodes);
	const sourceNodes = Array.from(source.childNodes);

	let targetIndex = 0;
	let sourceIndex = 0;

	while (sourceIndex < sourceNodes.length) {
		const sourceNode = sourceNodes[sourceIndex];

		if (targetIndex < targetNodes.length) {
			const targetNode = targetNodes[targetIndex];

			if (nodesStructurallyEqual(targetNode, sourceNode)) {
				if (isInlineAtomNode(targetNode) && isInlineAtomNode(sourceNode)) {
					copyInlineAtomElementData(sourceNode, targetNode);
				}
				updateTextContent(targetNode, sourceNode);
			} else {
				target.replaceChild(sourceNode, targetNode);
			}
			targetIndex++;
			sourceIndex++;
		} else {
			target.appendChild(sourceNode);
			sourceIndex++;
		}
	}

	while (target.childNodes.length > sourceNodes.length) {
		target.removeChild(target.lastChild!);
	}
}

function nodesStructurallyEqual(a: Node, b: Node): boolean {
	if (a.nodeType !== b.nodeType) return false;
	if (a.nodeType === Node.TEXT_NODE) return true;
	if (a.nodeType === Node.ELEMENT_NODE) {
		const elementA = a as Element;
		const elementB = b as Element;
		if (isInlineAtomHostNode(elementA) || isInlineAtomHostNode(elementB)) {
			if (
				!isInlineAtomHostNode(elementA) ||
				!isInlineAtomHostNode(elementB)
			) {
				return false;
			}
			if (!areInlineAtomElementDataEqual(elementA, elementB)) {
				return false;
			}
		} else if (isInlineAtomNode(elementA) || isInlineAtomNode(elementB)) {
			if (!isInlineAtomNode(elementA) || !isInlineAtomNode(elementB)) {
				return false;
			}
			if (!areInlineAtomElementDataEqual(elementA, elementB)) {
				return false;
			}
		}
		if (elementA.tagName !== elementB.tagName) return false;
		if (elementA.attributes.length !== elementB.attributes.length)
			return false;
		for (let index = 0; index < elementA.attributes.length; index++) {
			const attribute = elementA.attributes[index];
			if (elementB.getAttribute(attribute.name) !== attribute.value) {
				return false;
			}
		}
		if (elementA.childNodes.length !== elementB.childNodes.length)
			return false;
		for (let index = 0; index < elementA.childNodes.length; index++) {
			if (
				!nodesStructurallyEqual(
					elementA.childNodes[index],
					elementB.childNodes[index],
				)
			) {
				return false;
			}
		}
		return true;
	}
	return true;
}

function updateTextContent(target: Node, source: Node): void {
	if (
		target.nodeType === Node.TEXT_NODE &&
		source.nodeType === Node.TEXT_NODE
	) {
		if (target.textContent !== source.textContent) {
			target.textContent = source.textContent;
		}
		return;
	}
	if (
		target.nodeType === Node.ELEMENT_NODE &&
		source.nodeType === Node.ELEMENT_NODE
	) {
		if (isInlineAtomHostNode(target) && isInlineAtomHostNode(source)) {
			updateInlineAtomHostTextContent(target, source);
			return;
		}
		for (let index = 0; index < target.childNodes.length; index++) {
			updateTextContent(
				target.childNodes[index],
				source.childNodes[index],
			);
		}
	}
}

function updateInlineAtomHostTextContent(target: Node, source: Node): void {
	for (let index = 0; index < target.childNodes.length; index += 1) {
		const targetChild = target.childNodes[index];
		const sourceChild = source.childNodes[index];
		if (!sourceChild) {
			continue;
		}
		if (
			isInlineAtomChipNode(targetChild) &&
			isInlineAtomChipNode(sourceChild)
		) {
			if (targetChild.textContent !== sourceChild.textContent) {
				targetChild.textContent = sourceChild.textContent;
			}
			continue;
		}
		updateTextContent(targetChild, sourceChild);
	}
}
