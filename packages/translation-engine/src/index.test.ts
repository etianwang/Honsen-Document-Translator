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
});
