import type { DocumentModel } from "@pdf-translator/document-model";
import type { GlossaryEntry } from "./glossary";

export interface ProjectFile {
  version: 1;
  name?: string;
  document: DocumentModel;
  settings: { sourceLanguage: string; targetLanguage: string; ocrEnabled: boolean; glossaryName?: string; glossaryEntries: GlossaryEntry[] };
}

export function serializeProject(project: ProjectFile): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(project));
}

export function parseProject(bytes: Uint8Array): ProjectFile {
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!isProjectFile(value)) throw new Error("项目文件无效或版本不受支持。");
  return value;
}

function isProjectFile(value: unknown): value is ProjectFile {
  if (!value || typeof value !== "object") return false;
  const project = value as Partial<ProjectFile>;
  return project.version === 1 && typeof project.name !== "object" && !!project.document && Array.isArray(project.document.pages) && !!project.settings && typeof project.settings.sourceLanguage === "string" && typeof project.settings.targetLanguage === "string" && typeof project.settings.ocrEnabled === "boolean" && Array.isArray(project.settings.glossaryEntries);
}
