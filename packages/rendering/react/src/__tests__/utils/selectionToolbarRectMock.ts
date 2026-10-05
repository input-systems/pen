type RectInit = { top: number; left: number; width: number; height: number };

function toDomRect(rect: RectInit): DOMRect {
	return {
		top: rect.top,
		left: rect.left,
		width: rect.width,
		height: rect.height,
		right: rect.left + rect.width,
		bottom: rect.top + rect.height,
		x: rect.left,
		y: rect.top,
		toJSON() {
			return this;
		},
	} as DOMRect;
}

/**
 * jsdom lays nothing out. Every `Range` measures as `rect`, so the selection
 * toolbar and the contextual prompt, which measure the selection authority
 * through the geometry reader (W3.R5), place themselves there. Animation
 * frames run synchronously. Mutate the returned `rect` to move the geometry.
 */
export function mockMutableSelectionToolbarRect(initialRect: RectInit): {
	rect: RectInit;
	/** The next single `Range` measurement reads `value`, then `rect` again. */
	returnRectOnce: (value: RectInit) => void;
	restore: () => void;
} {
	const rect = { ...initialRect };
	let nextRect: RectInit | null = null;
	const measure = (): DOMRect => {
		const measured = nextRect ?? rect;
		nextRect = null;
		return toDomRect(measured);
	};
	const rangePrototype = Range.prototype as unknown as {
		getBoundingClientRect: () => DOMRect;
		getClientRects: () => DOMRectList | DOMRect[];
	};
	const originalBoundingRect = rangePrototype.getBoundingClientRect;
	const originalClientRects = rangePrototype.getClientRects;
	const originalRequestAnimationFrame =
		window.requestAnimationFrame.bind(window);
	const originalCancelAnimationFrame =
		window.cancelAnimationFrame.bind(window);

	rangePrototype.getBoundingClientRect = measure;
	rangePrototype.getClientRects = () => [measure()];
	Object.defineProperty(window, "requestAnimationFrame", {
		configurable: true,
		value: (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		},
	});
	Object.defineProperty(window, "cancelAnimationFrame", {
		configurable: true,
		value: () => {},
	});

	return {
		rect,
		returnRectOnce: (value) => {
			nextRect = { ...value };
		},
		restore: () => {
			rangePrototype.getBoundingClientRect = originalBoundingRect;
			rangePrototype.getClientRects = originalClientRects;
			Object.defineProperty(window, "requestAnimationFrame", {
				configurable: true,
				value: originalRequestAnimationFrame,
			});
			Object.defineProperty(window, "cancelAnimationFrame", {
				configurable: true,
				value: originalCancelAnimationFrame,
			});
		},
	};
}

/** `mockMutableSelectionToolbarRect` with a fixed rect; returns the restore. */
export function mockSelectionToolbarRect(rect: RectInit): () => void {
	return mockMutableSelectionToolbarRect(rect).restore;
}
