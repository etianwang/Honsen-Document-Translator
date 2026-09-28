import { mapTextRuns, textRuns, type DocumentModel, type TranslationOptions, type TranslationRequest, type TranslationResult, type Translator } from "@pdf-translator/document-model";

export class MockTranslator implements Translator {
  async translate(request: TranslationRequest): Promise<TranslationResult> {
    return { translations: request.segments.map((segment) => ({ segmentId: segment.id, translatedText: `[TRANSLATED] ${segment.sourceText}` })) };
  }
}

export async function translateDocument(model: DocumentModel, translator: Translator, targetLanguage: string, options?: TranslationOptions): Promise<DocumentModel> {
  throwIfAborted(options?.signal);
  const segments = textRuns(model).map((run) => ({ id: run.id, sourceText: run.text, targetLanguage, elementIds: [run.id] }));
  const result = await translator.translate({ segments }, options);
  throwIfAborted(options?.signal);
  const translations = new Map(result.translations.map((translation) => [translation.segmentId, translation.translatedText]));
  return mapTextRuns(model, (run) => ({ ...run, translatedText: translations.get(run.id) }));
}

function throwIfAborted(signal?: AbortSignal): void { if (signal?.aborted) throw new DOMException("Translation cancelled", "AbortError"); }
