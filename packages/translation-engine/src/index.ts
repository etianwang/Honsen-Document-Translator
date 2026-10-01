import { mapTextLines, textLines, type BoundingBox, type DocumentModel, type TranslationOptions, type TranslationRequest, type TranslationResult, type Translator } from "@pdf-translator/document-model";

export class MockTranslator implements Translator {
  async translate(request: TranslationRequest): Promise<TranslationResult> {
    return { translations: request.segments.map((segment) => ({ segmentId: segment.id, translatedText: `[TRANSLATED] ${segment.sourceText}` })) };
  }
}

export async function translateDocument(model: DocumentModel, translator: Translator, targetLanguage: string, options?: TranslationOptions): Promise<DocumentModel> {
  throwIfAborted(options?.signal);
  const segments = translationUnits(model).map((unit) => ({ id: unit.id, sourceText: unit.text, targetLanguage, elementIds: unit.elementIds }));
  const result = await translator.translate({ segments }, options);
  throwIfAborted(options?.signal);
  const translations = new Map(result.translations.map((translation) => [translation.segmentId, translation.translatedText]));
  return mapTextLines(model, (line) => {
    const wholeLine = translations.get(line.id);
    return wholeLine === undefined
      ? { ...line, runs: line.runs.map((run) => ({ ...run, translatedText: translatedOrSource(translations.get(run.id), run.text) })) }
      : { ...line, runs: line.runs.map((run, index) => ({ ...run, translatedText: index === 0 ? translatedOrSource(wholeLine, sourceText(line)) : "" })) };
  });
}

function throwIfAborted(signal?: AbortSignal): void { if (signal?.aborted) throw new DOMException("Translation cancelled", "AbortError"); }
function translatedOrSource(translated: string | undefined, source: string): string { return translated?.trim() ? translated : source; }

function sourceText(line: ReturnType<typeof textLines>[number]): string {
  return line.runs.reduce((text, run, index, runs) => {
    const previous = runs[index - 1];
    const gap = previous ? run.bbox.x - previous.bbox.x - previous.bbox.width : 0;
    return text + (previous && gap > Math.max(previous.bbox.height, run.bbox.height) * 0.2 ? " " : "") + run.text;
  }, "");
}

function translationUnits(model: DocumentModel): Array<{ id: string; text: string; elementIds: string[] }> {
  return model.pages.flatMap((page) => {
    const images = page.blocks.filter((block) => block.type === "image").map((block) => block.bbox);
    return textLines({ ...model, pages: [page] }).flatMap((line) => (overlapsImage(line.bbox, images) || hasColumns(line))
      ? line.runs.map((run) => ({ id: run.id, text: run.text, elementIds: [run.id] }))
      : [{ id: line.id, text: sourceText(line), elementIds: line.runs.map((run) => run.id) }]).filter((unit) => !keepSource(unit.text));
  });
}

function keepSource(text: string): boolean {
  const value = text.trim();
  return /^[\d\s.,:/%+-]+$/.test(value) || /^[A-Z.]{1,4}$/.test(value);
}

function overlapsImage(box: BoundingBox, images: BoundingBox[]): boolean {
  return images.some((image) => box.x < image.x + image.width && box.x + box.width > image.x && box.y < image.y + image.height && box.y + box.height > image.y);
}

function hasColumns(line: ReturnType<typeof textLines>[number]): boolean {
  return line.runs.slice(1).some((run, index) => {
    const previous = line.runs[index];
    return run.bbox.x - previous.bbox.x - previous.bbox.width > Math.max(previous.bbox.height, run.bbox.height) * 1.5;
  });
}
