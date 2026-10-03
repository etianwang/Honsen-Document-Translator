export type SourceType = "pdf" | "word" | "presentation" | "spreadsheet" | "text";

export interface SourceTypeDefinition {
  id: SourceType;
  label: string;
  importLabel: string;
  extensions: string[];
  outputExtension: string;
  pdfOnly?: boolean;
}

export const sourceTypes: SourceTypeDefinition[] = [
  { id: "pdf", label: "PDF", importLabel: "导入 PDF", extensions: ["pdf"], outputExtension: "pdf", pdfOnly: true },
  { id: "word", label: "Word", importLabel: "导入 Word", extensions: ["doc", "docx"], outputExtension: "docx" },
  { id: "presentation", label: "演示文稿", importLabel: "导入 PPT", extensions: ["ppt", "pptx"], outputExtension: "pptx" },
  { id: "spreadsheet", label: "Excel", importLabel: "导入 Excel", extensions: ["xls", "xlsx"], outputExtension: "xlsx" },
  { id: "text", label: "文本 / MD", importLabel: "导入文本", extensions: ["txt", "md", "markdown"], outputExtension: "txt" },
];

export function sourceTypeForFile(path: string): SourceTypeDefinition | undefined {
  const extension = path.split(".").pop()?.toLowerCase();
  return sourceTypes.find((type) => extension !== undefined && type.extensions.includes(extension));
}

export function acceptsSourceFile(path: string, type: SourceType): boolean {
  return sourceTypeForFile(path)?.id === type;
}

export function exportFileName(path: string | undefined, targetLanguage: string, type: SourceTypeDefinition): string {
  const base = path?.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") || "translated";
  const extension = type.id === "text" && /\.md(?:own)?$/i.test(path ?? "") ? "md" : type.outputExtension;
  return `${targetLanguage.toLowerCase()}_${base}.${extension}`;
}
