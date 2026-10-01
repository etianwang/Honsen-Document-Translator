import type { BoundingBox, DocumentBlock, DocumentModel, DocumentPage, ParagraphModel, RawDocument, RawPage, RawTextItem, TableBlock, TextBlock, TextLine } from "@pdf-translator/document-model";

export function reconstructPage(page: RawPage): DocumentPage {
  const lines = groupLines(page.textItems, page.number); const images = page.images ?? [];
  const blocks: DocumentBlock[] = [...images, ...blocksFromLines(lines, page, images.length)];
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

function blocksFromLines(lines: TextLine[], page: RawPage, readingOrderStart: number): DocumentBlock[] {
  const vectorTable = tableFromVectorPaths(lines, page, readingOrderStart);
  if (vectorTable) {
    const text = textBlocks(vectorTable.remainingLines, page.number, readingOrderStart);
    return [...text, { ...vectorTable.block, readingOrder: readingOrderStart + text.length }];
  }
  const pageNumber = page.number;
  const tables = detectSimpleTables(lines, pageNumber);
  const blocks: DocumentBlock[] = [];
  let start = 0; let readingOrder = readingOrderStart;
  for (const table of tables) {
    const text = textBlocks(lines.slice(start, table.start), pageNumber, readingOrder);
    blocks.push(...text); readingOrder += text.length;
    blocks.push({ ...table.block, readingOrder: readingOrder }); readingOrder += 1;
    start = table.end;
  }
  blocks.push(...textBlocks(lines.slice(start), pageNumber, readingOrder));
  return blocks;
}

function tableFromVectorPaths(lines: TextLine[], page: RawPage, readingOrder: number): { block: TableBlock; remainingLines: TextLine[] } | undefined {
  const cells = connectedVectorCells(page.vectorPaths ?? [], page);
  if (cells.length < 6) return undefined;
  const tableBox = bounds(cells);
  const rows = rowGroups(cells).map((rowCells, rowIndex) => ({
    index: rowIndex,
    height: Math.max(...rowCells.map((cell) => cell.height)),
    cells: rowCells.sort((left, right) => left.x - right.x).map((cell, columnIndex) => ({
      rowIndex, columnIndex, bbox: cell,
      content: groupParagraphs(linesForCell(lines, cell, `${page.number}-${rowIndex}-${columnIndex}`)),
      style: {},
    })),
  }));
  const columnStarts = [...new Set(cells.map((cell) => snap(cell.x)))].sort((left, right) => left - right);
  const columnWidths = columnStarts.map((start, index) => index + 1 < columnStarts.length ? columnStarts[index + 1] - start : Math.max(...cells.filter((cell) => Math.abs(cell.x - start) < 1).map((cell) => cell.width)));
  return {
    block: { id: `page-${page.number}-vector-table-0`, type: "table", bbox: tableBox, readingOrder, columnWidths, style: { borderColor: "D9D9D9", borderWidth: 1 }, rows },
    remainingLines: subtractCellLines(lines, cells),
  };
}

function connectedVectorCells(paths: BoundingBox[], page: RawPage): BoundingBox[] {
  const candidates = paths.filter((box) => box.width >= 8 && box.height >= 8 && box.width < page.width * 0.98 && box.height < page.height * 0.98);
  const components: BoundingBox[][] = [];
  for (const cell of candidates) {
    const component = components.find((current) => current.some((other) => relatedCells(cell, other, page.width)));
    if (component) component.push(cell); else components.push([cell]);
  }
  const largest = components.sort((left, right) => right.length - left.length)[0] ?? [];
  return largest.filter((cell, index) => largest.findIndex((other) => sameBox(cell, other)) === index);
}

function relatedCells(left: BoundingBox, right: BoundingBox, pageWidth: number): boolean {
  const sameRow = overlap(left.y, left.y + left.height, right.y, right.y + right.height) > Math.min(left.height, right.height) * 0.8;
  const sameColumn = overlap(left.x, left.x + left.width, right.x, right.x + right.width) > Math.min(left.width, right.width) * 0.8;
  const horizontalGap = Math.max(left.x, right.x) - Math.min(left.x + left.width, right.x + right.width);
  const verticalGap = Math.max(left.y, right.y) - Math.min(left.y + left.height, right.y + right.height);
  return (sameRow && horizontalGap <= pageWidth * 0.25) || (sameColumn && verticalGap <= 2);
}

function rowGroups(cells: BoundingBox[]): BoundingBox[][] {
  const groups: BoundingBox[][] = [];
  for (const cell of [...cells].sort((left, right) => right.y + right.height - (left.y + left.height) || left.x - right.x)) {
    const group = groups.find((current) => Math.abs(current[0].y + current[0].height - (cell.y + cell.height)) < 2);
    if (group) group.push(cell); else groups.push([cell]);
  }
  return groups;
}

function linesForCell(lines: TextLine[], cell: BoundingBox, suffix: string): TextLine[] {
  return lines.flatMap((line) => {
    const runs = line.runs.filter((run) => contained(run.bbox, cell));
    return runs.length ? [{ ...line, id: `${line.id}-cell-${suffix}`, bbox: bounds(runs.map((run) => run.bbox)), runs }] : [];
  });
}

function subtractCellLines(lines: TextLine[], cells: BoundingBox[]): TextLine[] {
  return lines.flatMap((line) => {
    const runs = line.runs.filter((run) => !cells.some((cell) => contained(run.bbox, cell)));
    return runs.length ? [{ ...line, bbox: bounds(runs.map((run) => run.bbox)), runs }] : [];
  });
}

function contained(box: BoundingBox, region: BoundingBox): boolean {
  const x = box.x + box.width / 2; const y = box.y + box.height / 2;
  return x >= region.x - 2 && x <= region.x + region.width + 2 && y >= region.y - 2 && y <= region.y + region.height + 2;
}

function sameBox(left: BoundingBox, right: BoundingBox): boolean { return Math.abs(left.x - right.x) < 1 && Math.abs(left.y - right.y) < 1 && Math.abs(left.width - right.width) < 1 && Math.abs(left.height - right.height) < 1; }
function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number { return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart)); }
function snap(value: number): number { return Math.round(value * 2) / 2; }

function textBlocks(lines: TextLine[], pageNumber: number, readingOrder: number): TextBlock[] {
  return groupParagraphs(lines).map((paragraph, index) => ({ id: `page-${pageNumber}-block-${readingOrder + index}`, type: "text", bbox: bounds(paragraph.lines.map((line) => line.bbox)), paragraphs: [paragraph], readingOrder: readingOrder + index }));
}

function detectSimpleTables(lines: TextLine[], pageNumber: number): Array<{ start: number; end: number; block: TableBlock }> {
  const tables: Array<{ start: number; end: number; block: TableBlock }> = [];
  for (let start = 0; start < lines.length - 1;) {
    const anchors = lines[start].runs.map((run) => run.bbox.x);
    if (anchors.length < 2) { start += 1; continue; }
    let end = start + 1;
    while (end < lines.length && isAlignedRow(lines[end], anchors)) end += 1;
    if (end - start < 2) { start += 1; continue; }
    const rows = lines.slice(start, end);
    tables.push({ start, end, block: tableFromRows(rows, pageNumber, tables.length) });
    start = end;
  }
  return tables;
}

function isAlignedRow(line: TextLine, anchors: number[]): boolean {
  return line.runs.length === anchors.length && line.runs.every((run, index) => Math.abs(run.bbox.x - anchors[index]) <= 5);
}

function tableFromRows(lines: TextLine[], pageNumber: number, tableIndex: number): TableBlock {
  const anchors = lines[0].runs.map((run) => run.bbox.x);
  // ponytail: detects only fully aligned, bordered-style tables; add drawing-line analysis for irregular tables.
  const columnWidths = anchors.map((anchor, index) => (index + 1 < anchors.length ? anchors[index + 1] - anchor : Math.max(...lines.map((line) => line.runs[index].bbox.width))));
  return { id: `page-${pageNumber}-table-${tableIndex}`, type: "table", bbox: bounds(lines.map((line) => line.bbox)), readingOrder: 0, columnWidths, style: { borderColor: "D9D9D9", borderWidth: 1 }, rows: lines.map((line, rowIndex) => ({ index: rowIndex, height: line.bbox.height, cells: line.runs.map((run, columnIndex) => ({ rowIndex, columnIndex, bbox: run.bbox, content: [{ id: `${run.id}-paragraph`, bbox: run.bbox, alignment: "left", lines: [{ id: `${run.id}-line`, bbox: run.bbox, runs: [run] }] }], style: {} })) })) };
}

function groupLines(items: RawTextItem[], pageNumber: number): TextLine[] {
  const sorted = [...items].sort((left, right) => right.bbox.y - left.bbox.y || left.bbox.x - right.bbox.x);
  const lines: RawTextItem[][] = [];
  for (const item of sorted) {
    const current = lines[lines.length - 1];
    const tolerance = Math.max(2, item.fontSize * 0.35);
    if (current && Math.abs(current[0].bbox.y - item.bbox.y) <= tolerance) current.push(item);
    else lines.push([item]);
  }
  return lines.map((itemsInLine, index) => makeLine(itemsInLine, pageNumber, index));
}

function makeLine(items: RawTextItem[], pageNumber: number, index: number): TextLine {
  const direction = items.some((item) => item.direction === "rtl") ? "rtl" as const : undefined;
  const ordered = [...items].sort((left, right) => direction === "rtl" ? right.bbox.x - left.bbox.x : left.bbox.x - right.bbox.x);
  return { id: `page-${pageNumber}-line-${index}`, bbox: bounds(ordered.map((item) => item.bbox)), direction, runs: ordered.map((item) => ({ id: item.id, bbox: item.bbox, text: item.text, style: { originalFontName: item.fontName, fontSize: item.fontSize, bold: /bold/i.test(item.fontName), italic: /italic|oblique/i.test(item.fontName), color: item.color, rotation: item.rotation } })) };
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
