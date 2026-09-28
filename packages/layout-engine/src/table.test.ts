import { describe, expect, it } from "vitest";
import type { RawPage } from "@pdf-translator/document-model";
import { reconstructPage } from "./reconstruct-page";

describe("simple table reconstruction", () => {
  it("converts aligned cells into a table block", () => {
    const page: RawPage = { number: 1, width: 612, height: 792, rotation: 0, textItems: [
      { id: "a", text: "Name", bbox: { x: 72, y: 700, width: 30, height: 12 }, fontName: "Arial", fontSize: 12, rotation: 0 }, { id: "b", text: "Value", bbox: { x: 200, y: 700, width: 30, height: 12 }, fontName: "Arial", fontSize: 12, rotation: 0 },
      { id: "c", text: "A", bbox: { x: 72, y: 680, width: 10, height: 12 }, fontName: "Arial", fontSize: 12, rotation: 0 }, { id: "d", text: "1", bbox: { x: 200, y: 680, width: 10, height: 12 }, fontName: "Arial", fontSize: 12, rotation: 0 },
    ] };
    const block = reconstructPage(page).blocks[0];
    expect(block?.type).toBe("table");
    if (block?.type === "table") expect(block.rows).toHaveLength(2);
  });

  it("keeps tables embedded between ordinary page text", () => {
    const page: RawPage = { number: 1, width: 612, height: 792, rotation: 0, textItems: [
      { id: "title", text: "Travel booking", bbox: { x: 72, y: 740, width: 80, height: 12 }, fontName: "Arial", fontSize: 12, rotation: 0 },
      { id: "a", text: "Name", bbox: { x: 72, y: 700, width: 30, height: 12 }, fontName: "Arial", fontSize: 12, rotation: 0 }, { id: "b", text: "Value", bbox: { x: 200, y: 700, width: 30, height: 12 }, fontName: "Arial", fontSize: 12, rotation: 0 },
      { id: "c", text: "A", bbox: { x: 72, y: 680, width: 10, height: 12 }, fontName: "Arial", fontSize: 12, rotation: 0 }, { id: "d", text: "1", bbox: { x: 200, y: 680, width: 10, height: 12 }, fontName: "Arial", fontSize: 12, rotation: 0 },
      { id: "note", text: "Please arrive early", bbox: { x: 72, y: 640, width: 90, height: 12 }, fontName: "Arial", fontSize: 12, rotation: 0 },
    ] };
    const blocks = reconstructPage(page).blocks;
    expect(blocks.map((block) => block.type)).toEqual(["text", "table", "text"]);
    const table = blocks[1];
    if (table?.type === "table") expect(table.rows[1]?.cells[1]?.content[0]?.lines[0]?.runs[0]?.text).toBe("1");
  });
});
