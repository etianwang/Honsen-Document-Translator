import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { addDocumentPdfPadding } from "./document-pdf-padding";

describe("addDocumentPdfPadding", () => {
  it("keeps the page size while wrapping its contents with a safe white edge", async () => {
    const source = await PDFDocument.create();
    source.addPage([200, 300]).drawRectangle({ x: 0, y: 0, width: 200, height: 300 });
    const padded = await PDFDocument.load(await addDocumentPdfPadding(await source.save()));
    expect(padded.getPageCount()).toBe(1);
    expect(padded.getPage(0).getSize()).toEqual({ width: 200, height: 300 });
  });
});
