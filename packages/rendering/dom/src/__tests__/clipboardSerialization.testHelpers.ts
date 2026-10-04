export function createClipboardEvent(): {
	event: ClipboardEvent;
	get: (type: string) => string;
} {
	const data = new Map<string, string>();
	const clipboardData = {
		setData(type: string, value: string) {
			data.set(type, value);
		},
		getData(type: string) {
			return data.get(type) ?? "";
		},
	} as unknown as DataTransfer;
	return {
		event: { clipboardData } as ClipboardEvent,
		get: (type: string) => data.get(type) ?? "",
	};
}
