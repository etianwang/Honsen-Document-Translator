export interface CodeSegment { id: string; start: number; end: number; text: string; }
export interface CodeToken { kind: "plain" | "comment" | "string" | "keyword"; text: string; }
export interface CodeValidation { valid: boolean; message: string; }

const htmlExtensions = new Set(["html", "htm", "xml", "svg", "vue", "svelte", "jsx", "tsx", "resx", "xlf", "xliff"]);
const keyValueExtensions = new Set(["properties", "yaml", "yml", "toml"]);
const hashCommentExtensions = new Set(["py", "sh", "bash", "zsh", "ps1", "yaml", "yml", "toml"]);
const keywords = /\b(?:abstract|as|async|await|break|case|catch|class|const|continue|def|do|else|enum|export|extends|final|finally|for|foreach|from|function|fun|if|implements|import|in|interface|let|match|namespace|new|null|package|private|protected|public|return|static|struct|switch|this|throw|try|type|use|val|var|void|while|with|yield)\b/g;

export function codeLanguageForPath(path: string): string | undefined {
  const extension = path.split(".").pop()?.toLowerCase();
  return extension && supportedCodeExtensions.includes(extension) ? extension : undefined;
}

export const supportedCodeExtensions = ["html", "htm", "xml", "svg", "css", "scss", "less", "js", "jsx", "ts", "tsx", "vue", "svelte", "php", "py", "java", "cs", "go", "rs", "c", "h", "cpp", "cc", "hpp", "kt", "swift", "dart", "sql", "sh", "bash", "zsh", "ps1", "json", "yaml", "yml", "toml", "properties", "resx", "po", "pot", "xlf", "xliff"];

export function extractCodeSegments(source: string, extension: string): CodeSegment[] {
  const ranges: Array<{ start: number; end: number }> = [];
  const add = (start: number, end: number, force = false) => {
    const text = source.slice(start, end);
    if (end > start && (force ? hasLetters(text) : looksLikeText(text))) ranges.push({ start, end });
  };
  const isHtml = htmlExtensions.has(extension);
  for (let index = 0; index < source.length;) {
    if (source.startsWith("<!--", index)) {
      const end = source.indexOf("-->", index + 4); const close = end < 0 ? source.length : end;
      add(index + 4, close, true); index = end < 0 ? source.length : end + 3; continue;
    }
    if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2); const close = end < 0 ? source.length : end;
      add(index + 2, close, true); index = end < 0 ? source.length : end + 2; continue;
    }
    if (source.startsWith("//", index)) {
      const end = source.indexOf("\n", index + 2); const close = end < 0 ? source.length : end;
      add(index + 2, close, true); index = close; continue;
    }
    if ((hashCommentExtensions.has(extension) || extension === "properties") && (source[index] === "#" || (extension === "properties" && source[index] === "!")) && (index === 0 || /\s/.test(source[index - 1]))) {
      const end = source.indexOf("\n", index + 1); const close = end < 0 ? source.length : end;
      add(index + 1, close, true); index = close; continue;
    }
    const quote = source[index];
    if (quote === "'" || quote === '"') {
      const triple = extension === "py" && source.slice(index, index + 3) === quote.repeat(3);
      const start = index + (triple ? 3 : 1); const close = findQuotedEnd(source, start, quote, triple ? 3 : 1);
      add(start, close); index = Math.min(source.length, close + (triple ? 3 : 1)); continue;
    }
    if (quote === "`") {
      const end = findQuotedEnd(source, index + 1, "`", 1);
      addTemplateParts(source, index + 1, end, add); index = Math.min(source.length, end + 1); continue;
    }
    index += 1;
  }
  if (isHtml) addHtmlTextAndAttributes(source, add);
  if (extension === "php") addPhpMarkupText(source, add);
  if (keyValueExtensions.has(extension)) addKeyValueText(source, add);
  return ranges.sort((left, right) => left.start - right.start || left.end - right.end).reduce<Array<{ start: number; end: number }>>((unique, range) => {
    if (!unique.some((current) => range.start < current.end && current.start < range.end)) unique.push(range);
    return unique;
  }, []).map((range, index) => ({ id: `code-${index}`, ...range, text: source.slice(range.start, range.end) }));
}

export function applyCodeTranslations(source: string, segments: CodeSegment[], translations: Map<string, string>): string {
  return [...segments].sort((left, right) => right.start - left.start).reduce((result, segment) => {
    const translated = translations.get(segment.id);
    return translated === undefined ? result : result.slice(0, segment.start) + translated + result.slice(segment.end);
  }, source);
}

export function tokenizeCode(source: string): CodeToken[] {
  const tokens: CodeToken[] = []; let cursor = 0;
  const syntax = /<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*|`(?:\\.|[^`])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g;
  const pushPlain = (text: string) => {
    let offset = 0; keywords.lastIndex = 0;
    for (let match = keywords.exec(text); match; match = keywords.exec(text)) {
      if (match.index > offset) tokens.push({ kind: "plain", text: text.slice(offset, match.index) });
      tokens.push({ kind: "keyword", text: match[0] }); offset = match.index + match[0].length;
    }
    if (offset < text.length) tokens.push({ kind: "plain", text: text.slice(offset) });
  };
  for (let match = syntax.exec(source); match; match = syntax.exec(source)) {
    if (match.index > cursor) pushPlain(source.slice(cursor, match.index));
    tokens.push({ kind: /^(?:<!--|\/\*|\/\/|#)/.test(match[0]) ? "comment" : "string", text: match[0] }); cursor = match.index + match[0].length;
  }
  if (cursor < source.length) pushPlain(source.slice(cursor));
  return tokens;
}

export function validateCodeText(source: string, extension: string): CodeValidation {
  if (extension === "json") {
    try { JSON.parse(source); return { valid: true, message: "JSON 语法校验通过。" }; }
    catch (error) { return { valid: false, message: `JSON 语法错误：${error instanceof Error ? error.message : "无法解析"}` }; }
  }
  // ponytail: lexical validation catches structural damage without bundling a compiler per language; add language AST adapters only when a format needs semantic validation.
  const plain = tokenizeCode(source).map((token) => token.kind === "plain" || token.kind === "keyword" ? token.text : " ".repeat(token.text.length)).join("");
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" }; const stack: Array<{ character: string; index: number }> = [];
  for (let index = 0; index < plain.length; index += 1) {
    const character = plain[index];
    if (character === "(" || character === "[" || character === "{") stack.push({ character, index });
    else if (character in pairs && stack.pop()?.character !== pairs[character]) return { valid: false, message: `结构符号不匹配：第 ${index + 1} 个字符附近。` };
  }
  if (stack.length) return { valid: false, message: `结构符号未闭合：第 ${stack[stack.length - 1].index + 1} 个字符附近。` };
  return { valid: true, message: extension === "py" ? "结构校验通过，正在等待 Python 语法与缩进校验。" : "结构语法校验通过。" };
}

function findQuotedEnd(source: string, start: number, quote: string, quoteLength: number): number {
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "\\") { index += 1; continue; }
    if (source.slice(index, index + quoteLength) === quote.repeat(quoteLength)) return index;
  }
  return source.length;
}

function addTemplateParts(source: string, start: number, end: number, add: (start: number, end: number, force?: boolean) => void): void {
  let cursor = start;
  while (cursor < end) {
    const expression = source.indexOf("${", cursor);
    if (expression < 0 || expression >= end) { add(cursor, end); return; }
    add(cursor, expression); const close = findTemplateExpressionEnd(source, expression + 2, end);
    cursor = close + 1;
  }
}

function findTemplateExpressionEnd(source: string, start: number, end: number): number {
  let depth = 1;
  for (let index = start; index < end; index += 1) {
    if (source[index] === "'" || source[index] === '"' || source[index] === "`") {
      index = findQuotedEnd(source, index + 1, source[index], 1); continue;
    }
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && --depth === 0) return index;
  }
  return end;
}

function addHtmlTextAndAttributes(source: string, add: (start: number, end: number, force?: boolean) => void): void {
  const tag = /<[^>]*>/g; let previousEnd = 0; let insideCode = false; let seenTag = false;
  for (let match = tag.exec(source); match; match = tag.exec(source)) {
    if (seenTag && !insideCode) addMarkupText(source, previousEnd, match.index, add);
    const value = match[0];
    if (/^<\/?(?:script|style)\b/i.test(value)) insideCode = !/^<\//.test(value);
    const attributes = /\b(?:alt|title|placeholder|aria-label|aria-description|data-tooltip)\s*=\s*(["'])([\s\S]*?)\1/gi;
    for (let attribute = attributes.exec(value); attribute; attribute = attributes.exec(value)) {
      const textOffset = attribute.index + attribute[0].lastIndexOf(attribute[2]); add(match.index + textOffset, match.index + textOffset + attribute[2].length, true);
    }
    previousEnd = match.index + value.length; seenTag = true;
  }
  if (seenTag && !insideCode) addMarkupText(source, previousEnd, source.length, add);
}

function addMarkupText(source: string, start: number, end: number, add: (start: number, end: number, force?: boolean) => void): void {
  let cursor = start;
  while (cursor < end) {
    const expression = source.indexOf("{", cursor);
    if (expression < 0 || expression >= end) { add(cursor, end, true); return; }
    add(cursor, expression, true); cursor = findTemplateExpressionEnd(source, expression + 1, end) + 1;
  }
}

function addKeyValueText(source: string, add: (start: number, end: number, force?: boolean) => void): void {
  const lines = /^\s*[^#\r\n:=][^\r\n:=]*?\s*[:=]\s*([^#\r\n]+?)(?:\s+#.*)?$/gm;
  for (let match = lines.exec(source); match; match = lines.exec(source)) {
    const value = match[1]; const offset = match.index + match[0].indexOf(value);
    add(offset, offset + value.length);
  }
}

function addPhpMarkupText(source: string, add: (start: number, end: number, force?: boolean) => void): void {
  let cursor = 0; const php = /<\?(?:php|=)?[\s\S]*?\?>/gi;
  for (let match = php.exec(source); match; match = php.exec(source)) {
    addHtmlTextAndAttributes(source.slice(cursor, match.index), (start, end, force) => add(cursor + start, cursor + end, force));
    cursor = match.index + match[0].length;
  }
  addHtmlTextAndAttributes(source.slice(cursor), (start, end, force) => add(cursor + start, cursor + end, force));
}

function hasLetters(text: string): boolean { return /[\p{L}\p{Script=Han}]/u.test(text); }
function looksLikeText(text: string): boolean {
  const value = text.trim();
  if (!hasLetters(value) || /^(?:https?:\/\/|\/|\.\/|\.\.\/|[\w.-]+@[\w.-]+\.[a-z]{2,})/i.test(value)) return false;
  if (/^[A-Za-z_$][\w$]*(?:[./:\\-][\w$.-]+)*$/.test(value) && !/^[A-Z][a-z]+$/.test(value)) return false;
  return true;
}
