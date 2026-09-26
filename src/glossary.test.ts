import { describe, expect, it } from "vitest";
import { applyGlossary, parseGlossaryYaml } from "./glossary";

describe("parseGlossaryYaml", () => {
  it("reads a simple YAML glossary while ignoring comments", () => {
    expect(parseGlossaryYaml("# terms\nAPI: 应用程序接口\nLLM: 大型语言模型")).toEqual([{ source: "API", target: "应用程序接口" }, { source: "LLM", target: "大型语言模型" }]);
  });

  it("rejects files without glossary entries", () => {
    expect(() => parseGlossaryYaml("# only a comment")).toThrow("没有可用条目");
  });

  it("overrides a complete translated term without changing other runs", () => {
    const model = { version: 1 as const, sourcePath: "fixture.pdf", sections: [], pages: [{ number: 1, width: 1, height: 1, rotation: 0, margins: { top: 0, right: 0, bottom: 0, left: 0 }, blocks: [{ id: "block", type: "text" as const, bbox: { x: 0, y: 0, width: 1, height: 1 }, readingOrder: 0, paragraphs: [{ id: "paragraph", bbox: { x: 0, y: 0, width: 1, height: 1 }, alignment: "left" as const, lines: [{ id: "line", bbox: { x: 0, y: 0, width: 1, height: 1 }, runs: [{ id: "api", bbox: { x: 0, y: 0, width: 1, height: 1 }, text: "API", translatedText: "interface", style: {} }, { id: "other", bbox: { x: 0, y: 0, width: 1, height: 1 }, text: "Other", translatedText: "other", style: {} }] }] }] }] }] };
    const result = applyGlossary(model, [{ source: "API", target: "应用程序接口" }]);
    const block = result.pages[0]?.blocks[0]; if (block?.type !== "text") throw new Error("expected text");
    expect(block.paragraphs[0]?.lines[0]?.runs.map((run) => run.translatedText)).toEqual(["应用程序接口", "other"]);
  });
});
