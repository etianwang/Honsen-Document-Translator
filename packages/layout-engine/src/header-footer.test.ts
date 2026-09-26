import { describe, expect, it } from "vitest";
import type { RawDocument } from "@pdf-translator/document-model";
import { reconstructDocument } from "./reconstruct-page";

describe("header and footer reconstruction", () => {
  it("moves repeated edge text into semantic headers and footers", () => {
    const pages = [1, 2].map((number) => ({ number, width: 612, height: 792, rotation: 0, textItems: [
      { id: `header-${number}`, text: "Company name", bbox: { x: 72, y: 760, width: 80, height: 12 }, fontName: "Arial", fontSize: 12, rotation: 0 },
      { id: `body-${number}`, text: `Body ${number}`, bbox: { x: 72, y: 650, width: 50, height: 12 }, fontName: "Arial", fontSize: 12, rotation: 0 },
      { id: `body-next-${number}`, text: "continued", bbox: { x: 72, y: 634, width: 50, height: 12 }, fontName: "Arial", fontSize: 12, rotation: 0 },
      { id: `footer-${number}`, text: "Confidential", bbox: { x: 72, y: 30, width: 70, height: 12 }, fontName: "Arial", fontSize: 12, rotation: 0 },
    ] }));
    const result = reconstructDocument({ sourcePath: "fixture.pdf", pages } satisfies RawDocument);
    expect(result.sections[0]?.headers).toHaveLength(1);
    expect(result.sections[0]?.footers).toHaveLength(1);
    expect(result.pages[0]?.blocks).toHaveLength(1);
  });
});
