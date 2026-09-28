import type { DocumentModel, OcrProvider, OcrTextResult, RawDocument, RawPage } from "@pdf-translator/document-model";
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
  page.textItems.push(...groupOcrWords(result.text).map((item, index) => ({ id: `page-${page.number}-ocr-${index}`, text: item.text, bbox: item.bbox, fontName: "OCR", fontSize: Math.max(item.bbox.height, 1), rotation: 0, direction })));
}

/** Merges words within a visual text fragment but never across a table-like column gap. */
export function groupOcrWords(words: OcrTextResult[]): Array<Pick<RawPage["textItems"][number], "text" | "bbox">> {
  const usable = words.filter((word) => word.text.trim() && word.confidence >= 45);
  const sorted = [...(usable.length ? usable : words.filter((word) => word.text.trim()))].sort((left, right) => right.bbox.y - left.bbox.y || left.bbox.x - right.bbox.x);
  const rows: OcrTextResult[][] = [];
  for (const word of sorted) {
    const row = rows[rows.length - 1]; const tolerance = Math.max(2, word.bbox.height * 0.55, row?.[0]?.bbox.height ? row[0].bbox.height * 0.55 : 0);
    if (row && Math.abs(row[0].bbox.y - word.bbox.y) <= tolerance) row.push(word); else rows.push([word]);
  }
  return rows.flatMap((row) => {
    const fragments: OcrTextResult[][] = [];
    for (const word of [...row].sort((left, right) => left.bbox.x - right.bbox.x)) {
      const fragment = fragments[fragments.length - 1]; const previous = fragment?.[fragment.length - 1];
      if (previous && word.bbox.x - previous.bbox.x - previous.bbox.width <= Math.max(previous.bbox.height, word.bbox.height) * 1.5) fragment.push(word); else fragments.push([word]);
    }
    return fragments.map((fragment) => ({ text: fragment.map((word) => word.text.trim()).join(" "), bbox: bounds(fragment.map((word) => word.bbox)) }));
  });
}

function bounds(boxes: OcrTextResult["bbox"][]): OcrTextResult["bbox"] { const x = Math.min(...boxes.map((box) => box.x)); const y = Math.min(...boxes.map((box) => box.y)); const right = Math.max(...boxes.map((box) => box.x + box.width)); const top = Math.max(...boxes.map((box) => box.y + box.height)); return { x, y, width: right - x, height: top - y }; }

/** A missing text layer is sufficient evidence for OCR; image extraction is best-effort. */
export function classify(textItems: number, images: number): Omit<DocumentAnalysis["pageTypes"][number], "pageNumber"> { if (textItems === 0) return { type: "scanned", confidence: images > 0 ? 0.8 : 0.6 }; if (images > 0) return { type: "hybrid", confidence: 0.7 }; return { type: "text", confidence: 0.9 }; }
function throwIfAborted(signal?: AbortSignal): void { if (signal?.aborted) throw new DOMException("Processing cancelled", "AbortError"); }
