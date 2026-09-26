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
});
