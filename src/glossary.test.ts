import { describe, expect, it } from "vitest";
import { parseGlossaryYaml } from "./glossary";

describe("parseGlossaryYaml", () => {
  it("reads a simple YAML glossary while ignoring comments", () => {
    expect(parseGlossaryYaml("# terms\nAPI: 应用程序接口\nLLM: 大型语言模型")).toEqual([{ source: "API", target: "应用程序接口" }, { source: "LLM", target: "大型语言模型" }]);
  });

  it("rejects files without glossary entries", () => {
    expect(() => parseGlossaryYaml("# only a comment")).toThrow("没有可用条目");
  });
});
