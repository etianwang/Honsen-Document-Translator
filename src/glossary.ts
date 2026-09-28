import { mapTextRuns, type DocumentModel } from "@pdf-translator/document-model";

export interface GlossaryEntry { source: string; target: string; }

export function parseGlossaryYaml(yaml: string): GlossaryEntry[] {
  const entries: GlossaryEntry[] = [];
  for (const rawLine of yaml.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.endsWith(":")) continue;
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const source = unquote(line.slice(0, separator).trim());
    const target = unquote(line.slice(separator + 1).trim());
    if (source && target) entries.push({ source, target });
  }
  if (entries.length === 0) throw new Error("术语表中没有可用条目。请使用“原文: 译文”的 YAML 格式。");
  return entries;
}

export function applyGlossary(model: DocumentModel, entries: GlossaryEntry[]): DocumentModel {
  if (entries.length === 0) return model;
  const terms = new Map(entries.map((entry) => [entry.source.trim(), entry.target.trim()]));
  return mapTextRuns(model, (run) => ({ ...run, translatedText: terms.get(run.text.trim()) ?? run.translatedText }));
}

function unquote(value: string): string { return value.replace(/^['"]|['"]$/g, ""); }
