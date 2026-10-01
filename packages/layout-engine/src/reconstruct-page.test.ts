import { describe, expect, it } from "vitest";
import type { RawPage } from "@pdf-translator/document-model";
import { reconstructPage } from "./reconstruct-page";

describe("reconstructPage", () => {
  it("groups adjacent lines into paragraphs while preserving reading order", () => {
    const page: RawPage = {
      number: 1, width: 612, height: 792, rotation: 0,
      textItems: [
        { id: "title", text: "Title", bbox: { x: 72, y: 720, width: 40, height: 18 }, fontName: "Helvetica-Bold", fontSize: 18, rotation: 0 },
        { id: "one", text: "First line", bbox: { x: 72, y: 680, width: 50, height: 12 }, fontName: "Helvetica", fontSize: 12, rotation: 0 },
        { id: "two", text: "Second line", bbox: { x: 72, y: 664, width: 60, height: 12 }, fontName: "Helvetica", fontSize: 12, rotation: 0 },
        { id: "three", text: "Second paragraph", bbox: { x: 72, y: 620, width: 90, height: 12 }, fontName: "Helvetica", fontSize: 12, rotation: 0 },
      ],
    };
    const result = reconstructPage(page);
    expect(result.blocks).toHaveLength(3);
    const firstParagraphBlock = result.blocks[1];
    expect(firstParagraphBlock?.type).toBe("text");
    if (firstParagraphBlock?.type === "text") expect(firstParagraphBlock.paragraphs[0]?.lines).toHaveLength(2);
    expect(result.blocks.map((block) => block.readingOrder)).toEqual([0, 1, 2]);
  });

  it("preserves right-to-left word order for OCR text", () => {
    const page: RawPage = { number: 1, width: 612, height: 792, rotation: 0, textItems: [
      { id: "left", text: "عالم", bbox: { x: 100, y: 680, width: 35, height: 12 }, fontName: "OCR", fontSize: 12, rotation: 0, direction: "rtl" },
      { id: "right", text: "مرحبا", bbox: { x: 200, y: 680, width: 45, height: 12 }, fontName: "OCR", fontSize: 12, rotation: 0, direction: "rtl" },
    ] };
    const block = reconstructPage(page).blocks[0];
    expect(block).toMatchObject({ type: "text" });
    if (block?.type === "text") {
      expect(block.paragraphs[0]?.direction).toBe("rtl");
      expect(block.paragraphs[0]?.lines[0]?.runs.map((run) => run.id)).toEqual(["right", "left"]);
    }
  });

  it("keeps extracted source color with the text run", () => {
    const page: RawPage = { number: 1, width: 100, height: 100, rotation: 0, textItems: [{ id: "title", text: "Title", bbox: { x: 10, y: 80, width: 30, height: 14 }, fontName: "Helvetica-Bold", fontSize: 14, rotation: 0, color: "#e53935" }] };
    const block = reconstructPage(page).blocks[0];
    if (block?.type !== "text") throw new Error("Expected text block");
    expect(block.paragraphs[0]?.lines[0]?.runs[0]?.style).toMatchObject({ color: "#e53935", bold: true, fontSize: 14 });
  });

  it("uses vector cell geometry to keep table columns as separate writable regions", () => {
    const page: RawPage = {
      number: 1, width: 200, height: 200, rotation: 0,
      vectorPaths: [
        { x: 10, y: 100, width: 50, height: 20 }, { x: 60, y: 100, width: 50, height: 20 }, { x: 110, y: 100, width: 50, height: 20 },
        { x: 10, y: 80, width: 50, height: 20 }, { x: 60, y: 80, width: 50, height: 20 }, { x: 110, y: 80, width: 50, height: 20 },
      ],
      textItems: [
        { id: "a", text: "A", bbox: { x: 20, y: 106, width: 8, height: 8 }, fontName: "Helvetica", fontSize: 8, rotation: 0 }, { id: "b", text: "B", bbox: { x: 70, y: 106, width: 8, height: 8 }, fontName: "Helvetica", fontSize: 8, rotation: 0 }, { id: "c", text: "C", bbox: { x: 120, y: 106, width: 8, height: 8 }, fontName: "Helvetica", fontSize: 8, rotation: 0 },
        { id: "d", text: "D", bbox: { x: 20, y: 86, width: 8, height: 8 }, fontName: "Helvetica", fontSize: 8, rotation: 0 }, { id: "e", text: "E", bbox: { x: 70, y: 86, width: 8, height: 8 }, fontName: "Helvetica", fontSize: 8, rotation: 0 }, { id: "f", text: "F", bbox: { x: 120, y: 86, width: 8, height: 8 }, fontName: "Helvetica", fontSize: 8, rotation: 0 },
      ],
    };
    const table = reconstructPage(page).blocks[0];
    if (table?.type !== "table") throw new Error("Expected a vector table");
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]?.cells.map((cell) => cell.content[0]?.lines[0]?.runs[0]?.text)).toEqual(["A", "B", "C"]);
    expect(table.rows[1]?.cells.map((cell) => cell.content[0]?.lines[0]?.runs[0]?.text)).toEqual(["D", "E", "F"]);
  });
});
