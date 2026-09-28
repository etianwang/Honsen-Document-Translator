import { AlignmentType, BorderStyle, Document, FrameAnchorType, FrameWrap, HeightRule, HorizontalPositionRelativeFrom, ImageRun, Paragraph, Table, TableAnchorType, TableCell, TableLayoutType, TableRow, TextRun, VerticalAlignTable, VerticalPositionRelativeFrom, WidthType } from "docx";
import type { DocumentBlock, DocumentModel, DocumentPage, ParagraphAlignment, ParagraphModel, TableBlock, TextLine, TextStyle } from "@pdf-translator/document-model";

export function buildDocx(model: DocumentModel): Document {
  return new Document({ sections: model.pages.map((page) => ({
    properties: { page: { size: { width: pointsToTwips(page.width), height: pointsToTwips(page.height) }, margin: { top: 0, right: 0, bottom: 0, left: 0 } } },
    children: page.blocks.flatMap((block) => toChild(block, page)),
  })) });
}

function toChild(block: DocumentBlock, page: DocumentPage): Array<Paragraph | Table> {
  return block.type === "text"
    ? block.paragraphs.flatMap((paragraph) => paragraph.lines.map((line) => toPositionedParagraph(paragraph, line, page)))
    : block.type === "table" ? [toTable(block, page)]
      : [new Paragraph({ children: [new ImageRun({ data: dataFromUrl(block.source), type: "bmp", transformation: { width: Math.max(1, block.bbox.width * 4 / 3), height: Math.max(1, block.bbox.height * 4 / 3) }, floating: { horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: pointsToEmus(block.bbox.x) }, verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: pointsToEmus(topOf(block.bbox, page)) }, behindDocument: false } })] })];
}

function dataFromUrl(source: string): Uint8Array { return Uint8Array.from(atob(source.slice(source.indexOf(",") + 1)), (character) => character.charCodeAt(0)); }

function toTable(block: TableBlock, page: DocumentPage): Table {
  const borderColor = block.style.borderColor ?? "D9D9D9";
  return new Table({ width: { size: pointsToTwips(block.columnWidths.reduce((total, width) => total + width, 0)), type: WidthType.DXA }, layout: TableLayoutType.FIXED, columnWidths: block.columnWidths.map(pointsToTwips), float: { horizontalAnchor: TableAnchorType.PAGE, verticalAnchor: TableAnchorType.PAGE, absoluteHorizontalPosition: pointsToTwips(block.bbox.x), absoluteVerticalPosition: pointsToTwips(topOf(block.bbox, page)) }, margins: { top: 0, right: 0, bottom: 0, left: 0 }, borders: { top: { style: BorderStyle.SINGLE, color: borderColor, size: block.style.borderWidth ?? 1 }, bottom: { style: BorderStyle.SINGLE, color: borderColor, size: block.style.borderWidth ?? 1 }, left: { style: BorderStyle.SINGLE, color: borderColor, size: block.style.borderWidth ?? 1 }, right: { style: BorderStyle.SINGLE, color: borderColor, size: block.style.borderWidth ?? 1 }, insideHorizontal: { style: BorderStyle.SINGLE, color: borderColor, size: block.style.borderWidth ?? 1 }, insideVertical: { style: BorderStyle.SINGLE, color: borderColor, size: block.style.borderWidth ?? 1 } }, rows: block.rows.map((row) => new TableRow({ height: row.height ? { value: pointsToTwips(row.height), rule: HeightRule.EXACT } : undefined, children: row.cells.map((cell) => new TableCell({ children: cell.content.map(toParagraph), columnSpan: cell.colSpan, rowSpan: cell.rowSpan, width: { size: pointsToTwips(cell.bbox.width), type: WidthType.DXA }, verticalAlign: cell.style.verticalAlignment === "center" ? VerticalAlignTable.CENTER : cell.style.verticalAlignment === "bottom" ? VerticalAlignTable.BOTTOM : VerticalAlignTable.TOP, shading: cell.style.backgroundColor ? { fill: cell.style.backgroundColor.replace("#", "") } : undefined, margins: { top: cell.style.padding ? pointsToTwips(cell.style.padding) : 0, right: cell.style.padding ? pointsToTwips(cell.style.padding) : 0, bottom: cell.style.padding ? pointsToTwips(cell.style.padding) : 0, left: cell.style.padding ? pointsToTwips(cell.style.padding) : 0 } })) })) });
}

function toPositionedParagraph(paragraph: ParagraphModel, line: TextLine, page: DocumentPage): Paragraph {
  return new Paragraph({ alignment: alignment(paragraph.alignment), bidirectional: paragraph.direction === "rtl", frame: { type: "absolute", position: { x: pointsToTwips(line.bbox.x), y: pointsToTwips(topOf(line.bbox, page)) }, width: pointsToTwips(line.bbox.width), height: pointsToTwips(line.bbox.height), anchor: { horizontal: FrameAnchorType.PAGE, vertical: FrameAnchorType.PAGE }, wrap: FrameWrap.NONE, rule: HeightRule.EXACT }, children: line.runs.map((run) => new TextRun({ text: run.translatedText ?? run.text, ...toRunOptions(run.style, paragraph.direction === "rtl") })) });
}

function toParagraph(paragraph: ParagraphModel): Paragraph {
  return new Paragraph({ alignment: alignment(paragraph.alignment), bidirectional: paragraph.direction === "rtl", children: paragraph.lines.flatMap((line, lineIndex) => line.runs.map((run, runIndex) => new TextRun({ break: lineIndex && runIndex === 0 ? 1 : undefined, text: run.translatedText ?? run.text, ...toRunOptions(run.style, paragraph.direction === "rtl") }))) });
}

function toRunOptions(style: TextStyle, rightToLeft = false) {
  return { font: style.fontFamily, size: style.fontSize ? style.fontSize * 2 : undefined, bold: style.bold, italics: style.italic, color: style.color?.replace("#", ""), underline: style.underline ? {} : undefined, strike: style.strike, rightToLeft };
}

function alignment(value: ParagraphAlignment): (typeof AlignmentType)[keyof typeof AlignmentType] {
  return { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED }[value];
}

function pointsToTwips(points: number): number { return Math.round(points * 20); }
function pointsToEmus(points: number): number { return Math.round(points * 12700); }
function topOf(box: { y: number; height: number }, page: DocumentPage): number { return page.height - box.y - box.height; }
