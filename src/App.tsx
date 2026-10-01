import { useEffect, useMemo, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Packer } from "docx";
import { buildDocx, validateDocx } from "@pdf-translator/docx-engine";
import type { DocumentModel, DocumentPage, ParagraphModel, ProcessingStage } from "@pdf-translator/document-model";
import { translateDocument } from "@pdf-translator/translation-engine";
import { DocumentPipeline } from "@pdf-translator/document-pipeline";
import { configurePdfWorker, renderCleanBackgroundPages, renderPdfPages } from "@pdf-translator/pdf-parser";
import { exportTranslatedPdf, translatedCellRegions, translatedPlacements } from "./pdf-overlay-export";
import pdfWorkerUrl from "../packages/pdf-parser/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import { TauriDeepLTranslator } from "./tauri-deepl-translator";
import { TauriOcrProvider } from "./tauri-ocr-provider";
import { applyGlossary, type GlossaryEntry, parseGlossaryYaml } from "./glossary";
import { diagnosticCode, userMessage } from "./user-message";
import { canExport, canTranslate, isWorkflowBusy, recoverAfterCancel, restoreSourceReview, type WorkflowPhase } from "./workflow-state";
import appLogo from "../logo.png";
import sponsorWechat from "./assets/sponsor-wechat.jpg";
import sponsorAlipay from "./assets/sponsor-alipay.jpg";
import "./App.css";

configurePdfWorker(pdfWorkerUrl);

interface DeepLKeyStatus { configured: boolean; source?: string; }
interface UpdateStatus { available: boolean; currentVersion: string; version?: string; releaseNotes?: string; }
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
  const [sourceBytes, setSourceBytes] = useState<Uint8Array>();
  const [ocrPages, setOcrPages] = useState<Set<number>>(new Set());
  const [zoom, setZoom] = useState(1);
  const [targetLanguage, setTargetLanguage] = useState("ZH");
  const [sourceLanguage, setSourceLanguage] = useState("AUTO");
  const [ocrEnabled, setOcrEnabled] = useState(true);
  const [apiKey, setApiKey] = useState("");
  const [rememberKey, setRememberKey] = useState(true);
  const [showApiKey, setShowApiKey] = useState(false);
  const [keyStatus, setKeyStatus] = useState<DeepLKeyStatus>({ configured: false });
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>();
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [sponsorOpen, setSponsorOpen] = useState(false);
  const [glossaryName, setGlossaryName] = useState<string>();
  const [glossaryEntries, setGlossaryEntries] = useState<GlossaryEntry[]>([]);
  const activeAbortController = useRef<AbortController | undefined>(undefined);

  useEffect(() => { if (isTauri) { void invoke<DeepLKeyStatus>("deepl_key_status").then(setKeyStatus).catch(() => setKeyStatus({ configured: false })); void checkForUpdate(true); } }, []);
  useEffect(() => { setPhase((current) => restoreSourceReview(current, Boolean(model) && stage === "completed")); }, [model, stage]);

  async function checkForUpdate(autoInstall = false): Promise<void> {
    if (!isTauri) { setMessage("请在桌面应用中检查更新。"); return; }
    setCheckingUpdate(true);
    try {
      const status = await invoke<UpdateStatus>("check_for_update");
      setUpdateStatus(status); setMessage(status.available ? `发现 v${status.version} 更新。` : `当前已是最新版本 v${status.currentVersion}。`); if (autoInstall && status.available) await installUpdate(status);
    } catch (error: unknown) { recordDiagnostic("update", error); setMessage(userMessage(error, "检查更新失败，请稍后重试。")); }
    finally { setCheckingUpdate(false); }
  }

  async function installUpdate(status = updateStatus): Promise<void> {
    if (!status?.available) return;
    setInstallingUpdate(true); setMessage(`正在下载 v${status.version} 并校验安装包…`);
    try { await invoke("install_update"); }
    catch (error: unknown) { recordDiagnostic("update", error); setInstallingUpdate(false); setMessage(userMessage(error, "更新安装失败，请稍后重试。")); }
  }

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
      setOcrPages(new Set(result.analysis.pageTypes.filter((page) => page.type === "scanned").map((page) => page.pageNumber)));
      setSourceBytes(previewBytes);
      setZoom(1);
      setName(path.split(/[\\/]/).pop()); setStage("completed"); setPhase("review-source"); setProgress(0);
      setMessage(`已导入 ${pages.length} 页，请确认原文后点击开始翻译。`);
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") { setStage("idle"); setPhase("empty"); setMessage("已取消导入和 OCR。"); }
      else { recordDiagnostic("import", error); setStage("failed"); setPhase("empty"); setMessage(userMessage(error, "PDF 导入失败，请尝试其他文件。")); }
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
      recordDiagnostic("docx-export", error); setStage("failed"); setPhase("review-translation"); setMessage(userMessage(error, "DOCX 导出失败，请重试。"));
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
      else { recordDiagnostic("translation", error); setStage("failed"); setPhase("review-source"); setMessage(userMessage(error, "翻译失败，请稍后重试。")); }
    } finally { activeAbortController.current = undefined; }
  }

  async function chooseGlossary(): Promise<void> {
    if (!isTauri) { setMessage("DOM 调试不支持读取本地术语表。"); return; }
    const path = await open({ multiple: false, filters: [{ name: "YAML glossary", extensions: ["yaml", "yml"] }] });
    if (typeof path !== "string") return;
    try {
      const entries = parseGlossaryYaml(new TextDecoder().decode(await readFile(path)));
      setGlossaryEntries(entries); setGlossaryName(path.split(/[\\/]/).pop()); setMessage(`已加载 ${entries.length} 条术语。`);
    } catch (error: unknown) { recordDiagnostic("glossary", error); setMessage(userMessage(error, "术语表读取失败。")); }
  }

  async function saveKey(): Promise<void> {
    if (!isTauri) return;
    if (!apiKey.trim() || !rememberKey) return;
    try { setKeyStatus(await invoke<DeepLKeyStatus>("save_deepl_api_key", { request: { apiKey, remember: true } })); setMessage("DeepL API Key 已保存到安全存储。"); }
    catch (error: unknown) { recordDiagnostic("credential", error); setMessage(userMessage(error, "保存 API Key 失败。")); }
  }

  async function exportPdf(): Promise<void> {
    if (!isTauri) { setMessage("DOM 调试仅支持 PDF 解析预览，请在桌面应用中导出。"); return; }
    if (!model || !canExport(phase)) { setMessage("请先完成翻译并确认译文后再导出 PDF。"); return; }
    const path = await save({ defaultPath: `${name?.replace(/\.pdf$/i, "") ?? "translated"}.pdf`, filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (!path) return;
    try {
      setStage("generating-pdf"); setPhase("exporting-pdf"); setMessage("Generating PDF...");
      if (!sourceBytes) throw new Error("PDF_EXPORT_FAILED: 原始 PDF 数据不可用，请重新导入文件。");
      await writeFile(path, await exportTranslatedPdf(sourceBytes, model, ocrPages));
      setStage("completed"); setPhase("review-translation"); setMessage("PDF exported.");
    } catch (error: unknown) {
      recordDiagnostic("pdf-export", error); setStage("failed"); setPhase("review-translation"); setMessage(userMessage(error, "PDF 导出失败，请重试。"));
    }
  }

  function printTranslated(): void {
    if (!model || !canExport(phase)) { setMessage("请先完成翻译并确认译文后再打印。"); return; }
    window.print();
  }

  async function docxBytes(): Promise<Uint8Array> {
    const blob = await Packer.toBlob(buildDocx(model!));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await validateDocx(bytes);
    return bytes;
  }

  function recordDiagnostic(stage: string, error: unknown): void {
    if (isTauri) void invoke("record_diagnostic", { event: { stage, code: diagnosticCode(error) } });
  }

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
  const issues = model?.issues ?? [];
  return <main className="app-shell">
    <header className="app-header" data-tauri-drag-region><div className="brand" data-tauri-drag-region><img className="app-logo" src={appLogo} alt="" /><h1>Honsen PDF Translator</h1></div><span className="brand-note" data-tauri-drag-region>目前无AI加持，图片型PDF翻译成功率低。没有米子接入AI (ó﹏ò｡)</span><UpdateCenter status={updateStatus} checking={checkingUpdate} installing={installingUpdate} desktop={isTauri} onCheck={() => void checkForUpdate()} onInstall={() => void installUpdate()} onClose={() => setUpdateStatus(undefined)} /><SponsorAuthor open={sponsorOpen} onToggle={() => setSponsorOpen((open) => !open)} onClose={() => setSponsorOpen(false)} /><WindowControls /></header>
    <section className="toolbar-card" aria-label="翻译设置"><button className="button primary" type="button" onClick={selectPdf} disabled={isBusy(stage)}>＋ 导入 PDF</button><label>原文语言<select value={sourceLanguage} onChange={(event) => setSourceLanguage(event.currentTarget.value)} disabled={isBusy(stage)}><option value="AUTO">自动检测</option><option value="ZH">中文（简体）</option><option value="ZT">中文（繁体）</option><option value="EN">英语</option><option value="FR">法语</option><option value="ES">西班牙语</option><option value="DE">德语</option><option value="PT">葡萄牙语</option><option value="NL">荷兰语</option><option value="TR">土耳其语</option><option value="PL">波兰语</option><option value="NO">挪威语</option><option value="SV">瑞典语</option><option value="FI">芬兰语</option><option value="JA">日语</option><option value="KO">韩语</option><option value="RU">俄语</option><option value="UK">乌克兰语</option><option value="HU">匈牙利语</option><option value="KK">哈萨克语</option><option value="AR">阿拉伯语</option><option value="FA">波斯语</option></select></label><label>目标语言<select value={targetLanguage} onChange={(event) => setTargetLanguage(event.currentTarget.value)} disabled={isBusy(stage)}><option value="ZH">中文</option><option value="EN">英语</option><option value="FR">法语</option><option value="DE">德语</option><option value="JA">日语</option><option value="ES">西班牙语</option></select></label><label className="key-field">DeepL API Key<input type={showApiKey ? "text" : "password"} value={apiKey} onChange={(event) => setApiKey(event.currentTarget.value)} onBlur={() => void saveKey()} autoComplete="off" placeholder={keyStatus.configured ? "已配置" : "粘贴你的 API Key"} /><button className="icon-button" type="button" aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"} onClick={() => setShowApiKey((value) => !value)}>{showApiKey ? "◉" : "◌"}</button></label><div className="key-memory"><label className="check-field"><input type="checkbox" checked={rememberKey} onChange={(event) => { const remember = event.currentTarget.checked; setRememberKey(remember); if (!remember) void invoke("save_deepl_api_key", { request: { apiKey: "", remember: false } }).then(() => invoke<DeepLKeyStatus>("deepl_key_status")).then(setKeyStatus); }} />记住此密钥</label><span className={`key-state ${keyStatus.configured ? "ready" : ""}`}>{keyStatus.configured ? `● 已保存到安全存储${keyStatus.source ? `（${keyStatus.source}）` : ""}` : "○ 未保存"}</span></div><label className="switch-field"><input type="checkbox" checked={ocrEnabled} onChange={(event) => setOcrEnabled(event.currentTarget.checked)} /><span aria-hidden="true" />OCR 增强</label><label>页面范围<select disabled={isBusy(stage)}><option>全部页面</option></select></label><button className="button primary" type="button" onClick={translate} disabled={!model || isBusy(stage)}>▶ 开始翻译</button>{activeAbortController.current && <button className="button secondary" type="button" onClick={() => activeAbortController.current?.abort()}>取消当前任务</button>}</section>
    <section className="progress-card" aria-live="polite"><strong>翻译进度</strong><div className="progress-track" aria-label={`翻译进度 ${progress}%`}><span style={{ width: `${progress}%` }} /></div><span>{progress}%</span><span>{message}</span></section>
    {issues.length > 0 && <section className="issue-card" aria-label="文档问题" role="alert"><strong>文档问题（{issues.length}）</strong><ul>{issues.map((issue) => <li key={`${issue.code}-${issue.pageNumber ?? 0}`}>{issue.message}</li>)}</ul></section>}
    <section className="workspace" aria-label="PDF 翻译工作区">
      <article className="document-card">
        <div className="card-title"><h2>▧ 原始 PDF</h2><ZoomControls zoom={zoom} onZoom={setZoom} /></div>
        {sourceBytes && model ? <OriginalPdfPreview sourceBytes={sourceBytes} pages={model.pages} zoom={zoom} /> : <EmptyPreview text="导入 PDF 后在这里查看原文" />}
      </article>
      <article className="document-card translation-document-card">
        <div className="card-title"><h2>▧ 译文（保留原页版式）</h2><div className="translation-actions"><ZoomControls zoom={zoom} onZoom={setZoom} /><button className="button secondary print-button" type="button" onClick={printTranslated} disabled={!model || isBusy(stage)}>打印译文</button></div></div>
        <div className="translation-editor" style={{ zoom }}>
          {phase === "review-translation" && model ? <TranslatedDocumentPreview sourceBytes={sourceBytes} pages={model.pages} maskedPages={ocrPages} onLineChange={commitLine} /> : <EmptyPreview text="确认原文后点击开始翻译；图片、签名和印章将保留在译文预览中。" />}
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

function OriginalPdfPreview({ sourceBytes, pages, zoom }: { sourceBytes: Uint8Array; pages: DocumentPage[]; zoom: number }) {
  const canvases = useRef(new Map<number, HTMLCanvasElement>()); const [failed, setFailed] = useState(false);
  useEffect(() => {
    const targets = pages.flatMap(({ number: pageNumber }) => {
      const canvas = canvases.current.get(pageNumber);
      return canvas ? [{ pageNumber, canvas }] : [];
    });
    let cancelled = false; setFailed(false);
    void renderPdfPages(sourceBytes.slice(), targets, () => cancelled).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [pages, sourceBytes]);
  if (failed) return <EmptyPreview text="原始 PDF 页面暂时无法渲染。" />;
  return <div className="pdf-viewer" style={{ zoom }}><div className="source-document" aria-label="连续原始 PDF 预览">{pages.map(({ number: pageNumber }) => <canvas key={pageNumber} ref={(canvas) => { if (canvas) canvases.current.set(pageNumber, canvas); else canvases.current.delete(pageNumber); }} className="source-pdf-page" aria-label={`原始 PDF 第 ${pageNumber} 页`} />)}</div></div>;
}

function UpdateCenter({ status, checking, installing, desktop, onCheck, onInstall, onClose }: { status?: UpdateStatus; checking: boolean; installing: boolean; desktop: boolean; onCheck: () => void; onInstall: () => void; onClose: () => void }) {
  return <div className="update-center" data-tauri-drag-region="false"><button className="text-button" type="button" disabled={!desktop || checking || installing} onClick={onCheck}>{checking ? "正在检查…" : "检查更新"}</button>{status && <section className="update-result" aria-live="polite"><button className="update-result-close" type="button" aria-label="关闭更新提示" onClick={onClose}>×</button><strong>{status.available ? `发现 v${status.version}` : `当前 v${status.currentVersion}`}</strong>{status.available && <><p>{status.releaseNotes?.trim() || "此版本未提供更新说明。"}</p><button className="button primary" type="button" disabled={installing} onClick={onInstall}>{installing ? "正在安装…" : "下载并安装"}</button></>}</section>}</div>;
}

function SponsorAuthor({ open, onToggle, onClose }: { open: boolean; onToggle: () => void; onClose: () => void }) {
  return <div className="sponsor-center" data-tauri-drag-region="false"><button className="text-button" type="button" aria-expanded={open} onClick={onToggle}>赞助作者</button>{open && <section className="sponsor-result" aria-label="赞助作者"><button className="update-result-close" type="button" aria-label="关闭赞助二维码" onClick={onClose}>×</button><strong>感谢你的支持</strong><div className="sponsor-codes"><figure><img src={sponsorWechat} alt="微信赞助二维码" /><figcaption>微信</figcaption></figure><figure><img src={sponsorAlipay} alt="支付宝赞助二维码" /><figcaption>支付宝</figcaption></figure></div></section>}</div>;
}

function updateLines(paragraphs: ParagraphModel[], lineId: string, translatedText: string): ParagraphModel[] {
  return paragraphs.map((paragraph) => ({ ...paragraph, lines: paragraph.lines.map((line) => line.id === lineId
    ? ({ ...line, runs: line.runs.map((run, index) => ({ ...run, translatedText: index ? "" : translatedText })) })
    : ({ ...line, runs: line.runs.map((run) => run.id === lineId ? { ...run, translatedText } : run) })) }));
}

function TranslatedDocumentPreview({ sourceBytes, pages, maskedPages, onLineChange }: { sourceBytes?: Uint8Array; pages: DocumentPage[]; maskedPages: Set<number>; onLineChange: (lineId: string, translatedText: string) => void }) {
  const canvases = useRef(new Map<number, HTMLCanvasElement>());
  const [renderError, setRenderError] = useState(false);
  const [fallbackPages, setFallbackPages] = useState<Set<number>>(new Set());
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!sourceBytes) return;
    let cancelled = false;
    setFallbackPages(new Set());
    const targets = pages.flatMap((page) => {
      const canvas = canvases.current.get(page.number);
      return canvas ? [{ pageNumber: page.number, canvas }] : [];
    });
    void renderCleanBackgroundPages(sourceBytes.slice(), targets, () => cancelled).then((fallback) => { if (!cancelled) setFallbackPages(new Set([...fallback, ...maskedPages])); }).catch((error: unknown) => { if (!cancelled) { console.error("PDF preview failed", error); setRenderError(true); } });
    return () => { cancelled = true; };
  }, [attempt, maskedPages, pages, sourceBytes]);
  if (!sourceBytes) return <EmptyPreview text="无法读取原始 PDF。" />;
  if (renderError) return <div className="preview-retry"><EmptyPreview text="原页背景暂时无法渲染。" /><button className="button secondary" type="button" onClick={() => { setRenderError(false); setAttempt((value) => value + 1); }}>重试预览</button></div>;
  return <div className="translated-document" aria-label="连续译文预览">{pages.map((page) => <TranslatedPage key={page.number} page={page} useWhiteMask={fallbackPages.has(page.number)} canvasRef={(canvas) => { if (canvas) canvases.current.set(page.number, canvas); else canvases.current.delete(page.number); }} onLineChange={onLineChange} />)}</div>;
}

function TranslatedPage({ page, useWhiteMask, canvasRef, onLineChange }: { page: DocumentPage; useWhiteMask: boolean; canvasRef: (canvas: HTMLCanvasElement | null) => void; onLineChange: (lineId: string, translatedText: string) => void }) {
  const placements = translatedPlacements(page);
  const cellRegions = translatedCellRegions(page);
  return <div className="translated-page" style={{ aspectRatio: `${page.width} / ${page.height}` }} aria-label={`第 ${page.number} 页译文，保留原始图片与版式`}>
    <canvas ref={canvasRef} aria-hidden="true" />
    {useWhiteMask && cellRegions.map((region, index) => <span key={`mask-${index}`} className="translated-cell-mask" aria-hidden="true" style={{ left: `${(region.x + 1) / page.width * 100}%`, top: `${(page.height - region.y - region.height + 1) / page.height * 100}%`, width: `${Math.max(0, region.width - 2) / page.width * 100}%`, height: `${Math.max(0, region.height - 2) / page.height * 100}%` }} />)}
    {placements.map((placement) => {
      const units = [...placement.text].reduce((total, character) => total + (character.charCodeAt(0) > 255 ? 1 : 0.55), 0.55);
      const fontSize = Math.max(0.35, Math.min(placement.fontSize / page.width * 100, placement.bbox.height / page.width * 100 / 1.15, (placement.bbox.width / page.width * 100 - 0.25) / units));
      return <textarea key={placement.id} className={`translated-line${useWhiteMask ? "" : " clean-background"}`} aria-label={`编辑第 ${page.number} 页译文`} dir={placement.direction === "rtl" ? "rtl" : "ltr"} rows={1} wrap="off" defaultValue={placement.text} onBlur={(event) => onLineChange(placement.lineId, event.currentTarget.value)} style={{ left: `${placement.bbox.x / page.width * 100}%`, top: `${(page.height - placement.bbox.y - placement.bbox.height) / page.height * 100}%`, width: `${placement.bbox.width / page.width * 100}%`, height: `${placement.bbox.height / page.height * 100}%`, fontSize: `${fontSize}cqw`, color: placement.color ?? "#263246", fontWeight: placement.bold ? 700 : undefined, fontStyle: placement.italic ? "italic" : undefined }} />;
    })}
  </div>;
}

function WindowControls() {
  return <div className="window-controls" aria-label="窗口控制"><button type="button" className="window-control minimize" aria-label="最小化窗口" onClick={() => void getCurrentWindow().minimize()}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10" /></svg></button><button type="button" className="window-control close" aria-label="关闭窗口" onClick={() => void getCurrentWindow().close()}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8" /></svg></button></div>;
}

function toDeepLSourceLanguage(language: string): string | undefined { return ({ ZH: "ZH", ZT: "ZH", EN: "EN", FR: "FR", ES: "ES", DE: "DE", PT: "PT", NL: "NL", TR: "TR", PL: "PL", NO: "NO", SV: "SV", FI: "FI", JA: "JA", KO: "KO", RU: "RU", UK: "UK", HU: "HU", AR: "AR" } as Record<string, string>)[language]; }

function ZoomControls({ zoom, onZoom }: { zoom: number; onZoom: (value: (previous: number) => number) => void }) { return <div className="page-controls"><button type="button" aria-label="缩小" onClick={() => onZoom((value) => Math.max(0.75, value - 0.25))}>−</button><span>{Math.round(zoom * 100)}%</span><button type="button" aria-label="放大" onClick={() => onZoom((value) => Math.min(2, value + 0.25))}>＋</button></div>; }

export default App;
