import type { DocumentModel, TranslationOptions, TranslationRequest, TranslationResult, Translator } from "@pdf-translator/document-model";

export class MockTranslator implements Translator {
  async translate(request: TranslationRequest): Promise<TranslationResult> {
    return { translations: request.segments.map((segment) => ({ segmentId: segment.id, translatedText: `[TRANSLATED] ${segment.sourceText}` })) };
  }
}

export async function translateDocument(model: DocumentModel, translator: Translator, targetLanguage: string, options?: TranslationOptions): Promise<DocumentModel> {
  throwIfAborted(options?.signal);
  const segments = model.pages.flatMap((page) => page.blocks).filter((block) => block.type === "text").flatMap((block) => block.paragraphs).flatMap((paragraph) => paragraph.lines).flatMap((line) => line.runs).map((run) => ({ id: run.id, sourceText: run.text, targetLanguage, elementIds: [run.id] }));
  const result = await translator.translate({ segments }, options);
  throwIfAborted(options?.signal);
  const translations = new Map(result.translations.map((translation) => [translation.segmentId, translation.translatedText]));
  return { ...model, pages: model.pages.map((page) => ({ ...page, blocks: page.blocks.map((block) => block.type !== "text" ? block : ({ ...block, paragraphs: block.paragraphs.map((paragraph) => ({ ...paragraph, lines: paragraph.lines.map((line) => ({ ...line, runs: line.runs.map((run) => ({ ...run, translatedText: translations.get(run.id) })) })) })) })) })) };
}

function throwIfAborted(signal?: AbortSignal): void { if (signal?.aborted) throw new DOMException("Translation cancelled", "AbortError"); }
