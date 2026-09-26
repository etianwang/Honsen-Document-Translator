import type { DocumentModel, OcrProvider, RawDocument, RawPage, Translator } from "@pdf-translator/document-model";
import { reconstructDocument } from "@pdf-translator/layout-engine";
import { parsePdf } from "@pdf-translator/pdf-parser";
import { translateDocument } from "@pdf-translator/translation-engine";

export type PageType = "text" | "scanned" | "hybrid";
export interface DocumentAnalysis { pageTypes: Array<{ pageNumber: number; type: PageType; confidence: number }>; }
export interface PipelineOptions { targetLanguage?: string; translator?: Translator; ocrProvider?: OcrProvider; ocrEnabled?: boolean; ocrLanguage?: string; signal?: AbortSignal; onProgress?: (stage: "analyzing" | "ocr" | "layout" | "translating" | "completed", completed: number, total: number) => void; }
export interface ProcessingResult { analysis: DocumentAnalysis; document: DocumentModel; }

export class DocumentPipeline {
  async analyze(input: Uint8Array, sourcePath: string, signal?: AbortSignal): Promise<{ raw: RawDocument; analysis: DocumentAnalysis }> {
    throwIfAborted(signal); const raw = await parsePdf(input, sourcePath); throwIfAborted(signal);
    return { raw, analysis: { pageTypes: raw.pages.map((page) => ({ pageNumber: page.number, ...classify(page.textItems.length, page.images?.length ?? 0) })) } };
  }
  async process(input: Uint8Array, sourcePath: string, options: PipelineOptions = {}): Promise<ProcessingResult> {
    options.onProgress?.("analyzing", 0, 1); const { raw, analysis } = await this.analyze(input, sourcePath, options.signal);
    if (options.ocrEnabled && options.ocrProvider) {
      const scanned = raw.pages.filter((page) => analysis.pageTypes.find((item) => item.pageNumber === page.number)?.type === "scanned");
      options.onProgress?.("ocr", 0, scanned.length);
      for (let index = 0; index < scanned.length; index += 1) {
        throwIfAborted(options.signal);
        await applyOcr(scanned[index], sourcePath, options.ocrProvider, options.ocrLanguage);
        options.onProgress?.("ocr", index + 1, scanned.length);
      }
    }
    options.onProgress?.("layout", 0, raw.pages.length); let document = reconstructDocument(raw); options.onProgress?.("layout", raw.pages.length, raw.pages.length);
    if (options.translator && options.targetLanguage) { throwIfAborted(options.signal); options.onProgress?.("translating", 0, 1); document = await translateDocument(document, options.translator, options.targetLanguage); options.onProgress?.("translating", 1, 1); }
    options.onProgress?.("completed", 1, 1); return { analysis, document };
  }
}

async function applyOcr(page: RawPage, sourcePath: string, provider: OcrProvider, language?: string): Promise<void> {
  const result = await provider.recognizePage({ pageNumber: page.number, imagePath: sourcePath, pageWidth: page.width, pageHeight: page.height, language });
  const direction = language === "AR" || language === "FA" || language === "ara" || language === "fas" ? "rtl" as const : undefined;
  page.textItems.push(...result.text.map((item, index) => ({ id: `page-${page.number}-ocr-${index}`, text: item.text, bbox: item.bbox, fontName: "OCR", fontSize: Math.max(item.bbox.height, 1), rotation: 0, direction })));
}

function classify(textItems: number, images: number): Omit<DocumentAnalysis["pageTypes"][number], "pageNumber"> { if (textItems === 0 && images > 0) return { type: "scanned", confidence: 0.8 }; if (textItems > 0 && images > 0) return { type: "hybrid", confidence: 0.7 }; return { type: "text", confidence: textItems > 0 ? 0.9 : 0.2 }; }
function throwIfAborted(signal?: AbortSignal): void { if (signal?.aborted) throw new DOMException("Processing cancelled", "AbortError"); }
