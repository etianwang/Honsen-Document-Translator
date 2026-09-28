import { getDocument, GlobalWorkerOptions, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy, TextItem } from "pdfjs-dist/types/src/display/api";
import type { DocumentIssue, ImageBlock, RawDocument, RawPage, RawTextItem } from "@pdf-translator/document-model";

export function configurePdfWorker(workerSrc: string): void { GlobalWorkerOptions.workerSrc = workerSrc; }

export async function renderPdfPage(data: Uint8Array, pageNumber: number, canvas: HTMLCanvasElement, isCancelled?: () => boolean): Promise<void> {
  const pdf = await getDocument({ data }).promise;
  if (isCancelled?.()) return;
  const page = await pdf.getPage(pageNumber);
  if (isCancelled?.()) return;
  const viewport = page.getViewport({ scale: 2 });
  const context = canvas.getContext("2d");
  if (!context) throw new Error("PDF_PREVIEW_CONTEXT_FAILED");
  canvas.width = viewport.width; canvas.height = viewport.height;
  await page.render({ canvas, canvasContext: context, viewport }).promise;
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
    const textItems = content.items.flatMap((item, index) =>
      "str" in item && item.str.trim() ? [toRawTextItem(item, index, pageNumber)] : [],
    );
    let images: ImageBlock[] = [];
    try { images = await extractImages(page, pageNumber); }
    catch (error: unknown) { issues.push(normalizePdfPageError(error, pageNumber, "PDF_IMAGE_EXTRACTION_FAILED")); }
    pages.push({ number: pageNumber, width: viewport.width, height: viewport.height, rotation: page.rotate, textItems, images }); onProgress?.(pageNumber, pdf.numPages);
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

async function extractImages(page: { getOperatorList(): Promise<{ fnArray: number[]; argsArray: (unknown[] | null)[] }>; objs: unknown }, pageNumber: number): Promise<ImageBlock[]> {
  const operators = await page.getOperatorList();
  const objects = page.objs as { has(id: string): boolean; get(id: string): unknown };
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

interface PdfImage { width: number; height: number; kind: number; data: Uint8Array; }
function isPdfImage(value: unknown): value is PdfImage { return typeof value === "object" && value !== null && "width" in value && "height" in value && "kind" in value && "data" in value && ((value as PdfImage).data instanceof Uint8Array || (value as PdfImage).data instanceof Uint8ClampedArray); }
function bmp(image: PdfImage): Uint8Array {
  const rowSize = Math.ceil(image.width * 3 / 4) * 4; const output = new Uint8Array(54 + rowSize * image.height); const view = new DataView(output.buffer);
  output.set([66, 77]); view.setUint32(2, output.length, true); view.setUint32(10, 54, true); view.setUint32(14, 40, true); view.setInt32(18, image.width, true); view.setInt32(22, image.height, true); view.setUint16(26, 1, true); view.setUint16(28, 24, true); view.setUint32(34, rowSize * image.height, true);
  for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) { const source = (y * image.width + x) * 3; const target = 54 + (image.height - y - 1) * rowSize + x * 3; output[target] = image.data[source + 2]; output[target + 1] = image.data[source + 1]; output[target + 2] = image.data[source]; }
  return output;
}
function base64(bytes: Uint8Array): string { let binary = ""; for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000)); return btoa(binary); }

function toRawTextItem(item: TextItem, index: number, pageNumber: number): RawTextItem {
  const [, b, , d, x, y] = item.transform;
  const fontSize = Math.max(Math.abs(d), item.height, 1);
  return {
    id: `page-${pageNumber}-item-${index}`,
    text: item.str,
    bbox: { x, y, width: item.width, height: fontSize },
    fontName: item.fontName,
    fontSize,
    rotation: Math.atan2(b, item.transform[0]) * (180 / Math.PI),
  };
}
