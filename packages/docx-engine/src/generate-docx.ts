import { Packer } from "docx";
import { writeFile } from "node:fs/promises";
import type { DocumentModel } from "@pdf-translator/document-model";
import { buildDocx } from "./build-docx";

export async function generateDocx(model: DocumentModel, outputPath: string): Promise<void> {
  await writeFile(outputPath, await Packer.toBuffer(buildDocx(model)));
}
