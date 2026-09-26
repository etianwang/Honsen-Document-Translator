import { describe, expect, it } from "vitest";
import { parseProject, serializeProject } from "./project-file";

const project = { version: 1 as const, name: "sample.pdf", document: { version: 1 as const, sourcePath: "C:/sample.pdf", pages: [], sections: [] }, settings: { sourceLanguage: "AUTO", targetLanguage: "ZH", ocrEnabled: true, glossaryEntries: [] } };

describe("project files", () => {
  it("round-trips a document without API credentials", () => expect(parseProject(serializeProject(project))).toEqual(project));
  it("rejects unsupported data", () => expect(() => parseProject(new TextEncoder().encode('{"version":2}'))).toThrow("项目文件无效"));
});
