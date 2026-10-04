/** Element-wise `===` equality of two arrays. */
export function arraysEqual<T>(
	left: readonly T[],
	right: readonly T[],
): boolean {
	if (left.length !== right.length) {
		return false;
	}
	for (let index = 0; index < left.length; index++) {
		if (left[index] !== right[index]) {
			return false;
		}
	}
	return true;
}
