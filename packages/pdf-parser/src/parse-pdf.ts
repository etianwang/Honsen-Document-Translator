import { getDocument, GlobalWorkerOptions, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy, TextItem } from "pdfjs-dist/types/src/display/api";
import type { BoundingBox, DocumentIssue, ImageBlock, RawDocument, RawPage, RawTextItem } from "@pdf-translator/document-model";

export function configurePdfWorker(workerSrc: string): void { GlobalWorkerOptions.workerSrc = workerSrc; }

export async function renderPdfPage(data: Uint8Array, pageNumber: number, canvas: HTMLCanvasElement, isCancelled?: () => boolean, scale = 2): Promise<void> {
  await renderPdfPages(data, [{ pageNumber, canvas }], isCancelled, scale);
}

export async function renderPdfPages(data: Uint8Array, targets: Array<{ pageNumber: number; canvas: HTMLCanvasElement }>, isCancelled?: () => boolean, scale = 2): Promise<void> {
  const pdf = await getDocument({ data }).promise;
  for (const target of targets) {
    if (isCancelled?.()) return;
    const page = await pdf.getPage(target.pageNumber);
    if (isCancelled?.()) return;
    const viewport = page.getViewport({ scale });
    const context = target.canvas.getContext("2d");
    if (!context) throw new Error("PDF_PREVIEW_CONTEXT_FAILED");
    target.canvas.width = viewport.width; target.canvas.height = viewport.height;
    await page.render({ canvas: target.canvas, canvasContext: context, viewport }).promise;
  }
}

/** Renders the page without ordinary page-content glyphs. Returns pages that used the normal-render fallback. */
export async function renderCleanBackgroundPages(data: Uint8Array, targets: Array<{ pageNumber: number; canvas: HTMLCanvasElement }>, isCancelled?: () => boolean, scale = 2): Promise<number[]> {
  const pdf = await getDocument({ data }).promise;
  const fallbackPages: number[] = [];
  for (const target of targets) {
    if (isCancelled?.()) return fallbackPages;
    const page = await pdf.getPage(target.pageNumber);
    if (isCancelled?.()) return fallbackPages;
    const viewport = page.getViewport({ scale });
    const context = target.canvas.getContext("2d");
    if (!context) throw new Error("PDF_PREVIEW_CONTEXT_FAILED");
    target.canvas.width = viewport.width; target.canvas.height = viewport.height;
    try {
      const operators = await page.getOperatorList();
      await page.render({ canvas: target.canvas, canvasContext: context, viewport, operationsFilter: cleanBackgroundOperationsFilter(operators) }).promise;
    } catch {
      target.canvas.width = viewport.width; target.canvas.height = viewport.height;
      await page.render({ canvas: target.canvas, canvasContext: context, viewport }).promise;
      fallbackPages.push(target.pageNumber);
    }
  }
  return fallbackPages;
}

export async function renderCleanBackgroundPage(data: Uint8Array, pageNumber: number, canvas: HTMLCanvasElement, isCancelled?: () => boolean, scale = 2): Promise<boolean> {
  return (await renderCleanBackgroundPages(data, [{ pageNumber, canvas }], isCancelled, scale)).includes(pageNumber);
}

export async function parsePdf(data: Uint8Array, sourcePath: string, onProgress?: (completed: number, total: number) => void): Promise<RawDocument> {
  if (!containsPdfHeader(data)) throw new Error("INVALID_PDF: The selected file does not contain a PDF header.");
  let pdf: PDFDocumentProxy;
  try {
    pdf = await getDocument({ data }).promise;
  } catch (error: unknown) {
    throw normalizePdfError(error);
  }
  onProgress?.(0, pdf.numPages);
  const pages: RawPage[] = []; const issues: DocumentIssue[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    let page;
    try { page = await pdf.getPage(pageNumber); }
    catch (error: unknown) { issues.push(normalizePdfPageError(error, pageNumber)); onProgress?.(pageNumber, pdf.numPages); continue; }
    const viewport = page.getViewport({ scale: 1 });
    let content;
    try { content = await page.getTextContent(); }
    catch (error: unknown) { issues.push(normalizePdfPageError(error, pageNumber)); content = { items: [] }; }
    const sourceItems: TextItem[] = [];
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      sourceItems.push(item);
    }
    let textItems = sourceItems.map((item, index) => toRawTextItem(item, index, pageNumber));
    let images: ImageBlock[] = []; let vectorPaths: BoundingBox[] = [];
    try {
      const operators = await page.getOperatorList();
      const colors = extractTextColors(operators);
      // PDF.js may split/merge text items differently from glyph operators. Only use colors
      // when the sequence is exact; a wrong color is worse than the safe black fallback.
      if (colors.length === sourceItems.length) textItems = sourceItems.map((item, index) => toRawTextItem(item, index, pageNumber, colors[index]));
      images = extractImages(operators, page.objs, pageNumber);
      vectorPaths = extractVectorPaths(operators);
    } catch (error: unknown) { issues.push(normalizePdfPageError(error, pageNumber, "PDF_GEOMETRY_EXTRACTION_FAILED")); }
    pages.push({ number: pageNumber, width: viewport.width, height: viewport.height, rotation: page.rotate, textItems, images, vectorPaths }); onProgress?.(pageNumber, pdf.numPages);
  }
  return { sourcePath, pages, issues };
}

function containsPdfHeader(data: Uint8Array): boolean {
  const searchLength = Math.min(data.length - 4, 1024);
  for (let index = 0; index <= searchLength; index += 1) {
    if (data[index] === 0x25 && data[index + 1] === 0x50 && data[index + 2] === 0x44 && data[index + 3] === 0x46 && data[index + 4] === 0x2d) return true;
  }
  return false;
}

export function normalizePdfError(error: unknown): Error {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  if (name === "PasswordException" || /password/i.test(message)) return new Error("ENCRYPTED_PDF: This PDF is password protected.");
  return new Error("PDF_PARSE_FAILED: The PDF could not be parsed.");
}

export function normalizePdfPageError(_error: unknown, pageNumber: number, code = "PDF_PAGE_PARSE_FAILED"): DocumentIssue {
  return { code, pageNumber, message: `第 ${pageNumber} 页无法完全解析，已跳过无法读取的内容。` };
}

interface OperatorList { fnArray: number[]; argsArray: (unknown[] | null)[]; }

export function cleanBackgroundOperationsFilter(operators: Pick<OperatorList, "fnArray">): (index: number) => boolean {
  const skipped = new Set<number>(); let annotationDepth = 0;
  for (const [index, operator] of operators.fnArray.entries()) {
    if (operator === OPS.beginAnnotation) { annotationDepth += 1; continue; }
    if (operator === OPS.endAnnotation) { annotationDepth = Math.max(0, annotationDepth - 1); continue; }
    if (annotationDepth === 0 && isGlyphDrawingOperator(operator)) skipped.add(index);
  }
  return (index) => !skipped.has(index);
}

function isGlyphDrawingOperator(operator: number): boolean {
  return operator === OPS.showText || operator === OPS.showSpacedText || operator === OPS.nextLineShowText || operator === OPS.nextLineSetSpacingShowText;
}

export function extractTextColors(operators: OperatorList): Array<string | undefined> {
  const colors: Array<string | undefined> = []; let fillColor: string | undefined;
  for (let index = 0; index < operators.fnArray.length; index += 1) {
    const operator = operators.fnArray[index]; const args = operators.argsArray[index];
    if (operator === OPS.setFillRGBColor) fillColor = normalizeColor(args?.[0]);
    else if (operator === OPS.setFillGray) fillColor = grayColor(args?.[0]);
    else if (operator === OPS.setFillColor) fillColor = undefined;
    if (isGlyphDrawingOperator(operator)) colors.push(fillColor);
  }
  return colors;
}

function normalizeColor(value: unknown): string | undefined { return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : undefined; }
function grayColor(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const channel = Math.round(Math.max(0, Math.min(1, value)) * 255).toString(16).padStart(2, "0");
  return `#${channel}${channel}${channel}`;
}

function extractImages(operators: OperatorList, rawObjects: unknown, pageNumber: number): ImageBlock[] {
  const objects = rawObjects as { has(id: string): boolean; get(id: string): unknown };
  const images: ImageBlock[] = []; let transform = [1, 0, 0, 1, 0, 0];
  for (let index = 0; index < operators.fnArray.length; index += 1) {
    const args = operators.argsArray[index];
    if (operators.fnArray[index] === OPS.transform && args?.length === 6 && args.every((value) => typeof value === "number")) transform = args as number[];
    if (operators.fnArray[index] !== OPS.paintImageXObject || typeof args?.[0] !== "string") continue;
    if (!objects.has(args[0])) continue;
    const value = objects.get(args[0]); const image = isPdfImage(value) ? value : undefined;
    if (!image || image.kind !== 2) continue;
    images.push({ id: `page-${pageNumber}-image-${images.length}`, type: "image", bbox: { x: transform[4], y: transform[5], width: Math.abs(transform[0]), height: Math.abs(transform[3]) }, source: `data:image/bmp;base64,${base64(bmp(image))}`, mimeType: "image/bmp", readingOrder: images.length });
  }
  return images;
}

function extractVectorPaths(operators: OperatorList): Array<{ x: number; y: number; width: number; height: number }> {
  return operators.argsArray.flatMap((args, index) => {
    if (operators.fnArray[index] !== OPS.constructPath || !args?.[2] || !ArrayBuffer.isView(args[2])) return [];
    const [left, bottom, right, top] = Array.from(args[2] as unknown as ArrayLike<number>);
    return [left, bottom, right, top].every(Number.isFinite) && right > left && top > bottom ? [{ x: left, y: bottom, width: right - left, height: top - bottom }] : [];
  });
}

interface PdfImage { width: number; height: number; kind: number; data: Uint8Array; }
function isPdfImage(value: unknown): value is PdfImage { return typeof value === "object" && value !== null && "width" in value && "height" in value && "kind" in value && "data" in value && ((value as PdfImage).data instanceof Uint8Array || (value as PdfImage).data instanceof Uint8ClampedArray); }
function bmp(image: PdfImage): Uint8Array {
  const rowSize = Math.ceil(image.width * 3 / 4) * 4; const output = new Uint8Array(54 + rowSize * image.height); const view = new DataView(output.buffer);
  output.set([66, 77]); view.setUint32(2, output.length, true); view.setUint32(10, 54, true); view.setUint32(14, 40, true); view.setInt32(18, image.width, true); view.setInt32(22, image.height, true); view.setUint16(26, 1, true); view.setUint16(28, 24, true); view.setUint32(34, rowSize * image.height, true);
  for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) { const source = (y * image.width + x) * 3; const target = 54 + (image.height - y - 1) * rowSize + x * 3; output[target] = image.data[source + 2]; output[target + 1] = image.data[source + 1]; output[target + 2] = image.data[source]; }
  return output;
}
function base64(bytes: Uint8Array): string { let binary = ""; for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000)); return btoa(binary); }

function toRawTextItem(item: TextItem, index: number, pageNumber: number, color?: string): RawTextItem {
  const [, b, , d, x, y] = item.transform;
  const fontSize = Math.max(Math.abs(d), item.height, 1);
  return {
    id: `page-${pageNumber}-item-${index}`,
    text: item.str,
    bbox: { x, y, width: item.width, height: fontSize },
    fontName: item.fontName,
    fontSize,
    rotation: Math.atan2(b, item.transform[0]) * (180 / Math.PI),
    color,
  };
}
