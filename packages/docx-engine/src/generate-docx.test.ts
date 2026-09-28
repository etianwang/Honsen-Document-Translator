import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import type { DocumentModel } from "@pdf-translator/document-model";
import { generateDocx } from "./generate-docx";
import { validateDocx } from "./validate-docx";

describe("generateDocx", () => {
  it("writes an editable DOCX package from a text DIR", async () => {
    const model: DocumentModel = { version: 1, sourcePath: "fixture.pdf", sections: [], pages: [{ number: 1, width: 612, height: 792, rotation: 0, margins: { top: 72, right: 72, bottom: 72, left: 72 }, blocks: [{ id: "block", type: "text", bbox: { x: 72, y: 680, width: 100, height: 20 }, readingOrder: 0, paragraphs: [{ id: "paragraph", bbox: { x: 72, y: 680, width: 100, height: 20 }, alignment: "left", lines: [{ id: "line", bbox: { x: 72, y: 680, width: 100, height: 20 }, runs: [{ id: "run", bbox: { x: 72, y: 680, width: 100, height: 20 }, text: "Editable text", style: { fontSize: 12, bold: true } }] }] }] }] }] };
    const outputDirectory = join(process.cwd(), "output", "docx");
    await mkdir(outputDirectory, { recursive: true });
    const outputPath = join(outputDirectory, "01-simple-paragraph.docx");
    await generateDocx(model, outputPath);
    const bytes = await readFile(outputPath);
    expect(bytes.subarray(0, 2).toString()).toBe("PK");
    await expect(validateDocx(bytes)).resolves.toBeUndefined();
  });

  it("writes image blocks as DOCX images", async () => {
    const model: DocumentModel = { version: 1, sourcePath: "image.pdf", sections: [], pages: [{ number: 1, width: 612, height: 792, rotation: 0, margins: { top: 72, right: 72, bottom: 72, left: 72 }, blocks: [{ id: "image", type: "image", bbox: { x: 72, y: 550, width: 100, height: 100 }, source: "data:image/bmp;base64,Qk06AAAAAAAAADYAAAAoAAAAAQAAAAEAAAABABgAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAA/wAAAA==", mimeType: "image/bmp", readingOrder: 0 }] }] };
    const outputPath = join(process.cwd(), "output", "docx", "04-image.docx");
    await generateDocx(model, outputPath);
    const bytes = await readFile(outputPath);
    expect(bytes.subarray(0, 2).toString()).toBe("PK");
    await expect(validateDocx(bytes)).resolves.toBeUndefined();
  });

  it("uses page-relative coordinates for text and tables", async () => {
    const model: DocumentModel = { version: 1, sourcePath: "positioned.pdf", sections: [], pages: [{ number: 1, width: 612, height: 792, rotation: 0, margins: { top: 72, right: 72, bottom: 72, left: 72 }, blocks: [
      { id: "text", type: "text", bbox: { x: 72, y: 700, width: 100, height: 12 }, readingOrder: 0, paragraphs: [{ id: "paragraph", bbox: { x: 72, y: 700, width: 100, height: 12 }, alignment: "left", lines: [{ id: "line", bbox: { x: 72, y: 700, width: 100, height: 12 }, runs: [{ id: "run", bbox: { x: 72, y: 700, width: 100, height: 12 }, text: "Positioned", style: {} }] }] }] },
      { id: "table", type: "table", bbox: { x: 72, y: 600, width: 100, height: 20 }, readingOrder: 1, columnWidths: [100], style: {}, rows: [{ index: 0, height: 20, cells: [{ rowIndex: 0, columnIndex: 0, bbox: { x: 72, y: 600, width: 100, height: 20 }, content: [{ id: "cell-paragraph", bbox: { x: 72, y: 600, width: 100, height: 20 }, alignment: "left", lines: [{ id: "cell-line", bbox: { x: 72, y: 600, width: 100, height: 20 }, runs: [{ id: "cell-run", bbox: { x: 72, y: 600, width: 100, height: 20 }, text: "Cell", style: {} }] }] }], style: {} }] }] },
    ] }] };
    const outputPath = join(process.cwd(), "output", "docx", "positioned.docx");
    await generateDocx(model, outputPath);
    const archive = await JSZip.loadAsync(await readFile(outputPath));
    const xml = await archive.file("word/document.xml")?.async("string");
    expect(xml).toContain("w:framePr");
    expect(xml).toContain("w:tblpPr");
  });

  it("rejects data that is not an OOXML package", async () => {
    await expect(validateDocx(new TextEncoder().encode("not a docx"))).rejects.toThrow("DOCX_VALIDATION_FAILED");
  });
});
