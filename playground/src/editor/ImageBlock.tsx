import type { ChangeEvent, ReactElement, Ref } from "react";
import { ImageRenderer, useEditorContext } from "@input/pen-react";
import { uploadImageFiles } from "@input/pen-dom/field-editor/transferImages";
import type { BlockHandle, BlockRenderContext } from "@input/pen-types";
import { playgroundAssets } from "./assets";

/**
 * The image block, plus a way to fill an empty one.
 *
 * Pen's own renderer draws whatever `src` the block carries and has no opinion
 * about where bytes come from, so an image block picked from the slash menu —
 * which starts with no `src` — would render as a broken image. Once there is a
 * `src` this hands straight back to that renderer; until then it offers a file
 * picker and uploads through the same provider paste and drop use.
 */
export function ImageBlockRenderer(
	block: BlockHandle,
	ctx: BlockRenderContext,
): ReactElement {
	const src = block.props?.src;
	if (typeof src === "string" && src.length > 0) {
		return ImageRenderer(block, ctx);
	}
	return <ImagePicker block={block} ctx={ctx} />;
}

function ImagePicker({
	block,
	ctx,
}: {
	block: BlockHandle;
	ctx: BlockRenderContext;
}) {
	const { editor, readonly } = useEditorContext();

	const handleChange = async (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		// let the same file be picked again after a failed upload
		event.target.value = "";
		if (!file) {
			return;
		}

		// oversize files and provider errors leave an `asset-upload-failed`
		// diagnostic on the editor and return nothing, so the block stays empty
		// rather than gaining a src that resolves to nothing.
		const [uploaded] = await uploadImageFiles([file], playgroundAssets, {
			editor,
		});
		if (!uploaded) {
			return;
		}

		// an upload is slow enough that the block can be deleted or undone out
		// from under it; setting props on a block that is gone would resurrect
		// nothing and log a dropped op.
		if (!editor.getBlock(block.id)) {
			return;
		}

		editor.apply(
			[
				{
					type: "set-props",
					blockId: block.id,
					props: { src: uploaded.src, alt: uploaded.alt },
				},
			],
			{ origin: "user", undoGroup: true },
		);
	};

	return (
		<figure
			ref={ctx.ref as Ref<HTMLElement>}
			data-block-type="image"
			data-image-empty=""
			data-selected={ctx.selected ? "" : undefined}
		>
			<label>
				<input
					type="file"
					accept="image/*"
					disabled={readonly}
					onChange={handleChange}
				/>
				Choose an image
			</label>
		</figure>
	);
}
