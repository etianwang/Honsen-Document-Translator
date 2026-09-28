import type { DocumentBlock, DocumentModel, ParagraphModel, TextLine, TextRun } from "./types";

export function textRuns(model: DocumentModel): TextRun[] {
  return model.pages.flatMap((page) => page.blocks).flatMap(paragraphsFor).flatMap((paragraph) => paragraph.lines).flatMap((line) => line.runs);
}

export function textLines(model: DocumentModel): TextLine[] {
  return model.pages.flatMap((page) => page.blocks).flatMap(paragraphsFor).flatMap((paragraph) => paragraph.lines);
}

export function mapTextRuns(model: DocumentModel, map: (run: TextRun) => TextRun): DocumentModel {
  return {
    ...model,
    pages: model.pages.map((page) => ({
      ...page,
      blocks: page.blocks.map((block) => block.type === "text"
        ? { ...block, paragraphs: mapParagraphs(block.paragraphs, map) }
        : block.type === "table"
          ? { ...block, rows: block.rows.map((row) => ({ ...row, cells: row.cells.map((cell) => ({ ...cell, content: mapParagraphs(cell.content, map) })) })) }
          : block),
    })),
  };
}

export function mapTextLines(model: DocumentModel, map: (line: TextLine) => TextLine): DocumentModel {
  return {
    ...model,
    pages: model.pages.map((page) => ({
      ...page,
      blocks: page.blocks.map((block) => block.type === "text"
        ? { ...block, paragraphs: block.paragraphs.map((paragraph) => ({ ...paragraph, lines: paragraph.lines.map(map) })) }
        : block.type === "table"
          ? { ...block, rows: block.rows.map((row) => ({ ...row, cells: row.cells.map((cell) => ({ ...cell, content: cell.content.map((paragraph) => ({ ...paragraph, lines: paragraph.lines.map(map) })) })) })) }
          : block),
    })),
  };
}

function paragraphsFor(block: DocumentBlock): ParagraphModel[] { return block.type === "text" ? block.paragraphs : block.type === "table" ? block.rows.flatMap((row) => row.cells).flatMap((cell) => cell.content) : []; }
function mapParagraphs(paragraphs: ParagraphModel[], map: (run: TextRun) => TextRun): ParagraphModel[] { return paragraphs.map((paragraph) => ({ ...paragraph, lines: paragraph.lines.map((line) => ({ ...line, runs: line.runs.map(map) })) })); }
