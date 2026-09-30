import { Document, Packer, Paragraph, TextRun } from "docx";
import { writeFile } from "node:fs/promises";
import process from "node:process";

const output = process.argv[2];
if (!output) throw new Error("Expected DOCX output path.");
const document = new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun("Honsen export verification")] })] }] });
await writeFile(output, await Packer.toBuffer(document));
