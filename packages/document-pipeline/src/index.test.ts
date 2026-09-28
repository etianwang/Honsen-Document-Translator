import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { OcrProvider } from "@pdf-translator/document-model";
import { classify, DocumentPipeline, groupOcrWords } from "./index";

describe("DocumentPipeline", () => {
  it("classifies and reconstructs a text PDF", async () => {
    const input = new Uint8Array(await readFile(new URL("../../../tests/fixtures/01-simple-paragraph.pdf", import.meta.url)));
    const result = await new DocumentPipeline().process(input, "fixture.pdf");
    expect(result.analysis.pageTypes).toEqual([{ pageNumber: 1, type: "text", confidence: 0.9 }]);
    expect(result.document.pages).toHaveLength(1);
    expect(result.document.pages[0].blocks.flatMap((block) => block.type === "text" ? block.paragraphs : []).flatMap((paragraph) => paragraph.lines).flatMap((line) => line.runs).every((run) => run.translatedText === undefined)).toBe(true);
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

  it("runs OCR for a page without a text layer even when image extraction misses it", () => {
    expect(classify(0, 0)).toEqual({ type: "scanned", confidence: 0.6 });
  });

  it("merges adjacent OCR words but preserves separate table columns", () => {
    expect(groupOcrWords([
      { text: "METRE", confidence: 94, bbox: { x: 10, y: 20, width: 24, height: 8 } },
      { text: "DE", confidence: 93, bbox: { x: 37, y: 20, width: 10, height: 8 } },
      { text: "CABLE", confidence: 92, bbox: { x: 50, y: 20, width: 24, height: 8 } },
      { text: "2000", confidence: 98, bbox: { x: 150, y: 20, width: 18, height: 8 } },
      { text: ".", confidence: 12, bbox: { x: 90, y: 20, width: 1, height: 1 } },
    ])).toEqual([
      { text: "METRE DE CABLE", bbox: { x: 10, y: 20, width: 64, height: 8 } },
      { text: "2000", bbox: { x: 150, y: 20, width: 18, height: 8 } },
    ]);
  });
});
