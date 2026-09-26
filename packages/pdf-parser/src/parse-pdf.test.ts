import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { normalizePdfError, normalizePdfPageError, parsePdf } from "./parse-pdf";

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

  it("normalizes encrypted document errors without exposing parser internals", () => {
    const error = new Error("No password given"); error.name = "PasswordException";
    expect(normalizePdfError(error).message).toBe("ENCRYPTED_PDF: This PDF is password protected.");
  });

  it("records a page-specific recovery issue without parser internals", () => {
    expect(normalizePdfPageError(new Error("internal details"), 3)).toEqual({ code: "PDF_PAGE_PARSE_FAILED", pageNumber: 3, message: "第 3 页无法完全解析，已跳过无法读取的内容。" });
  });
});
