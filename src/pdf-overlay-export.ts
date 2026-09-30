import { PDFDocument } from "pdf-lib";
import type { BoundingBox, DocumentModel, TextDirection, TextLine } from "@pdf-translator/document-model";
import { renderCleanBackgroundPage } from "@pdf-translator/pdf-parser";

const renderScale = 4;

export async function exportTranslatedPdf(source: Uint8Array, model: DocumentModel, maskedPages: ReadonlySet<number> = new Set()): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (const pageModel of model.pages) {
    const canvas = document.createElement("canvas");
    const usedFallback = (await renderCleanBackgroundPage(source.slice(), pageModel.number, canvas, undefined, renderScale)) || maskedPages.has(pageModel.number);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("PDF_EXPORT_FAILED: canvas renderer is unavailable.");
    if (usedFallback) for (const region of translatedCellRegions(pageModel)) maskRegion(context, region, pageModel.height);
    // PDF.js may report a clean background even when text is painted inside a form/annotation.
    // Always clear the translated bbox so the export cannot overlay surviving source glyphs.
    for (const placement of translatedPlacements(pageModel)) paintTranslatedPlacement(context, placement, pageModel.height, true);
    const page = pdf.addPage([pageModel.width, pageModel.height]);
    page.drawImage(await pdf.embedPng(dataUrlBytes(canvas.toDataURL("image/png"))), { x: 0, y: 0, width: pageModel.width, height: pageModel.height });
  }
  return pdf.save();
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

export interface TranslatedPlacement { id: string; lineId: string; bbox: BoundingBox; text: string; direction?: TextDirection; fontSize: number; }

export function translatedCellRegions(page: DocumentModel["pages"][number]): BoundingBox[] {
  return page.blocks.flatMap((block) => block.type === "table"
    ? block.rows.flatMap((row) => row.cells).filter((cell) => cell.content.some((paragraph) => paragraph.lines.some((line) => line.runs.some((run) => run.translatedText !== undefined)))).map((cell) => cell.bbox)
    : []);
}

export function translatedPlacements(page: DocumentModel["pages"][number]): TranslatedPlacement[] {
  return translatedLines(page).flatMap((line) => {
    const text = translatedLineText(line);
    if (text === undefined) return [];
    const split = line.runs.slice(1).some((run) => Boolean(run.translatedText));
    return split
      ? line.runs.filter((run) => run.translatedText !== undefined).map((run) => ({ id: run.id, lineId: run.id, bbox: run.bbox, text: run.translatedText ?? "", direction: line.direction, fontSize: run.style.fontSize ?? run.bbox.height }))
      : [{ id: line.id, lineId: line.id, bbox: line.bbox, text, direction: line.direction, fontSize: Math.max(...line.runs.map((run) => run.style.fontSize ?? run.bbox.height), 1) }];
  });
}

export function paintTranslatedPlacement(context: CanvasRenderingContext2D, placement: TranslatedPlacement, pageHeight: number, clearSourceText = true): void {
  const { bbox, text } = placement;
  const scale = context.canvas.height / pageHeight;
  const padding = 2 * scale; const x = bbox.x * scale; const y = (pageHeight - bbox.y) * scale; const width = bbox.width * scale; const height = bbox.height * scale;
  if (clearSourceText) { context.fillStyle = "#fff"; context.fillRect(x - padding, y - height - padding, width + padding * 2, height + padding * 2); }
  if (!text.trim()) return;
  const sourceSize = placement.fontSize * scale;
  const innerHeight = Math.max(1, height - padding * 2);
  context.font = `${sourceSize}px Arial, "Microsoft YaHei", sans-serif`;
  const fontSize = Math.max(1.5 * scale, Math.min(sourceSize, innerHeight / 1.15, width / context.measureText(text).width * sourceSize));
  context.font = `${fontSize}px Arial, "Microsoft YaHei", sans-serif`;
  const baseline = y - height + padding + (innerHeight - fontSize) / 2 + fontSize * 0.8;
  context.fillStyle = "#000"; context.textBaseline = "alphabetic"; context.direction = placement.direction === "rtl" ? "rtl" : "ltr"; context.textAlign = placement.direction === "rtl" ? "right" : "left";
  context.fillText(text, placement.direction === "rtl" ? x + width - padding : x + padding, baseline, Math.max(1, width - padding * 2));
}

function maskRegion(context: CanvasRenderingContext2D, bbox: BoundingBox, pageHeight: number): void {
  const scale = context.canvas.height / pageHeight; const inset = scale;
  const x = bbox.x * scale; const y = (pageHeight - bbox.y - bbox.height) * scale; const width = bbox.width * scale; const height = bbox.height * scale;
  context.fillStyle = "#fff";
  context.fillRect(x + inset, y + inset, Math.max(0, width - inset * 2), Math.max(0, height - inset * 2));
}

function dataUrlBytes(value: string): Uint8Array { return Uint8Array.from(atob(value.split(",")[1]), (character) => character.charCodeAt(0)); }
