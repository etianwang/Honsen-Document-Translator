export interface BoundingBox { x: number; y: number; width: number; height: number; }
export interface DocumentIssue { code: string; message: string; pageNumber?: number; }
export type TextDirection = "ltr" | "rtl";
export interface RawTextItem { id: string; text: string; bbox: BoundingBox; fontName: string; fontSize: number; rotation: number; direction?: TextDirection; }
export interface RawPage { number: number; width: number; height: number; rotation: number; textItems: RawTextItem[]; images?: ImageBlock[]; vectorPaths?: BoundingBox[]; }
export interface RawDocument { sourcePath: string; pages: RawPage[]; issues?: DocumentIssue[]; }

export interface TextStyle { fontFamily?: string; originalFontName?: string; fontSize?: number; fontWeight?: number; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; color?: string; backgroundColor?: string; letterSpacing?: number; baselineShift?: number; rotation?: number; }
export interface TextRun { id: string; bbox: BoundingBox; text: string; translatedText?: string; style: TextStyle; }
export interface TextLine { id: string; bbox: BoundingBox; runs: TextRun[]; direction?: TextDirection; }
export type ParagraphAlignment = "left" | "center" | "right" | "justify";
export interface ParagraphModel { id: string; bbox: BoundingBox; alignment: ParagraphAlignment; lines: TextLine[]; direction?: TextDirection; spacingBefore?: number; spacingAfter?: number; lineSpacing?: number; }
export interface TextBlock { id: string; type: "text"; bbox: BoundingBox; paragraphs: ParagraphModel[]; readingOrder: number; }
export interface TableCellStyle { backgroundColor?: string; borderColor?: string; padding?: number; verticalAlignment?: "top" | "center" | "bottom"; }
export interface TableCellModel { rowIndex: number; columnIndex: number; rowSpan?: number; colSpan?: number; bbox: BoundingBox; content: ParagraphModel[]; style: TableCellStyle; }
export interface TableRowModel { index: number; height?: number; cells: TableCellModel[]; }
export interface TableStyle { borderColor?: string; borderWidth?: number; backgroundColor?: string; }
export interface TableBlock { id: string; type: "table"; bbox: BoundingBox; rows: TableRowModel[]; columnWidths: number[]; style: TableStyle; readingOrder: number; }
export interface ImageBlock { id: string; type: "image"; bbox: BoundingBox; source: string; mimeType: string; rotation?: number; zIndex?: number; readingOrder: number; }
export type DocumentBlock = TextBlock | TableBlock | ImageBlock;
export interface PageMargins { top: number; right: number; bottom: number; left: number; }
export interface DocumentPage { number: number; width: number; height: number; rotation: number; margins: PageMargins; blocks: DocumentBlock[]; }
export interface HeaderFooter { kind: "header" | "footer"; paragraphs: ParagraphModel[]; }
export interface DocumentSection { id: string; pageNumbers: number[]; pageSize: { width: number; height: number }; margins: PageMargins; headers: HeaderFooter[]; footers: HeaderFooter[]; }
export interface DocumentModel { version: 1; sourcePath: string; pages: DocumentPage[]; sections: DocumentSection[]; issues?: DocumentIssue[]; }
export interface ResolvedFont { originalName: string; normalizedName: string; family: string; available: boolean; fallback?: string; }
export interface PageAnalysis { pageNumber: number; type: "text" | "scanned" | "hybrid"; confidence: number; }
export interface OcrPageInput { pageNumber: number; imagePath: string; pageWidth?: number; pageHeight?: number; language?: string; }
export interface OcrTextResult { text: string; bbox: BoundingBox; confidence: number; styleHint?: Partial<TextStyle>; }
export interface OcrPageResult { pageNumber: number; text: OcrTextResult[]; }
export interface OcrProvider { recognizePage(input: OcrPageInput): Promise<OcrPageResult>; }
export interface TranslationSegment { id: string; sourceText: string; sourceLanguage?: string; targetLanguage: string; context?: string; elementIds: string[]; }
export interface TranslationRequest { segments: TranslationSegment[]; }
export interface TranslationResult { translations: Array<{ segmentId: string; translatedText: string }>; }
export interface TranslationOptions { signal?: AbortSignal; onProgress?: (completed: number, total: number) => void; }
export interface Translator { translate(request: TranslationRequest, options?: TranslationOptions): Promise<TranslationResult>; }
export interface LayoutFitOptions { minFontScale: number; maxExpansionRatio: number; allowLineReflow: boolean; }
export interface PdfExportResult { outputPath: string; }
export interface PdfExporter { exportDocx(docxPath: string, outputPath: string): Promise<PdfExportResult>; }
export type ProcessingStage = "idle" | "loading" | "analyzing" | "parsing" | "ocr" | "layout" | "translating" | "reconstructing" | "generating-docx" | "generating-pdf" | "completed" | "failed";
export type DocumentErrorCode = "INVALID_PDF" | "ENCRYPTED_PDF" | "PDF_PARSE_FAILED" | "OCR_FAILED" | "TRANSLATION_FAILED" | "DOCX_GENERATION_FAILED" | "LIBREOFFICE_NOT_FOUND" | "PDF_EXPORT_FAILED";
