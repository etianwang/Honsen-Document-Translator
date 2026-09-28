# Layout V2: Vector Cells and Safe Writable Regions

## Goal

Preserve the source page while ensuring translated text stays in its intended table cell or text region. Text coordinates identify source content; they are not automatically the writable area for a translation.

## Current V2 behavior

1. `pdf-parser` reads PDF.js text items, image placements, and vector-path bounding boxes in PDF coordinates.
2. `layout-engine` looks for at least six connected vector rectangles. This identifies bordered table pages such as the BETHEL documents.
3. Each detected rectangle becomes a `TableCellModel`. Text runs are assigned to a cell only when their center lies inside that cell.
4. Text assigned to a cell is removed from the fallback text blocks, preventing a row-wide translation from crossing into adjacent columns or images.
5. When vector geometry is absent or unreliable, the existing coordinate-based fallback remains active. Lines with clear column gaps or image overlap are translated as separate original text runs.

## Deliberate limits

- This version uses path bounding boxes; it does not yet snap individual horizontal and vertical strokes into a complete grid.
- Merged cells and unbordered tables remain fallback cases.
- Image collision currently triggers run-level fallback. A final collision validator and automatic multi-line fitting are the next upgrade.
- Preview and PDF export share translated placements, but final font fitting is not yet a single reusable layout result.

## Manual test procedure

1. Start the desktop app with `pnpm tauri dev`.
2. Import either BETHEL PDF supplied for the layout test.
3. Translate page 1 and at least one later page containing product images.
4. Verify that model, brand, quantity, and description translations remain in their original columns; no translation may cross an image or adjacent cell border.
5. Export the PDF and verify the same pages. Preview and export should retain the same text regions.
6. Record the page number and a screenshot for any remaining overflow, merged-cell error, or missing translation.

## Verification

`packages/layout-engine/src/reconstruct-page.test.ts` includes a six-cell vector table test that proves runs from three columns remain in separate cells. `packages/pdf-parser/src/parse-pdf.test.ts` protects text, image, and parser behavior.
