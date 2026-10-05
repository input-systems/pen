import { createEditor } from "@input/pen-core";
import type { DiagnosticEvent, PenStreamPart } from "@input/pen-types";
import { defaultSchema } from "@input/pen-schema";
import { deltaStreamExtension } from "../deltaStreamExtension";
import { undoExtension } from "@input/pen-undo";

export function listenDiagnostics(
	editor: ReturnType<typeof createEditor>,
): DiagnosticEvent[] {
	const diagnostics: DiagnosticEvent[] = [];
	editor.on("diagnostic", (event) => {
		diagnostics.push(event);
	});
	return diagnostics;
}

export function createStreamEditor() {
	return createEditor({
		schema: defaultSchema,
		extensions: [undoExtension(), deltaStreamExtension()],
	});
}

export async function* createStream(parts: PenStreamPart[]) {
	for (const part of parts) {
		yield part;
	}
}
