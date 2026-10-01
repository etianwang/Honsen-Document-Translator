import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { cleanBackgroundOperationsFilter, extractTextColors, normalizePdfError, normalizePdfPageError, parsePdf } from "./parse-pdf";

describe("parsePdf", () => {
  it("extracts geometry, text, and source font metadata", async () => {
    const fixture = await readFile(new URL("../../../tests/fixtures/01-simple-paragraph.pdf", import.meta.url));
    const document = await parsePdf(new Uint8Array(fixture), "01-simple-paragraph.pdf");
    const page = document.pages[0];
    expect(page).toMatchObject({ number: 1, width: 612, height: 792, rotation: 0 });
    expect(page?.textItems.map((item) => item.text)).toContain("Fixture title");
    const title = page?.textItems.find((item) => item.text === "Fixture title");
    expect(title?.fontName).toBeTruthy();
    expect(title?.fontSize).toBeCloseTo(18, 0);
  });

  it("extracts simple embedded RGB images", async () => {
    const fixture = await readFile(new URL("../../../tests/fixtures/04-image.pdf", import.meta.url));
    const document = await parsePdf(new Uint8Array(fixture), "04-image.pdf");
    expect(document.pages[0]?.images?.[0]).toMatchObject({ mimeType: "image/bmp", bbox: { width: 100, height: 100 } });
  });

  it("rejects non-PDF input before passing it to the parser", async () => {
    await expect(parsePdf(new TextEncoder().encode("not a PDF"), "wrong.pdf")).rejects.toThrow("INVALID_PDF");
  });

  it("normalizes a malformed PDF after it passes the header check", async () => {
    const fixture = await readFile(new URL("../../../tests/fixtures/99-malformed.pdf", import.meta.url));
    await expect(parsePdf(new Uint8Array(fixture), "damaged.pdf")).rejects.toThrow("PDF_PARSE_FAILED");
  });

  it("normalizes encrypted document errors without exposing parser internals", () => {
    const error = new Error("No password given"); error.name = "PasswordException";
    expect(normalizePdfError(error).message).toBe("ENCRYPTED_PDF: This PDF is password protected.");
  });

  it("records a page-specific recovery issue without parser internals", () => {
    expect(normalizePdfPageError(new Error("internal details"), 3)).toEqual({ code: "PDF_PAGE_PARSE_FAILED", pageNumber: 3, message: "第 3 页无法完全解析，已跳过无法读取的内容。" });
  });

  it("skips ordinary glyph draws but preserves paths, images, state, and annotations", () => {
    const filter = cleanBackgroundOperationsFilter({ fnArray: [OPS.save, OPS.constructPath, OPS.fill, OPS.showText, OPS.paintImageXObject, OPS.beginAnnotation, OPS.showText, OPS.endAnnotation, OPS.restore] });
    expect([0, 1, 2, 4, 5, 6, 7, 8].every(filter)).toBe(true);
    expect(filter(3)).toBe(false);
  });

  it("keeps RGB and gray fill colors aligned with ordinary glyph draws", () => {
    const colors = extractTextColors({ fnArray: [OPS.setFillRGBColor, OPS.showText, OPS.setFillGray, OPS.showText, OPS.setFillColor, OPS.showText], argsArray: [["#E53935"], [], [0.5], [], [], []] });
    expect(colors).toEqual(["#e53935", "#808080", undefined]);
  });
});
