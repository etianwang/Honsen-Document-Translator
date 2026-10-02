import { describe, expect, it } from "vitest";
import { acceptsSourceFile, exportFileName, sourceTypeForFile } from "./source-types";

describe("source type registry", () => {
  it("recognizes supported formats and preserves Markdown output", () => {
    expect(sourceTypeForFile("offer.XLSX")?.id).toBe("spreadsheet");
    expect(sourceTypeForFile("slides.ppt")?.id).toBe("presentation");
    expect(exportFileName("C:\\docs\\guide.md", "FR", sourceTypeForFile("guide.md")!)).toBe("fr_guide.md");
    expect(acceptsSourceFile("offer.xlsx", "spreadsheet")).toBe(true);
    expect(acceptsSourceFile("offer.pdf", "spreadsheet")).toBe(false);
  });
});
