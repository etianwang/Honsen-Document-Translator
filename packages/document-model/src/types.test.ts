import { describe, expect, it } from "vitest";
import type { DocumentModel, TextBlock } from "./types";

describe("document model", () => {
  it("represents a styled text block inside a page", () => {
    const block: TextBlock = { id: "block-1", type: "text", bbox: { x: 0, y: 0, width: 100, height: 20 }, readingOrder: 0, paragraphs: [{ id: "p-1", bbox: { x: 0, y: 0, width: 100, height: 20 }, alignment: "left", lines: [{ id: "line-1", bbox: { x: 0, y: 0, width: 100, height: 20 }, runs: [{ id: "run-1", bbox: { x: 0, y: 0, width: 100, height: 20 }, text: "Hello", style: { fontSize: 12, bold: true } }] }] }] };
    const document: DocumentModel = { version: 1, sourcePath: "example.pdf", sections: [], pages: [{ number: 1, width: 612, height: 792, rotation: 0, margins: { top: 36, right: 36, bottom: 36, left: 36 }, blocks: [block] }] };
    expect(document.pages[0]?.blocks[0]).toEqual(block);
  });
});
