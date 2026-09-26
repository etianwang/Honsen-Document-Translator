import JSZip from "jszip";

const REQUIRED_PARTS = ["[Content_Types].xml", "_rels/.rels", "word/document.xml"];

export async function validateDocx(bytes: Uint8Array | ArrayBuffer): Promise<void> {
  let archive: JSZip;
  try {
    archive = await JSZip.loadAsync(bytes);
  } catch {
    throw new Error("DOCX_VALIDATION_FAILED: Export is not a readable OOXML package.");
  }
  const missing = REQUIRED_PARTS.filter((part) => archive.file(part) === null);
  if (missing.length > 0) throw new Error(`DOCX_VALIDATION_FAILED: Missing OOXML part(s): ${missing.join(", ")}.`);
  const [contentTypes, rootRelations, documentXml] = await Promise.all(REQUIRED_PARTS.map((part) => archive.file(part)?.async("text")));
  if (!contentTypes?.includes("application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml") || !rootRelations?.includes("word/document.xml") || !documentXml?.includes("<w:document")) {
    throw new Error("DOCX_VALIDATION_FAILED: OOXML package relationships are invalid.");
  }
}
