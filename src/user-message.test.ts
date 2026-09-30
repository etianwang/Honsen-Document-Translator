import { describe, expect, it } from "vitest";
import { diagnosticCode, userMessage } from "./user-message";

describe("userMessage", () => {
  it("converts backend codes to safe, actionable Chinese messages", () => {
    expect(userMessage(new Error("DEEPL_AUTH_FAILED: rejected"), "翻译失败。"))
      .toBe("DeepL API Key 无效，请检查后重试。");
    expect(userMessage(new Error("PDF_EXPORT_FAILED: C:\\secret\\source.pdf"), "导出失败。"))
      .toBe("PDF 导出失败，请重试；若仍失败请重新安装应用。");
    expect(userMessage(new Error("unexpected internal detail"), "导出失败。"))
      .toBe("导出失败。");
    expect(diagnosticCode(new Error("PDF_EXPORT_FAILED: C:\\secret\\source.pdf"))).toBe("PDF_EXPORT_FAILED");
    expect(diagnosticCode(new Error("unexpected internal detail"))).toBe("UNKNOWN_ERROR");
  });
});
