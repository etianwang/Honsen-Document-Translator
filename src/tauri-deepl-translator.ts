import { invoke } from "@tauri-apps/api/core";
import type { TranslationRequest, TranslationResult, Translator } from "@pdf-translator/document-model";

export type DeepLInvoker = (command: string, arguments_: Record<string, unknown>) => Promise<{ translations: string[] }>;

export class TauriDeepLTranslator implements Translator {
  constructor(private readonly apiKey?: string, private readonly invokeCommand: DeepLInvoker = (command, arguments_) => invoke<{ translations: string[] }>(command, arguments_)) {}

  async translate(request: TranslationRequest): Promise<TranslationResult> {
    const translations: TranslationResult["translations"] = [];
    for (let offset = 0; offset < request.segments.length; offset += 50) {
      const batch = request.segments.slice(offset, offset + 50);
      const result = await this.invokeCommand("translate_deepl", {
        request: { segments: batch.map((segment) => segment.sourceText), targetLanguage: batch[0].targetLanguage, sourceLanguage: batch[0].sourceLanguage, apiKey: this.apiKey }
      });
      if (result.translations.length !== batch.length) throw new Error("DEEPL_INVALID_RESPONSE: Translation count did not match input.");
      translations.push(...result.translations.map((translatedText, index) => ({ segmentId: batch[index].id, translatedText })));
    }
    return { translations };
  }
}
