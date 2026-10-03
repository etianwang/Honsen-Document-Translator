import { PDFDocument, rgb } from "pdf-lib";

const SCALE = 0.96;

export async function addDocumentPdfPadding(bytes: Uint8Array): Promise<Uint8Array> {
  const source = await PDFDocument.load(bytes);
  const output = await PDFDocument.create();
  const pages = await output.embedPdf(source, source.getPageIndices());
  pages.forEach((embedded, index) => {
    const { width, height } = source.getPage(index).getSize();
    const insetX = width * (1 - SCALE) / 2;
    const insetY = height * (1 - SCALE) / 2;
    const page = output.addPage([width, height]);
    page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(1, 1, 1) });
    page.drawPage(embedded, { x: insetX, y: insetY, width: width * SCALE, height: height * SCALE });
  });
  return output.save();
}
