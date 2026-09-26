import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateDocx } from "../packages/docx-engine/src/generate-docx";
import { reconstructPage } from "../packages/layout-engine/src/reconstruct-page";
import { parsePdf } from "../packages/pdf-parser/src/parse-pdf";

describe("PDF to DOCX round trip", () => {
  it("preserves fixture text through parsing and reconstruction", async () => {
    const fixture = await readFile(new URL("./fixtures/01-simple-paragraph.pdf", import.meta.url));
    const raw = await parsePdf(new Uint8Array(fixture), "01-simple-paragraph.pdf");
    const model = { version: 1 as const, sourcePath: raw.sourcePath, pages: raw.pages.map(reconstructPage), sections: [] };
    const outputDirectory = join(process.cwd(), "output", "docx");
    await mkdir(outputDirectory, { recursive: true });
    await generateDocx(model, join(outputDirectory, "01-simple-paragraph-roundtrip.docx"));
    const text = model.pages.flatMap((page) => page.blocks).filter((block) => block.type === "text").flatMap((block) => block.paragraphs).flatMap((paragraph) => paragraph.lines).flatMap((line) => line.runs).map((run) => run.text).join(" ");
    expect(text).toContain("Fixture title");
    expect(text).toContain("Second paragraph.");
  });
});
