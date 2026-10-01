import { describe, expect, it, vi } from "vitest";
import type { DocumentModel } from "@pdf-translator/document-model";
import { paintTranslatedPlacement, translatedLineText, translatedLines, translatedPlacements } from "./pdf-overlay-export";

describe("translatedLines", () => {
  it("includes text and table-cell lines for coordinate-based PDF export", () => {
    const line = { id: "line", bbox: { x: 0, y: 0, width: 10, height: 10 }, runs: [{ id: "run", bbox: { x: 0, y: 0, width: 10, height: 10 }, text: "Text", translatedText: "译文", style: {} }] };
    const model: DocumentModel = { version: 1, sourcePath: "fixture.pdf", sections: [], pages: [{ number: 1, width: 10, height: 10, rotation: 0, margins: { top: 0, right: 0, bottom: 0, left: 0 }, blocks: [{ id: "text", type: "text", bbox: line.bbox, readingOrder: 0, paragraphs: [{ id: "paragraph", bbox: line.bbox, alignment: "left", lines: [line] }] }, { id: "table", type: "table", bbox: line.bbox, readingOrder: 1, columnWidths: [10], style: {}, rows: [{ index: 0, cells: [{ rowIndex: 0, columnIndex: 0, bbox: line.bbox, content: [{ id: "cell", bbox: line.bbox, alignment: "left", lines: [{ ...line, id: "cell-line" }] }], style: {} }] }] }] }] };
    expect(translatedLines(model.pages[0]).map((item) => item.id)).toEqual(["line", "cell-line"]);
  });

  it("combines a line translation and masks its entire source box before painting", () => {
    const fillRect = vi.fn(); const fillText = vi.fn();
    const context = { canvas: { width: 400, height: 400 }, font: "", fillStyle: "", textBaseline: "", direction: "ltr", textAlign: "left", measureText: () => ({ width: 20 }), fillRect, fillText } as unknown as CanvasRenderingContext2D;
    const line = { id: "line", bbox: { x: 10, y: 10, width: 30, height: 10 }, runs: [{ id: "first", bbox: { x: 10, y: 10, width: 10, height: 10 }, text: "Source", translatedText: "译文", style: { fontSize: 10 } }, { id: "second", bbox: { x: 20, y: 10, width: 20, height: 10 }, text: " text", translatedText: "", style: { fontSize: 10 } }] };
    expect(translatedLineText(line)).toBe("译文");
    paintTranslatedPlacement(context, { id: line.id, lineId: line.id, bbox: line.bbox, text: "译文", fontSize: 10, color: "#e53935", bold: true, italic: true }, 100);
    expect(fillRect).toHaveBeenCalledBefore(fillText);
    expect(context.fillStyle).toBe("#e53935");
    expect(context.font).toMatch(/^italic bold /);
    expect(fillText.mock.calls[0]?.[2]).toBeGreaterThan(320);
    expect(fillText.mock.calls[0]?.[2]).toBeLessThan(360);
  });

  it("does not paint a white source mask when using a clean background", () => {
    const fillRect = vi.fn(); const fillText = vi.fn();
    const context = { canvas: { width: 400, height: 400 }, font: "", fillStyle: "", textBaseline: "", direction: "ltr", textAlign: "left", measureText: () => ({ width: 20 }), fillRect, fillText } as unknown as CanvasRenderingContext2D;
    paintTranslatedPlacement(context, { id: "line", lineId: "line", bbox: { x: 10, y: 10, width: 30, height: 10 }, text: "译文", fontSize: 10 }, 100, false);
    expect(fillRect).not.toHaveBeenCalled();
    expect(fillText).toHaveBeenCalledOnce();
  });

  it("keeps an untranslated source line on the clean background", () => {
    const line = { id: "line", bbox: { x: 0, y: 0, width: 10, height: 10 }, runs: [{ id: "run", bbox: { x: 0, y: 0, width: 10, height: 10 }, text: "QTE", style: {} }] };
    const page = { number: 1, width: 10, height: 10, rotation: 0, margins: { top: 0, right: 0, bottom: 0, left: 0 }, blocks: [{ id: "text", type: "text" as const, bbox: line.bbox, readingOrder: 0, paragraphs: [{ id: "paragraph", bbox: line.bbox, alignment: "left" as const, lines: [line] }] }] };
    expect(translatedPlacements(page).map((placement) => placement.text)).toEqual(["QTE"]);
  });

  it("does not emit an empty placement that could cover source text", () => {
    const line = { id: "line", bbox: { x: 0, y: 0, width: 10, height: 10 }, runs: [{ id: "run", bbox: { x: 0, y: 0, width: 10, height: 10 }, text: "P.U", translatedText: "", style: {} }] };
    const page = { number: 1, width: 10, height: 10, rotation: 0, margins: { top: 0, right: 0, bottom: 0, left: 0 }, blocks: [{ id: "text", type: "text" as const, bbox: line.bbox, readingOrder: 0, paragraphs: [{ id: "paragraph", bbox: line.bbox, alignment: "left" as const, lines: [line] }] }] };
    expect(translatedPlacements(page)).toEqual([]);
  });
});
