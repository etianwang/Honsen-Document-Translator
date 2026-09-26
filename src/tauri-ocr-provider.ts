import { invoke } from "@tauri-apps/api/core";
import type { OcrPageInput, OcrPageResult, OcrProvider } from "@pdf-translator/document-model";

export class TauriOcrProvider implements OcrProvider {
  async recognizePage(input: OcrPageInput): Promise<OcrPageResult> {
    return invoke<OcrPageResult>("ocr_pdf_page", { request: { sourcePath: input.imagePath, pageNumber: input.pageNumber, pageWidth: input.pageWidth, pageHeight: input.pageHeight, language: input.language } });
  }
}
