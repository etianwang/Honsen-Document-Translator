import { describe, expect, it } from "vitest";
import type { DocumentModel } from "@pdf-translator/document-model";
import { MockTranslator, translateDocument } from "./index";

describe("MockTranslator", () => {
  it("maps translated text back to the corresponding run", async () => {
    const model: DocumentModel = { version: 1, sourcePath: "fixture.pdf", sections: [], pages: [{ number: 1, width: 1, height: 1, rotation: 0, margins: { top: 0, right: 0, bottom: 0, left: 0 }, blocks: [{ id: "block", type: "text", bbox: { x: 0, y: 0, width: 1, height: 1 }, readingOrder: 0, paragraphs: [{ id: "paragraph", bbox: { x: 0, y: 0, width: 1, height: 1 }, alignment: "left", lines: [{ id: "line", bbox: { x: 0, y: 0, width: 1, height: 1 }, runs: [{ id: "run", bbox: { x: 0, y: 0, width: 1, height: 1 }, text: "Bonjour", style: {} }] }] }] }] }] };
    const translated = await translateDocument(model, new MockTranslator(), "French");
    const block = translated.pages[0]?.blocks[0];
    if (block?.type !== "text") throw new Error("Expected a text block");
    expect(block.paragraphs[0]?.lines[0]?.runs[0]?.translatedText).toBe("[TRANSLATED] Bonjour");
  });

  it("does not start a translation after cancellation", async () => {
    const model: DocumentModel = { version: 1, sourcePath: "fixture.pdf", sections: [], pages: [] };
    const controller = new AbortController(); controller.abort();
    await expect(translateDocument(model, new MockTranslator(), "French", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("translates text inside table cells", async () => {
    const model: DocumentModel = { version: 1, sourcePath: "table.pdf", sections: [], pages: [{ number: 1, width: 1, height: 1, rotation: 0, margins: { top: 0, right: 0, bottom: 0, left: 0 }, blocks: [{ id: "table", type: "table", bbox: { x: 0, y: 0, width: 1, height: 1 }, readingOrder: 0, columnWidths: [1], style: {}, rows: [{ index: 0, cells: [{ rowIndex: 0, columnIndex: 0, bbox: { x: 0, y: 0, width: 1, height: 1 }, content: [{ id: "paragraph", bbox: { x: 0, y: 0, width: 1, height: 1 }, alignment: "left", lines: [{ id: "line", bbox: { x: 0, y: 0, width: 1, height: 1 }, runs: [{ id: "cell", bbox: { x: 0, y: 0, width: 1, height: 1 }, text: "Name", style: {} }] }] }], style: {} }] }] }] }] };
    const translated = await translateDocument(model, new MockTranslator(), "Chinese");
    const block = translated.pages[0]?.blocks[0];
    if (block?.type !== "table") throw new Error("Expected a table block");
    expect(block.rows[0]?.cells[0]?.content[0]?.lines[0]?.runs[0]?.translatedText).toBe("[TRANSLATED] Name");
  });
});
