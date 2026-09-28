import { AlignmentType, BorderStyle, Document, Footer, Header, HeightRule, ImageRun, PageNumber, Paragraph, Table, TableCell, TableLayoutType, TableRow, TextRun, VerticalAlignTable, WidthType } from "docx";
import type { DocumentBlock, DocumentModel, HeaderFooter, ParagraphAlignment, ParagraphModel, TableBlock, TextStyle } from "@pdf-translator/document-model";

export function buildDocx(model: DocumentModel): Document {
  return new Document({ sections: model.pages.map((page) => ({
    properties: { page: { size: { width: pointsToTwips(page.width), height: pointsToTwips(page.height) }, margin: { top: pointsToTwips(page.margins.top), right: pointsToTwips(page.margins.right), bottom: pointsToTwips(page.margins.bottom), left: pointsToTwips(page.margins.left) } } }, headers: headerFor(model, page.number), footers: footerFor(model, page.number),
    children: page.blocks.flatMap(toChild),
  })) });
}

function headerFor(model: DocumentModel, pageNumber: number): { default: Header } | undefined {
  const content = sectionContent(model, pageNumber, "header");
  return content ? { default: new Header({ children: content.map(toParagraph) }) } : undefined;
}

function footerFor(model: DocumentModel, pageNumber: number): { default: Footer } {
  const content = sectionContent(model, pageNumber, "footer");
  return { default: new Footer({ children: [...(content?.map(toParagraph) ?? []), new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("Page "), new TextRun({ children: [PageNumber.CURRENT] })] })] }) };
}

function sectionContent(model: DocumentModel, pageNumber: number, kind: HeaderFooter["kind"]): ParagraphModel[] | undefined {
  return model.sections.find((section) => section.pageNumbers.includes(pageNumber))?.[kind === "header" ? "headers" : "footers"].flatMap((item) => item.paragraphs);
}

function toChild(block: DocumentBlock): Array<Paragraph | Table> {
  return block.type === "text" ? block.paragraphs.map(toParagraph) : block.type === "table" ? [toTable(block)] : [new Paragraph({ children: [new ImageRun({ data: dataFromUrl(block.source), type: "bmp", transformation: { width: Math.max(1, block.bbox.width * 4 / 3), height: Math.max(1, block.bbox.height * 4 / 3) } })] })];
}

function dataFromUrl(source: string): Uint8Array { return Uint8Array.from(atob(source.slice(source.indexOf(",") + 1)), (character) => character.charCodeAt(0)); }

function toTable(block: TableBlock): Table {
  const borderColor = block.style.borderColor ?? "D9D9D9";
  return new Table({ width: { size: pointsToTwips(block.columnWidths.reduce((total, width) => total + width, 0)), type: WidthType.DXA }, layout: TableLayoutType.FIXED, columnWidths: block.columnWidths.map(pointsToTwips), borders: { top: { style: BorderStyle.SINGLE, color: borderColor, size: block.style.borderWidth ?? 1 }, bottom: { style: BorderStyle.SINGLE, color: borderColor, size: block.style.borderWidth ?? 1 }, left: { style: BorderStyle.SINGLE, color: borderColor, size: block.style.borderWidth ?? 1 }, right: { style: BorderStyle.SINGLE, color: borderColor, size: block.style.borderWidth ?? 1 }, insideHorizontal: { style: BorderStyle.SINGLE, color: borderColor, size: block.style.borderWidth ?? 1 }, insideVertical: { style: BorderStyle.SINGLE, color: borderColor, size: block.style.borderWidth ?? 1 } }, rows: block.rows.map((row) => new TableRow({ height: row.height ? { value: pointsToTwips(row.height), rule: HeightRule.EXACT } : undefined, children: row.cells.map((cell) => new TableCell({ children: cell.content.map(toParagraph), columnSpan: cell.colSpan, rowSpan: cell.rowSpan, width: { size: pointsToTwips(cell.bbox.width), type: WidthType.DXA }, verticalAlign: cell.style.verticalAlignment === "center" ? VerticalAlignTable.CENTER : cell.style.verticalAlignment === "bottom" ? VerticalAlignTable.BOTTOM : VerticalAlignTable.TOP, shading: cell.style.backgroundColor ? { fill: cell.style.backgroundColor.replace("#", "") } : undefined, margins: cell.style.padding ? { top: pointsToTwips(cell.style.padding), right: pointsToTwips(cell.style.padding), bottom: pointsToTwips(cell.style.padding), left: pointsToTwips(cell.style.padding) } : undefined })) })) });
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
