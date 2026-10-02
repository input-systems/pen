# Capturing a real clipboard dump (IOP2)

The fixtures in this directory are synthetic-until-capture. Do not invent
markup and label it captured. Open the application, copy a real document,
and overwrite the files.

Each source needs headings, nested lists, a table, code, a link, an image,
and bold / italic / strike (skip a structure the application cannot emit).

## Per source

| id | Application | Notes |
| --- | --- | --- |
| `word-desktop` | Microsoft Word (desktop) | Copy from a `.docx`, not Word Online |
| `word-web` | Microsoft Word (web) | Word Online in the browser |
| `google-docs` | Google Docs | Docs, not a published-to-web page |
| `apple-notes` | Apple Notes | Notes.app, not the iCloud web UI |
| `notion` | Notion | Desktop or web |
| `vscode` | VS Code | Styled editor copy, not the terminal |
| `article` | Safari | Select a real article in Safari (not Chrome) |
| `excel-sheets` | Excel or Google Sheets | A 2×2-or-larger range |
| `pen` | Pen | Copy from a Pen editor so the HTML flavor is what Pen actually writes |

## Steps

1. Build a short document in the source that exercises the structures above.
2. Select all and copy.
3. Capture the `text/html` and `text/plain` flavors exactly as the paste target receives them. Some native applications, including Apple Notes, put RTF rather than HTML on the macOS pasteboard; for those sources, read `event.clipboardData.getData("text/html")` and `getData("text/plain")` from a browser paste event so the fixture includes the browser's RTF-to-HTML conversion. Do not paste through a chat input or another editor first because it may normalize the payload.

   For sources that place HTML directly on the macOS pasteboard, overwrite the pair from this source directory:

   ```bash
   pbpaste -Prefer public.html > clipboard.html
   pbpaste > plain.txt
   ```

   On other hosts, paste the `text/html` and `text/plain` clipboard flavors
   into those two files without hand-editing afterwards.
4. Replace the `"provenance": "synthetic-until-capture"` string in
   `expectation.json` with a capture record:

   ```json
   "provenance": {
     "kind": "captured",
     "application": "Microsoft Word",
     "version": "Microsoft 365 16.89 (macOS)",
     "capturedAt": "2026-08-21",
     "host": "Safari 18.6"
   }
   ```

   `host` is optional. It is the browser or OS that performed the copy when
   that is not the same as `application` (the article source should name Safari).
5. Run `pnpm --filter @input/pen-interop test src/html/import/__tests__/pasteCorpus.test.ts`.
   The structural assertion will fail. That failure is the finding — update
   `blocks`, `outcomes`, `imageCount`, and `intentionalLosses` to match what
   the generic path actually produced. Do not change the importer to make a
   synthetic expectation pass.
6. Regenerate the committed table and the docs tables:

   ```bash
   pnpm --filter @input/pen-interop test src/html/import/__tests__/pasteCorpus.test.ts
   pnpm --filter @input/pen-docs generate:tables
   ```

   The IOP2 test rewrites nothing; copy the generated markdown from the test
   failure or re-run after updating `PASTE-CORPUS.md` to match
   `renderPasteCorpusMarkdown`. The docs build fails if
   `src/generated/pasteCorpus.ts` drifts.

A payload still labelled `synthetic-until-capture` must stay under 8192
bytes. A real Word dump will trip that ceiling until provenance is set.
