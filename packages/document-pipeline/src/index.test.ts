import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { OcrProvider } from "@pdf-translator/document-model";
import { DocumentPipeline } from "./index";

describe("DocumentPipeline", () => {
  it("classifies and reconstructs a text PDF", async () => {
    const input = new Uint8Array(await readFile(new URL("../../../tests/fixtures/01-simple-paragraph.pdf", import.meta.url)));
    const result = await new DocumentPipeline().process(input, "fixture.pdf");
    expect(result.analysis.pageTypes).toEqual([{ pageNumber: 1, type: "text", confidence: 0.9 }]);
    expect(result.document.pages).toHaveLength(1);
  });

  it("reports per-page analysis progress", async () => {
    const input = new Uint8Array(await readFile(new URL("../../../tests/fixtures/01-simple-paragraph.pdf", import.meta.url)));
    const progress: Array<[number, number]> = [];
    await new DocumentPipeline().process(input, "fixture.pdf", { onProgress: (stage, completed, total) => { if (stage === "analyzing") progress.push([completed, total]); } });
    expect(progress).toContainEqual([0, 1]);
    expect(progress).toContainEqual([1, 1]);
  });

  it("uses the OCR provider for a scanned image page", async () => {
    const input = new Uint8Array(await readFile(new URL("../../../tests/fixtures/04-image.pdf", import.meta.url)));
    const ocr: OcrProvider = { recognizePage: async (page) => ({ pageNumber: page.pageNumber, text: [{ text: "Recognized", bbox: { x: 10, y: 10, width: 60, height: 12 }, confidence: 98 }] }) };
    const result = await new DocumentPipeline().process(input, "image.pdf", { ocrEnabled: true, ocrProvider: ocr });
    expect(result.document.pages[0].blocks.some((block) => block.type === "text")).toBe(true);
  });
});
