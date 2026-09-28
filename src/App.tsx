import { useEffect, useMemo, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Packer } from "docx";
import { buildDocx, validateDocx } from "@pdf-translator/docx-engine";
import type { DocumentModel, DocumentPage, ParagraphModel, ProcessingStage } from "@pdf-translator/document-model";
import { translateDocument } from "@pdf-translator/translation-engine";
import { DocumentPipeline } from "@pdf-translator/document-pipeline";
import { configurePdfWorker, renderPdfPage } from "@pdf-translator/pdf-parser";
import pdfWorkerUrl from "../packages/pdf-parser/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import { TauriDeepLTranslator } from "./tauri-deepl-translator";
import { TauriOcrProvider } from "./tauri-ocr-provider";
import { applyGlossary, type GlossaryEntry, parseGlossaryYaml } from "./glossary";
import { canExport, canTranslate, isWorkflowBusy, recoverAfterCancel, restoreSourceReview, type WorkflowPhase } from "./workflow-state";
import "./App.css";

configurePdfWorker(pdfWorkerUrl);

interface DeepLKeyStatus { configured: boolean; source?: string; }
const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const progressMessage = (stage: ProcessingStage, completed: number, total: number): string => {
  const pageLabel = total ? `第 ${completed}/${total} 页` : "准备中";
  if (stage === "analyzing") return `正在分析 PDF：${pageLabel}`;
  if (stage === "ocr") return `正在 OCR：${pageLabel}`;
  if (stage === "layout") return `正在重建版式：${pageLabel}`;
  if (stage === "translating") return "正在通过 DeepL 翻译…";
  return `${stage} document…`;
};
async function pickDomPdf(): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "application/pdf";
    input.onchange = () => resolve(input.files?.[0]); input.click();
  });
}

function App() {
  const [model, setModel] = useState<DocumentModel>();
  const [name, setName] = useState<string>();
  const [stage, setStage] = useState<ProcessingStage>("idle");
  const [phase, setPhase] = useState<WorkflowPhase>("empty");
  const isBusy = (stage: ProcessingStage): boolean => { void stage; return isWorkflowBusy(phase); };
  const [message, setMessage] = useState("No document loaded.");
  const [progress, setProgress] = useState(0);
  const [originalUrl, setOriginalUrl] = useState<string>();
  const [sourceBytes, setSourceBytes] = useState<Uint8Array>();
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [targetLanguage, setTargetLanguage] = useState("ZH");
  const [sourceLanguage, setSourceLanguage] = useState("AUTO");
  const [ocrEnabled, setOcrEnabled] = useState(true);
  const [apiKey, setApiKey] = useState("");
  const [rememberKey, setRememberKey] = useState(true);
  const [showApiKey, setShowApiKey] = useState(false);
  const [keyStatus, setKeyStatus] = useState<DeepLKeyStatus>({ configured: false });
  const [glossaryName, setGlossaryName] = useState<string>();
  const [glossaryEntries, setGlossaryEntries] = useState<GlossaryEntry[]>([]);
  const activeAbortController = useRef<AbortController | undefined>(undefined);

  useEffect(() => { if (isTauri) void invoke<DeepLKeyStatus>("deepl_key_status").then(setKeyStatus).catch(() => setKeyStatus({ configured: false })); }, []);
  useEffect(() => { setPhase((current) => restoreSourceReview(current, Boolean(model) && stage === "completed")); }, [model, stage]);

  async function selectPdf(): Promise<void> {
    const browserFile = isTauri ? undefined : await pickDomPdf();
    const path = isTauri ? await open({ multiple: false, filters: [{ name: "PDF", extensions: ["pdf"] }] }) : browserFile?.name;
    if (typeof path !== "string") return;
    const controller = new AbortController(); activeAbortController.current = controller; setPhase("importing");
    try {
      setStage("analyzing"); setProgress(0); setMessage("正在分析 PDF：准备中");
      const bytes = browserFile ? new Uint8Array(await browserFile.arrayBuffer()) : await readFile(path);
      const previewBytes = bytes.slice();
      const result = await new DocumentPipeline().process(bytes, path, { ocrEnabled: isTauri && ocrEnabled, ocrProvider: isTauri && ocrEnabled ? new TauriOcrProvider() : undefined, ocrLanguage: sourceLanguage === "AUTO" ? undefined : sourceLanguage, signal: controller.signal, onProgress: (pipelineStage, completed, total) => { setStage(pipelineStage); setMessage(progressMessage(pipelineStage, completed, total)); } });
      const reconstructed = result.document;
      const pages = reconstructed.pages;
      setModel(reconstructed);
      setSourceBytes(previewBytes);
      if (!isTauri && originalUrl) URL.revokeObjectURL(originalUrl);
      setOriginalUrl(isTauri ? convertFileSrc(path) : URL.createObjectURL(new Blob([previewBytes], { type: "application/pdf" })));
      setPageNumber(1); setZoom(1);
      setName(path.split(/[\\/]/).pop()); setStage("completed"); setPhase("review-source"); setProgress(0);
      setMessage(`已导入 ${pages.length} 页，请确认原文后点击开始翻译。`);
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") { setStage("idle"); setPhase("empty"); setMessage("已取消导入和 OCR。"); }
      else { setStage("failed"); setPhase("empty"); setMessage(error instanceof Error ? error.message : "PDF parsing failed."); }
    } finally { activeAbortController.current = undefined; }
  }

  async function exportDocx(): Promise<void> {
    if (!isTauri) { setMessage("DOM 调试仅支持 PDF 解析预览，请在桌面应用中导出。"); return; }
    if (!model || !canExport(phase)) { setMessage("请先完成翻译并确认译文后再导出 DOCX。"); return; }
    const path = await save({ defaultPath: `${name?.replace(/\.pdf$/i, "") ?? "translated"}.docx`, filters: [{ name: "Word document", extensions: ["docx"] }] });
    if (!path) return;
    try {
      setStage("generating-docx"); setPhase("exporting-docx"); setMessage("Generating editable DOCX...");
      await writeFile(path, await docxBytes());
      setStage("completed"); setPhase("review-translation"); setMessage("DOCX exported.");
    } catch (error: unknown) {
      setStage("failed"); setPhase("review-translation"); setMessage(error instanceof Error ? error.message : "DOCX generation failed.");
    }
  }

  async function translate(): Promise<void> {
    if (!isTauri) { setMessage("DOM 调试仅支持 PDF 解析预览，请在桌面应用中翻译。"); return; }
    if (!model || !canTranslate(phase)) { setMessage("请先导入并确认原文后再开始翻译。"); return; }
    const controller = new AbortController(); activeAbortController.current = controller;
    try {
      if (apiKey.trim() && rememberKey) setKeyStatus(await invoke<DeepLKeyStatus>("save_deepl_api_key", { request: { apiKey, remember: true } }));
      if (!apiKey.trim() && !keyStatus.configured) throw new Error("请先填写 DeepL API Key。");
      setStage("translating"); setPhase("translating"); setProgress(0); setMessage("正在使用 DeepL 翻译：准备中");
      setModel(applyGlossary(await translateDocument(model, new TauriDeepLTranslator(apiKey.trim() || undefined, undefined, toDeepLSourceLanguage(sourceLanguage)), targetLanguage, { signal: controller.signal, onProgress: (completed, total) => { setProgress(total ? Math.round(completed / total * 100) : 100); setMessage(total ? `正在使用 DeepL 翻译：${completed}/${total} 段` : "正在使用 DeepL 翻译：无文本段"); } }), glossaryEntries));
      setStage("completed"); setPhase("review-translation"); setMessage("DeepL translation completed.");
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") { setStage("idle"); setPhase(recoverAfterCancel("translating")); setMessage("已取消翻译。"); }
      else { setStage("failed"); setPhase("review-source"); setMessage(error instanceof Error ? error.message : "Translation failed."); }
    } finally { activeAbortController.current = undefined; }
  }

  async function chooseGlossary(): Promise<void> {
    if (!isTauri) { setMessage("DOM 调试不支持读取本地术语表。"); return; }
    const path = await open({ multiple: false, filters: [{ name: "YAML glossary", extensions: ["yaml", "yml"] }] });
    if (typeof path !== "string") return;
    try {
      const entries = parseGlossaryYaml(new TextDecoder().decode(await readFile(path)));
      setGlossaryEntries(entries); setGlossaryName(path.split(/[\\/]/).pop()); setMessage(`已加载 ${entries.length} 条术语。`);
    } catch (error: unknown) { setMessage(error instanceof Error ? error.message : "术语表读取失败。"); }
  }

  async function saveKey(): Promise<void> {
    if (!isTauri) return;
    if (!apiKey.trim() || !rememberKey) return;
    try { setKeyStatus(await invoke<DeepLKeyStatus>("save_deepl_api_key", { request: { apiKey, remember: true } })); setMessage("DeepL API Key 已保存到安全存储。"); }
    catch (error: unknown) { setMessage(error instanceof Error ? error.message : "保存 API Key 失败。"); }
  }

  async function exportPdf(): Promise<void> {
    if (!isTauri) { setMessage("DOM 调试仅支持 PDF 解析预览，请在桌面应用中导出。"); return; }
    if (!model || !canExport(phase)) { setMessage("请先完成翻译并确认译文后再导出 PDF。"); return; }
    const path = await save({ defaultPath: `${name?.replace(/\.pdf$/i, "") ?? "translated"}.pdf`, filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (!path) return;
    try {
      setStage("generating-pdf"); setPhase("exporting-pdf"); setMessage("Generating PDF...");
      await invoke("export_docx_to_pdf", { docxBytes: Array.from(await docxBytes()), outputPath: path });
      setStage("completed"); setPhase("review-translation"); setMessage("PDF exported.");
    } catch (error: unknown) {
      setStage("failed"); setPhase("review-translation"); setMessage(error instanceof Error ? error.message : "PDF export failed.");
    }
  }

  async function docxBytes(): Promise<Uint8Array> {
    const blob = await Packer.toBlob(buildDocx(model!));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await validateDocx(bytes);
    return bytes;
  }

  const currentPage = model?.pages[pageNumber - 1];
  const isRtlPage = currentPage?.blocks.some((block) => block.type === "text" && block.paragraphs.some((paragraph) => paragraph.direction === "rtl")) ?? false;
  function commitLine(lineId: string, translatedText: string): void {
    setModel((current) => {
      if (!current) return current;
      return {
        ...current,
        pages: current.pages.map((page) => ({
          ...page,
          blocks: page.blocks.map((block) => block.type === "text"
            ? { ...block, paragraphs: updateLines(block.paragraphs, lineId, translatedText) }
            : block.type === "table"
              ? { ...block, rows: block.rows.map((row) => ({ ...row, cells: row.cells.map((cell) => ({ ...cell, content: updateLines(cell.content, lineId, translatedText) })) })) }
              : block),
        })),
      };
    });
    setMessage("译文修改已应用，将随导出一并保存。");
  }
  const previewTerms = useMemo(() => glossaryEntries.slice(0, 3), [glossaryEntries]);
  const totalPages = model?.pages.length ?? 0;
  const issues = model?.issues ?? [];
  return <main className="app-shell">
    <header className="app-header" data-tauri-drag-region><div className="brand" data-tauri-drag-region><span className="pdf-mark" aria-hidden="true">PDF</span><h1>Honsen PDF Translator</h1></div><span className="brand-note" data-tauri-drag-region>让 AI 帮助你，打破语言的边界</span><WindowControls /></header>
    <section className="toolbar-card" aria-label="翻译设置"><button className="button primary" type="button" onClick={selectPdf} disabled={isBusy(stage)}>＋ 导入 PDF</button><label>原文语言<select value={sourceLanguage} onChange={(event) => setSourceLanguage(event.currentTarget.value)} disabled={isBusy(stage)}><option value="AUTO">自动检测</option><option value="ZH">中文（简体）</option><option value="ZT">中文（繁体）</option><option value="EN">英语</option><option value="FR">法语</option><option value="ES">西班牙语</option><option value="DE">德语</option><option value="PT">葡萄牙语</option><option value="NL">荷兰语</option><option value="TR">土耳其语</option><option value="PL">波兰语</option><option value="NO">挪威语</option><option value="SV">瑞典语</option><option value="FI">芬兰语</option><option value="JA">日语</option><option value="KO">韩语</option><option value="RU">俄语</option><option value="UK">乌克兰语</option><option value="HU">匈牙利语</option><option value="KK">哈萨克语</option><option value="AR">阿拉伯语</option><option value="FA">波斯语</option></select></label><label>目标语言<select value={targetLanguage} onChange={(event) => setTargetLanguage(event.currentTarget.value)} disabled={isBusy(stage)}><option value="ZH">中文</option><option value="EN">英语</option><option value="FR">法语</option><option value="DE">德语</option><option value="JA">日语</option><option value="ES">西班牙语</option></select></label><label className="key-field">DeepL API Key<input type={showApiKey ? "text" : "password"} value={apiKey} onChange={(event) => setApiKey(event.currentTarget.value)} onBlur={() => void saveKey()} autoComplete="off" placeholder={keyStatus.configured ? "已配置" : "粘贴你的 API Key"} /><button className="icon-button" type="button" aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"} onClick={() => setShowApiKey((value) => !value)}>{showApiKey ? "◉" : "◌"}</button></label><div className="key-memory"><label className="check-field"><input type="checkbox" checked={rememberKey} onChange={(event) => { const remember = event.currentTarget.checked; setRememberKey(remember); if (!remember) void invoke("save_deepl_api_key", { request: { apiKey: "", remember: false } }).then(() => invoke<DeepLKeyStatus>("deepl_key_status")).then(setKeyStatus); }} />记住此密钥</label><span className={`key-state ${keyStatus.configured ? "ready" : ""}`}>{keyStatus.configured ? `● 已保存到安全存储${keyStatus.source ? `（${keyStatus.source}）` : ""}` : "○ 未保存"}</span></div><label className="switch-field"><input type="checkbox" checked={ocrEnabled} onChange={(event) => setOcrEnabled(event.currentTarget.checked)} /><span aria-hidden="true" />OCR 增强</label><label>页面范围<select disabled={isBusy(stage)}><option>全部页面</option></select></label><button className="button primary" type="button" onClick={translate} disabled={!model || isBusy(stage)}>▶ 开始翻译</button>{activeAbortController.current && <button className="button secondary" type="button" onClick={() => activeAbortController.current?.abort()}>取消当前任务</button>}</section>
    <section className="progress-card" aria-live="polite"><strong>翻译进度</strong><div className="progress-track" aria-label={`翻译进度 ${progress}%`}><span style={{ width: `${progress}%` }} /></div><span>{progress}%</span><span>{message}</span></section>
    {issues.length > 0 && <section className="issue-card" aria-label="文档问题" role="alert"><strong>文档问题（{issues.length}）</strong><ul>{issues.map((issue) => <li key={`${issue.code}-${issue.pageNumber ?? 0}`}>{issue.message}</li>)}</ul></section>}
    <section className="workspace" aria-label="PDF 翻译工作区">
      <article className="document-card">
        <div className="card-title"><h2>▧ 原始 PDF</h2><PageControls page={pageNumber} total={totalPages} zoom={zoom} onPage={setPageNumber} onZoom={setZoom} /></div>
        {originalUrl ? <object className="pdf-viewer" data={`${originalUrl}#page=${pageNumber}`} type="application/pdf" aria-label={`原始 PDF 第 ${pageNumber} 页`} style={{ zoom }} /> : <EmptyPreview text="导入 PDF 后在这里查看原文" />}
      </article>
      <article className="document-card">
        <div className="card-title"><h2>▧ 译文（保留原页版式）</h2><PageControls page={pageNumber} total={totalPages} zoom={zoom} onPage={setPageNumber} onZoom={setZoom} /></div>
        <div className={`translation-editor${isRtlPage ? " rtl" : ""}`} style={{ zoom }}>
          {phase === "review-translation" && currentPage ? <TranslatedPagePreview sourceBytes={sourceBytes} page={currentPage} onLineChange={commitLine} /> : <EmptyPreview text="确认原文后点击开始翻译；图片、签名和印章将保留在译文预览中。" />}
        </div>
      </article>
      <aside className="glossary-card">
        <div className="card-title"><h2>▤ 术语表</h2></div>
        <p>使用 YAML 文件保持术语翻译一致。</p>
        <div className="glossary-file"><strong>{glossaryName ?? "尚未选择 YAML 文件"}</strong><span>{glossaryEntries.length ? `● 已加载 ${glossaryEntries.length} 条术语` : "选择 .yaml 或 .yml 文件"}</span><button className="button secondary" type="button" onClick={chooseGlossary}>选择 / 更换文件</button>{glossaryName && <button className="text-button" type="button" onClick={() => { setGlossaryName(undefined); setGlossaryEntries([]); }}>清除</button>}</div>
        {previewTerms.length > 0 && <ol className="yaml-preview">{previewTerms.map((entry) => <li key={entry.source}><code>{entry.source}: <b>{entry.target}</b></code></li>)}</ol>}
        <div className="tip"><strong>💡 提示</strong><span>术语表会在翻译时优先应用，提升全篇一致性。</span></div>
        <div className="exports"><button className="button secondary" type="button" onClick={exportDocx} disabled={!model || isBusy(stage)}>导出 DOCX</button><button className="button secondary" type="button" onClick={exportPdf} disabled={!model || isBusy(stage)}>导出 PDF</button></div>
      </aside>
    </section>
  </main>;
}

function EmptyPreview({ text }: { text: string }) { return <div className="empty-preview"><span>▧</span><p>{text}</p></div>; }

function updateLines(paragraphs: ParagraphModel[], lineId: string, translatedText: string): ParagraphModel[] {
  return paragraphs.map((paragraph) => ({ ...paragraph, lines: paragraph.lines.map((line) => line.id !== lineId ? line : ({ ...line, runs: line.runs.map((run, index) => ({ ...run, translatedText: index ? "" : translatedText })) })) }));
}

function TranslatedPagePreview({ sourceBytes, page, onLineChange }: { sourceBytes?: Uint8Array; page: DocumentPage; onLineChange: (lineId: string, translatedText: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [renderError, setRenderError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!sourceBytes) return;
    let cancelled = false;
    void (async () => {
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      await renderPdfPage(sourceBytes.slice(), page.number, canvas, () => cancelled);
    })().catch((error: unknown) => { if (!cancelled) { console.error("PDF preview failed", error); setRenderError(true); } });
    return () => { cancelled = true; };
  }, [attempt, page.number, sourceBytes]);
  if (!sourceBytes) return <EmptyPreview text="无法读取原始 PDF。" />;
  if (renderError) return <div className="preview-retry"><EmptyPreview text="原页背景暂时无法渲染。" /><button className="button secondary" type="button" onClick={() => { setRenderError(false); setAttempt((value) => value + 1); }}>重试预览</button></div>;
  const lines = page.blocks.flatMap((block) => block.type === "text" ? block.paragraphs.flatMap((paragraph) => paragraph.lines) : block.type === "table" ? block.rows.flatMap((row) => row.cells).flatMap((cell) => cell.content).flatMap((paragraph) => paragraph.lines) : []);
  return <div className="translated-page" style={{ aspectRatio: `${page.width} / ${page.height}` }} aria-label={`第 ${page.number} 页译文，保留原始图片与版式`}>
    <canvas ref={canvasRef} aria-hidden="true" />
    {lines.map((line) => {
      const original = line.runs.map((run) => run.text).join("");
      const translated = line.runs.map((run) => run.translatedText ?? "").join("");
      const scale = Math.sqrt(Math.min(1, original.length / Math.max(original.length, translated.length)));
      const units = [...translated].reduce((total, character) => total + (character.charCodeAt(0) > 255 ? 1 : 0.55), 0.55);
      const fontSize = Math.min(line.bbox.height / page.width * 100 * scale, Math.max(0.6, (line.bbox.width / page.width * 100 - 0.25) / units));
      return <textarea key={line.id} className="translated-line" aria-label={`编辑第 ${page.number} 页译文`} dir={line.direction === "rtl" ? "rtl" : "ltr"} wrap="off" defaultValue={translated} onBlur={(event) => onLineChange(line.id, event.currentTarget.value)} style={{ left: `${line.bbox.x / page.width * 100}%`, top: `${(page.height - line.bbox.y - line.bbox.height) / page.height * 100}%`, width: `${line.bbox.width / page.width * 100}%`, minHeight: `${line.bbox.height / page.height * 100}%`, fontSize: `${fontSize}cqw` }} />;
    })}
  </div>;
}

function WindowControls() {
  return <div className="window-controls" aria-label="窗口控制"><button type="button" className="window-control minimize" aria-label="最小化窗口" onClick={() => void getCurrentWindow().minimize()}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10" /></svg></button><button type="button" className="window-control close" aria-label="关闭窗口" onClick={() => void getCurrentWindow().close()}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8" /></svg></button></div>;
}

function toDeepLSourceLanguage(language: string): string | undefined { return ({ ZH: "ZH", ZT: "ZH", EN: "EN", FR: "FR", ES: "ES", DE: "DE", PT: "PT", NL: "NL", TR: "TR", PL: "PL", NO: "NO", SV: "SV", FI: "FI", JA: "JA", KO: "KO", RU: "RU", UK: "UK", HU: "HU", AR: "AR" } as Record<string, string>)[language]; }

function PageControls({ page, total, zoom, onPage, onZoom }: { page: number; total: number; zoom: number; onPage: (value: number | ((previous: number) => number)) => void; onZoom: (value: (previous: number) => number) => void }) { return <div className="page-controls"><button type="button" aria-label="上一页" onClick={() => onPage((value) => Math.max(1, value - 1))} disabled={page <= 1}>‹</button><span>{total ? `${page} / ${total}` : "— / —"}</span><button type="button" aria-label="下一页" onClick={() => onPage((value) => Math.min(total, value + 1))} disabled={!total || page >= total}>›</button><button type="button" aria-label="缩小" onClick={() => onZoom((value) => Math.max(0.75, value - 0.25))}>−</button><span>{Math.round(zoom * 100)}%</span><button type="button" aria-label="放大" onClick={() => onZoom((value) => Math.min(2, value + 0.25))}>＋</button></div>; }

export default App;
