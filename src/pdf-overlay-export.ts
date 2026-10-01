import { PDFDocument } from "pdf-lib";
import type { BoundingBox, DocumentModel, TextDirection, TextLine } from "@pdf-translator/document-model";
import { renderCleanBackgroundPage } from "@pdf-translator/pdf-parser";

const renderScale = 4;

export async function exportTranslatedPdf(source: Uint8Array, model: DocumentModel): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (const pageModel of model.pages) {
    const canvas = document.createElement("canvas");
    await renderCleanBackgroundPage(source.slice(), pageModel.number, canvas, undefined, renderScale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("PDF_EXPORT_FAILED: canvas renderer is unavailable.");
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

export interface TranslatedPlacement { id: string; lineId: string; bbox: BoundingBox; text: string; direction?: TextDirection; fontSize: number; color?: string; bold?: boolean; italic?: boolean; }

export function translatedPlacements(page: DocumentModel["pages"][number]): TranslatedPlacement[] {
  return translatedLines(page).flatMap((line) => {
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
  const padding = 2 * scale; const x = bbox.x * scale; const y = (pageHeight - bbox.y) * scale; const width = bbox.width * scale; const height = bbox.height * scale;
  if (clearSourceText) { context.fillStyle = "#fff"; context.fillRect(x - padding, y - height - padding, width + padding * 2, height + padding * 2); }
  if (!text.trim()) return;
  const sourceSize = placement.fontSize * scale;
  const innerHeight = Math.max(1, height - padding * 2);
  const fontStyle = `${placement.italic ? "italic " : ""}${placement.bold ? "bold " : ""}`;
  context.font = `${fontStyle}${sourceSize}px Arial, "Microsoft YaHei", sans-serif`;
  const fontSize = Math.max(1.5 * scale, Math.min(sourceSize, innerHeight / 1.15, width / context.measureText(text).width * sourceSize));
  context.font = `${fontStyle}${fontSize}px Arial, "Microsoft YaHei", sans-serif`;
  const baseline = y - height + padding + (innerHeight - fontSize) / 2 + fontSize * 0.8;
  context.fillStyle = placement.color ?? "#000"; context.textBaseline = "alphabetic"; context.direction = placement.direction === "rtl" ? "rtl" : "ltr"; context.textAlign = placement.direction === "rtl" ? "right" : "left";
  context.fillText(text, placement.direction === "rtl" ? x + width - padding : x + padding, baseline, Math.max(1, width - padding * 2));
}

function dataUrlBytes(value: string): Uint8Array { return Uint8Array.from(atob(value.split(",")[1]), (character) => character.charCodeAt(0)); }
