import { describe, expect, it } from "vitest";
import { TauriDeepLTranslator } from "./tauri-deepl-translator";

describe("TauriDeepLTranslator", () => {
  it("keeps a long document within DeepL's 50-text request boundary", async () => {
    const calls: unknown[] = [];
    const translator = new TauriDeepLTranslator(undefined, async (_command, arguments_) => {
      calls.push(arguments_);
      const request = arguments_ as { request: { segments: string[] } };
      return { translations: request.request.segments.map((value) => `FR:${value}`) };
    });
    const segments = Array.from({ length: 51 }, (_, index) => ({ id: `s-${index}`, sourceText: `text-${index}`, targetLanguage: "FR", elementIds: [`s-${index}`] }));
    const result = await translator.translate({ segments });
    expect(calls).toHaveLength(2);
    expect((calls[0] as { request: { segments: string[] } }).request.segments).toHaveLength(50);
    expect(result.translations).toEqual(expect.arrayContaining([{ segmentId: "s-50", translatedText: "FR:text-50" }]));
  });

  it("stops before a new DeepL batch after cancellation", async () => {
    const controller = new AbortController(); let calls = 0;
    const translator = new TauriDeepLTranslator(undefined, async (_command, arguments_) => {
      calls += 1;
      if (calls === 1) controller.abort();
      const request = arguments_ as { request: { segments: string[] } };
      return { translations: request.request.segments };
    });
    const segments = Array.from({ length: 51 }, (_, index) => ({ id: `s-${index}`, sourceText: `text-${index}`, targetLanguage: "FR", elementIds: [`s-${index}`] }));
    await expect(translator.translate({ segments }, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(1);
  });

  it("uses the user-selected source language when document runs omit it", async () => {
    let request: { sourceLanguage?: string } | undefined;
    const translator = new TauriDeepLTranslator(undefined, async (_command, arguments_) => { request = (arguments_ as { request: { sourceLanguage?: string } }).request; return { translations: ["Bonjour"] }; }, "EN");
    await translator.translate({ segments: [{ id: "s", sourceText: "Hello", targetLanguage: "FR", elementIds: ["s"] }] });
    expect(request?.sourceLanguage).toBe("EN");
  });
});
