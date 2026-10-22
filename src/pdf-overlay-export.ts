import { degrees, PDFDocument } from "pdf-lib";
import type { BoundingBox, DocumentModel, TextDirection, TextLine } from "@pdf-translator/document-model";
import { renderCleanBackgroundPage } from "@pdf-translator/pdf-parser";

const renderScale = 4;
// PDF.js reports the text matrix at the baseline, not the bottom of the glyph box.
const textBaselineDescent = 0.22;

export interface RenderedTranslationPage { number: number; width: number; height: number; png: Uint8Array; }

export async function exportTranslatedPdf(source: Uint8Array, model: DocumentModel, maskedPages: ReadonlySet<number> = new Set()): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (const pageModel of await renderTranslatedPages(source, model, maskedPages)) {
    const page = pdf.addPage([pageModel.width, pageModel.height]);
    page.drawImage(await pdf.embedPng(pageModel.png), { x: 0, y: 0, width: pageModel.width, height: pageModel.height });
  }
  return pdf.save();
}

export async function renderTranslatedPages(source: Uint8Array, model: DocumentModel, maskedPages: ReadonlySet<number> = new Set()): Promise<RenderedTranslationPage[]> {
  const pages: RenderedTranslationPage[] = [];
  for (const pageModel of model.pages) {
    const canvas = document.createElement("canvas");
    const usedFallback = (await renderCleanBackgroundPage(source.slice(), pageModel.number, canvas, undefined, renderScale)) || maskedPages.has(pageModel.number);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("PDF_EXPORT_FAILED: canvas renderer is unavailable.");
    // Match preview rendering: only OCR and pages where clean-background rendering failed need a white text mask.
    for (const placement of translatedPlacements(pageModel)) paintTranslatedPlacement(context, placement, pageModel.height, usedFallback);
    pages.push({ number: pageModel.number, width: pageModel.width, height: pageModel.height, png: dataUrlBytes(canvas.toDataURL("image/png")) });
  }
  return pages;
}

export function translatedLines(page: DocumentModel["pages"][number]): TextLine[] {
  return page.blocks.flatMap((block) => block.type === "text"
    ? block.paragraphs.flatMap((paragraph) => paragraph.lines)
    : block.type === "table"
      ? block.rows.flatMap((row) => row.cells).flatMap((cell) => cell.content).flatMap((paragraph) => paragraph.lines)
      : []);
}

export function translatedLineText(line: TextLine): string | undefined {
  return line.runs.some((run) => run.translatedText !== undefined) ? line.runs.map((run) => run.translatedText ?? "").join("") : undefined;
}

export interface TranslatedPlacement { id: string; lineId: string; bbox: BoundingBox; text: string; direction?: TextDirection; fontSize: number; color?: string; bold?: boolean; italic?: boolean; }

export function placementTop(pageHeight: number, bbox: BoundingBox): number {
  return pageHeight - bbox.y - bbox.height * (1 - textBaselineDescent);
}

export function translatedPlacements(page: DocumentModel["pages"][number]): TranslatedPlacement[] {
  const emittedSourceRuns = new Set<string>();
  return translatedLines(page).flatMap((line) => {
    const sourceRuns = line.runs.map((run) => run.id).sort().join("|");
    if (emittedSourceRuns.has(sourceRuns)) return [];
    emittedSourceRuns.add(sourceRuns);
    const text = translatedLineText(line) ?? line.runs.map((run) => run.text).join("");
    if (!text.trim()) return [];
    const split = line.runs.slice(1).some((run) => Boolean(run.translatedText));
    if (split) return line.runs.filter((run) => run.translatedText !== undefined).map((run) => placementForRun(run, run.id, run.id, run.bbox, run.translatedText ?? "", line.direction));
    const source = line.runs.reduce((largest, run) => (run.style.fontSize ?? run.bbox.height) > (largest.style.fontSize ?? largest.bbox.height) ? run : largest);
    return [placementForRun(source, line.id, line.id, line.bbox, text, line.direction)];
  });
}

function placementForRun(run: TextLine["runs"][number], id: string, lineId: string, bbox: BoundingBox, text: string, direction: TextDirection | undefined): TranslatedPlacement {
  return { id, lineId, bbox, text, direction, fontSize: run.style.fontSize ?? run.bbox.height, color: run.style.color, bold: run.style.bold || (run.style.fontWeight ?? 0) >= 600, italic: run.style.italic };
}

export function paintTranslatedPlacement(context: CanvasRenderingContext2D, placement: TranslatedPlacement, pageHeight: number, clearSourceText = true): void {
  const { bbox, text } = placement;
  const scale = context.canvas.height / pageHeight;
  const padding = 0.25 * scale; const maskPadding = 2 * scale; const x = bbox.x * scale; const top = placementTop(pageHeight, bbox) * scale; const width = bbox.width * scale; const height = bbox.height * scale;
  if (clearSourceText) { context.fillStyle = "#fff"; context.fillRect(x - maskPadding, top - maskPadding, width + maskPadding * 2, height + maskPadding * 2); }
  if (!text.trim()) return;
  const sourceSize = placement.fontSize * scale;
  const innerHeight = Math.max(1, height - padding * 2);
  const fontStyle = `${placement.italic ? "italic " : ""}${placement.bold ? "bold " : ""}`;
  context.font = `${fontStyle}${sourceSize}px Arial, "Microsoft YaHei", sans-serif`;
  const fontSize = Math.max(1.5 * scale, Math.min(sourceSize, innerHeight / 1.15, width / context.measureText(text).width * sourceSize));
  context.font = `${fontStyle}${fontSize}px Arial, "Microsoft YaHei", sans-serif`;
  const baseline = top + padding + (innerHeight - fontSize) / 2 + fontSize * 0.8;
  context.fillStyle = placement.color ?? "#000"; context.textBaseline = "alphabetic"; context.direction = placement.direction === "rtl" ? "rtl" : "ltr"; context.textAlign = placement.direction === "rtl" ? "right" : "left";
  context.fillText(text, placement.direction === "rtl" ? x + width - padding : x + padding, baseline, Math.max(1, width - padding * 2));
}

function dataUrlBytes(value: string): Uint8Array { return Uint8Array.from(atob(value.split(",")[1]), (character) => character.charCodeAt(0)); }

export async function combineBilingualPdf(source: Uint8Array, translated: Uint8Array): Promise<Uint8Array> {
  const original = await PDFDocument.load(source);
  const translation = await PDFDocument.load(translated);
  if (original.getPageCount() !== translation.getPageCount()) throw new Error("PDF_EXPORT_FAILED: 页面数量不匹配。");
  const output = await PDFDocument.create();
  for (let index = 0; index < original.getPageCount(); index++) {
    const originalPage = original.getPage(index);
    const translatedPage = translation.getPage(index);
    // Blank PDF pages can have no content stream, which pdf-lib cannot embed.
    if (!originalPage.node.Contents()) originalPage.drawRectangle({ width: 0, height: 0 });
    if (!translatedPage.node.Contents()) translatedPage.drawRectangle({ width: 0, height: 0 });
    const crop = originalPage.getCropBox();
    const [left, right] = await Promise.all([output.embedPage(originalPage, { left: crop.x, bottom: crop.y, right: crop.x + crop.width, top: crop.y + crop.height }), output.embedPage(translatedPage)]);
    const rotation = ((originalPage.getRotation().angle % 360) + 360) % 360;
    const leftWidth = rotation === 90 || rotation === 270 ? left.height : left.width;
    const leftHeight = rotation === 90 || rotation === 270 ? left.width : left.height;
    const page = output.addPage([leftWidth + right.width, Math.max(leftHeight, right.height)]);
    const top = page.getHeight() - leftHeight;
    page.drawPage(left, { x: rotation === 180 ? leftWidth : rotation === 270 ? leftWidth : 0, y: top + (rotation === 90 || rotation === 180 ? leftHeight : 0), rotate: degrees(-rotation) });
    page.drawPage(right, { x: leftWidth, y: page.getHeight() - right.height });
  }
  return output.save();
}
