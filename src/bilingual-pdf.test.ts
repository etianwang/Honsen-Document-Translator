import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { combineBilingualPdf } from "./pdf-overlay-export";

describe("bilingual PDF export", () => {
  it("places each original page on the left and its translation on the right", async () => {
    const source = await PDFDocument.create();
    source.addPage([200, 300]);
    source.addPage([300, 200]);
    const translation = await PDFDocument.create();
    translation.addPage([200, 300]);
    translation.addPage([300, 200]);
    const result = await PDFDocument.load(await combineBilingualPdf(await source.save(), await translation.save()));
    expect(result.getPageCount()).toBe(2);
    expect(result.getPage(0).getSize()).toEqual({ width: 400, height: 300 });
    expect(result.getPage(1).getSize()).toEqual({ width: 600, height: 200 });
  });

  it("rejects documents with mismatched page counts", async () => {
    const source = await PDFDocument.create(); source.addPage();
    const translation = await PDFDocument.create(); translation.addPage(); translation.addPage();
    await expect(combineBilingualPdf(await source.save(), await translation.save())).rejects.toThrow();
  });
});
