import type { BoundingBox, DocumentBlock, DocumentModel, DocumentPage, ParagraphModel, RawDocument, RawPage, RawTextItem, TableBlock, TextBlock, TextLine } from "@pdf-translator/document-model";

export function reconstructPage(page: RawPage): DocumentPage {
  const lines = groupLines(page.textItems); const images = page.images ?? [];
  const table = detectSimpleTable(lines, page.number);
  if (table) return { number: page.number, width: page.width, height: page.height, rotation: page.rotation, margins: { top: 72, right: 72, bottom: 72, left: 72 }, blocks: [...images, table] };
  const paragraphs = groupParagraphs(lines);
  const textBlocks: TextBlock[] = paragraphs.map((paragraph, index) => ({
    id: `page-${page.number}-block-${index}`,
    type: "text",
    bbox: bounds(paragraph.lines.map((line) => line.bbox)),
    paragraphs: [paragraph],
    readingOrder: index,
  }));
  const blocks: DocumentBlock[] = [...images, ...textBlocks];
  return { number: page.number, width: page.width, height: page.height, rotation: page.rotation, margins: { top: 72, right: 72, bottom: 72, left: 72 }, blocks };
}

export function reconstructDocument(raw: RawDocument): DocumentModel {
  const pages = raw.pages.map(reconstructPage);
  if (pages.length < 2) return { version: 1, sourcePath: raw.sourcePath, pages, sections: [] };
  const header = repeatedBlock(pages, "header");
  const footer = repeatedBlock(pages, "footer");
  const sharedIds = new Set([header?.id, footer?.id].filter((id): id is string => Boolean(id)));
  const cleanPages = pages.map((page) => ({ ...page, blocks: page.blocks.filter((block) => !sharedIds.has(block.id.replace(/page-\d+-/, "page-1-"))) }));
  const headers = header ? [{ kind: "header" as const, paragraphs: header.paragraphs }] : [];
  const footers = footer ? [{ kind: "footer" as const, paragraphs: footer.paragraphs }] : [];
  return { version: 1, sourcePath: raw.sourcePath, pages: cleanPages, sections: [{ id: "section-1", pageNumbers: pages.map((page) => page.number), pageSize: { width: pages[0].width, height: pages[0].height }, margins: pages[0].margins, headers, footers }] };
}

function repeatedBlock(pages: DocumentPage[], kind: "header" | "footer"): TextBlock | undefined {
  const candidates = pages.map((page) => page.blocks.filter((block): block is TextBlock => block.type === "text" && (kind === "header" ? block.bbox.y > page.height * 0.9 : block.bbox.y < page.height * 0.1)));
  const first = candidates[0]?.[0];
  if (!first) return undefined;
  const text = textOf(first);
  return candidates.every((blocks) => blocks.some((block) => textOf(block) === text)) ? first : undefined;
}

function textOf(block: TextBlock): string { return block.paragraphs.flatMap((paragraph) => paragraph.lines).flatMap((line) => line.runs).map((run) => run.text).join(""); }

function detectSimpleTable(lines: TextLine[], pageNumber: number): TableBlock | undefined {
  const columnCount = lines[0]?.runs.length;
  if (!columnCount || columnCount < 2 || lines.length < 2 || !lines.every((line) => line.runs.length === columnCount)) return undefined;
  const anchors = lines[0].runs.map((run) => run.bbox.x);
  if (!lines.every((line) => line.runs.every((run, index) => Math.abs(run.bbox.x - anchors[index]) <= 5))) return undefined;
  // ponytail: detects only fully aligned, bordered-style tables; add drawing-line analysis for irregular tables.
  const columnWidths = anchors.map((anchor, index) => (index + 1 < anchors.length ? anchors[index + 1] - anchor : Math.max(...lines.map((line) => line.runs[index].bbox.width))));
  return { id: `page-${pageNumber}-table-0`, type: "table", bbox: bounds(lines.map((line) => line.bbox)), readingOrder: 0, columnWidths, style: { borderColor: "D9D9D9", borderWidth: 1 }, rows: lines.map((line, rowIndex) => ({ index: rowIndex, height: line.bbox.height, cells: line.runs.map((run, columnIndex) => ({ rowIndex, columnIndex, bbox: run.bbox, content: [{ id: `${run.id}-paragraph`, bbox: run.bbox, alignment: "left", lines: [{ id: `${run.id}-line`, bbox: run.bbox, runs: [run] }] }], style: {} })) })) };
}

function groupLines(items: RawTextItem[]): TextLine[] {
  const sorted = [...items].sort((left, right) => right.bbox.y - left.bbox.y || left.bbox.x - right.bbox.x);
  const lines: RawTextItem[][] = [];
  for (const item of sorted) {
    const current = lines[lines.length - 1];
    const tolerance = Math.max(2, item.fontSize * 0.35);
    if (current && Math.abs(current[0].bbox.y - item.bbox.y) <= tolerance) current.push(item);
    else lines.push([item]);
  }
  return lines.map((itemsInLine, index) => makeLine(itemsInLine, index));
}

function makeLine(items: RawTextItem[], index: number): TextLine {
  const direction = items.some((item) => item.direction === "rtl") ? "rtl" as const : undefined;
  const ordered = [...items].sort((left, right) => direction === "rtl" ? right.bbox.x - left.bbox.x : left.bbox.x - right.bbox.x);
  return { id: `line-${index}`, bbox: bounds(ordered.map((item) => item.bbox)), direction, runs: ordered.map((item) => ({ id: item.id, bbox: item.bbox, text: item.text, style: { originalFontName: item.fontName, fontSize: item.fontSize, bold: /bold/i.test(item.fontName), italic: /italic|oblique/i.test(item.fontName), rotation: item.rotation } })) };
}

function groupParagraphs(lines: TextLine[]): ParagraphModel[] {
  const gaps = lines.slice(1).map((line, index) => lines[index].bbox.y - line.bbox.y);
  const baseline = gaps.length ? Math.min(...gaps.filter((gap) => gap > 0)) : 0;
  const paragraphs: TextLine[][] = [];
  for (const line of lines) {
    const lastParagraph = paragraphs[paragraphs.length - 1];
    const previous = lastParagraph?.[lastParagraph.length - 1];
    if (previous && baseline > 0 && previous.bbox.y - line.bbox.y > baseline * 1.6) paragraphs.push([line]);
    else if (lastParagraph) lastParagraph.push(line);
    else paragraphs.push([line]);
  }
  return paragraphs.map((paragraphLines, index) => ({ id: `paragraph-${index}`, bbox: bounds(paragraphLines.map((line) => line.bbox)), alignment: paragraphLines[0]?.direction === "rtl" ? "right" : "left", direction: paragraphLines[0]?.direction, lines: paragraphLines }));
}

function bounds(boxes: BoundingBox[]): BoundingBox {
  const left = Math.min(...boxes.map((box) => box.x)); const bottom = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width)); const top = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: bottom, width: right - left, height: top - bottom };
}
