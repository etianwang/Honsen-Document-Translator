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

  it("keeps a source abbreviation when the provider returns an empty translation", async () => {
    const model: DocumentModel = { version: 1, sourcePath: "fixture.pdf", sections: [], pages: [{ number: 1, width: 1, height: 1, rotation: 0, margins: { top: 0, right: 0, bottom: 0, left: 0 }, blocks: [{ id: "block", type: "text", bbox: { x: 0, y: 0, width: 1, height: 1 }, readingOrder: 0, paragraphs: [{ id: "paragraph", bbox: { x: 0, y: 0, width: 1, height: 1 }, alignment: "left", lines: [{ id: "line", bbox: { x: 0, y: 0, width: 1, height: 1 }, runs: [{ id: "run", bbox: { x: 0, y: 0, width: 1, height: 1 }, text: "QTE", style: {} }] }] }] }] }] };
    const translated = await translateDocument(model, { translate: async () => ({ translations: [{ segmentId: "line", translatedText: "" }] }) }, "Chinese");
    const block = translated.pages[0]?.blocks[0];
    if (block?.type !== "text") throw new Error("Expected a text block");
    expect(block.paragraphs[0]?.lines[0]?.runs[0]?.translatedText).toBe("QTE");
  });

  it("translates widely separated table columns as independent positioned runs", async () => {
    const model: DocumentModel = { version: 1, sourcePath: "fixture.pdf", sections: [], pages: [{ number: 1, width: 20, height: 1, rotation: 0, margins: { top: 0, right: 0, bottom: 0, left: 0 }, blocks: [{ id: "block", type: "text", bbox: { x: 0, y: 0, width: 20, height: 1 }, readingOrder: 0, paragraphs: [{ id: "paragraph", bbox: { x: 0, y: 0, width: 20, height: 1 }, alignment: "left", lines: [{ id: "page-1-line-0", bbox: { x: 0, y: 0, width: 20, height: 1 }, runs: [{ id: "first", bbox: { x: 0, y: 0, width: 1, height: 1 }, text: "Bon", style: {} }, { id: "second", bbox: { x: 10, y: 0, width: 1, height: 1 }, text: "jour", style: {} }] }] }] }] }] };
    const translated = await translateDocument(model, new MockTranslator(), "Chinese");
    const block = translated.pages[0]?.blocks[0];
    if (block?.type !== "text") throw new Error("Expected a text block");
    expect(block.paragraphs[0]?.lines[0]?.runs.map((run) => run.translatedText)).toEqual(["[TRANSLATED] Bon", "[TRANSLATED] jour"]);
  });

  it("keeps narrow accounting abbreviations and numeric values out of translation", async () => {
    const line = { id: "line", bbox: { x: 0, y: 0, width: 100, height: 10 }, runs: [{ id: "designation", bbox: { x: 0, y: 0, width: 10, height: 10 }, text: "Designation", style: {} }, { id: "qte", bbox: { x: 30, y: 0, width: 5, height: 10 }, text: "QTE", style: {} }, { id: "price", bbox: { x: 60, y: 0, width: 5, height: 10 }, text: "P.U", style: {} }, { id: "amount", bbox: { x: 90, y: 0, width: 10, height: 10 }, text: "1 200 000", style: {} }] };
    const model: DocumentModel = { version: 1, sourcePath: "quote.pdf", sections: [], pages: [{ number: 1, width: 100, height: 10, rotation: 0, margins: { top: 0, right: 0, bottom: 0, left: 0 }, blocks: [{ id: "block", type: "text", bbox: line.bbox, readingOrder: 0, paragraphs: [{ id: "paragraph", bbox: line.bbox, alignment: "left", lines: [line] }] }] }] };
    let requested: string[] = [];
    const translated = await translateDocument(model, { translate: async (request) => { requested = request.segments.map((segment) => segment.sourceText); return { translations: request.segments.map((segment) => ({ segmentId: segment.id, translatedText: "名称" })) }; } }, "ZH");
    const block = translated.pages[0]?.blocks[0]; if (block?.type !== "text") throw new Error("Expected text block");
    expect(requested).toEqual(["Designation"]);
    expect(block.paragraphs[0]?.lines[0]?.runs.map((run) => run.translatedText)).toEqual(["名称", "QTE", "P.U", "1 200 000"]);
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
