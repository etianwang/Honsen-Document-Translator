import type { DocumentModel, OcrProvider, RawDocument, RawPage } from "@pdf-translator/document-model";
import { reconstructDocument } from "@pdf-translator/layout-engine";
import { parsePdf } from "@pdf-translator/pdf-parser";

export type PageType = "text" | "scanned" | "hybrid";
export interface DocumentAnalysis { pageTypes: Array<{ pageNumber: number; type: PageType; confidence: number }>; }
export interface PipelineOptions { ocrProvider?: OcrProvider; ocrEnabled?: boolean; ocrLanguage?: string; signal?: AbortSignal; onProgress?: (stage: "analyzing" | "ocr" | "layout" | "completed", completed: number, total: number) => void; }
export interface ProcessingResult { analysis: DocumentAnalysis; document: DocumentModel; issues: import("@pdf-translator/document-model").DocumentIssue[]; }

export class DocumentPipeline {
  async analyze(input: Uint8Array, sourcePath: string, signal?: AbortSignal, onProgress?: (completed: number, total: number) => void): Promise<{ raw: RawDocument; analysis: DocumentAnalysis }> {
    throwIfAborted(signal); const raw = await parsePdf(input, sourcePath, onProgress); throwIfAborted(signal);
    return { raw, analysis: { pageTypes: raw.pages.map((page) => ({ pageNumber: page.number, ...classify(page.textItems.length, page.images?.length ?? 0) })) } };
  }
  async process(input: Uint8Array, sourcePath: string, options: PipelineOptions = {}): Promise<ProcessingResult> {
    options.onProgress?.("analyzing", 0, 0); const { raw, analysis } = await this.analyze(input, sourcePath, options.signal, (completed, total) => options.onProgress?.("analyzing", completed, total));
    if (options.ocrEnabled && options.ocrProvider) {
      const scanned = raw.pages.filter((page) => analysis.pageTypes.find((item) => item.pageNumber === page.number)?.type === "scanned");
      options.onProgress?.("ocr", 0, scanned.length);
      for (let index = 0; index < scanned.length; index += 1) {
        throwIfAborted(options.signal);
        await applyOcr(scanned[index], sourcePath, options.ocrProvider, options.ocrLanguage);
        options.onProgress?.("ocr", index + 1, scanned.length);
      }
    }
    options.onProgress?.("layout", 0, raw.pages.length); const document = { ...reconstructDocument(raw), issues: raw.issues ?? [] }; options.onProgress?.("layout", raw.pages.length, raw.pages.length);
    options.onProgress?.("completed", 1, 1); return { analysis, document, issues: raw.issues ?? [] };
  }
}

async function applyOcr(page: RawPage, sourcePath: string, provider: OcrProvider, language?: string): Promise<void> {
  const result = await provider.recognizePage({ pageNumber: page.number, imagePath: sourcePath, pageWidth: page.width, pageHeight: page.height, language });
  const direction = language === "AR" || language === "FA" || language === "ara" || language === "fas" ? "rtl" as const : undefined;
  page.textItems.push(...result.text.map((item, index) => ({ id: `page-${page.number}-ocr-${index}`, text: item.text, bbox: item.bbox, fontName: "OCR", fontSize: Math.max(item.bbox.height, 1), rotation: 0, direction })));
}

function classify(textItems: number, images: number): Omit<DocumentAnalysis["pageTypes"][number], "pageNumber"> { if (textItems === 0 && images > 0) return { type: "scanned", confidence: 0.8 }; if (textItems > 0 && images > 0) return { type: "hybrid", confidence: 0.7 }; return { type: "text", confidence: textItems > 0 ? 0.9 : 0.2 }; }
function throwIfAborted(signal?: AbortSignal): void { if (signal?.aborted) throw new DOMException("Processing cancelled", "AbortError"); }
