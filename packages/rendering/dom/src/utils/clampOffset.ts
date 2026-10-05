/**
 * Clamps an offset into `[0, length]`. Stored length equals logical length
 * (EM5), so this is the whole DOM-to-logical offset mapping.
 */
export function clampOffset(offset: number, length: number): number {
	if (offset < 0) return 0;
	if (offset > length) return length;
	return offset;
}
