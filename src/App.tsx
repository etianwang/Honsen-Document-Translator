import { useEffect, useMemo, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Packer } from "docx";
import { buildVisualDocx, validateDocx } from "@pdf-translator/docx-engine";
import type { DocumentModel, DocumentPage, ParagraphModel, ProcessingStage, TranslationSegment } from "@pdf-translator/document-model";
import { translateDocument } from "@pdf-translator/translation-engine";
import { DocumentPipeline } from "@pdf-translator/document-pipeline";
import { configurePdfWorker, parsePdf, renderCleanBackgroundPages, renderPdfPages } from "@pdf-translator/pdf-parser";
import { exportTranslatedPdf, placementTop, renderTranslatedPages, translatedPlacements } from "./pdf-overlay-export";
import pdfWorkerUrl from "../packages/pdf-parser/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import { TauriDeepLTranslator } from "./tauri-deepl-translator";
import { TauriOcrProvider } from "./tauri-ocr-provider";
import { applyGlossary, type GlossaryEntry, parseGlossaryYaml } from "./glossary";
import { diagnosticCode, userMessage } from "./user-message";
import { canExport, canTranslate, isWorkflowBusy, recoverAfterCancel, restoreSourceReview, type WorkflowPhase } from "./workflow-state";
import appLogo from "../logo.png";
import sponsorWechat from "./assets/sponsor-wechat.jpg";
import sponsorAlipay from "./assets/sponsor-alipay.jpg";
import defaultGlossaryYaml from "./assets/default-glossary.yaml?raw";
import { acceptsSourceFile, exportFileName, sourceTypes, type SourceType } from "./source-types";
import { addDocumentPdfPadding } from "./document-pdf-padding";
import { applyCodeTranslations, codeLanguageForPath, extractCodeSegments, tokenizeCode, validateCodeText, type CodeValidation } from "./code-translation";
import "./App.css";

configurePdfWorker(pdfWorkerUrl);
const defaultGlossaryEntries = parseGlossaryYaml(defaultGlossaryYaml);
const defaultGlossaryName = "内置英法机电工程术语库";

interface DeepLKeyStatus { configured: boolean; source?: string; }
interface UpdateStatus { available: boolean; currentVersion: string; version?: string; releaseNotes?: string; }
interface DocumentTranslationProgress { stage: string; completed: number; total: number; }
interface GenericDocumentState {
  sourcePath?: string;
  sourcePreview?: Uint8Array;
  translatedPath?: string;
  translatedPreview?: Uint8Array;
  sourceText?: string;
  translatedText?: string;
  validation?: CodeValidation;
  name?: string;
}
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
  const [sourceZoom, setSourceZoom] = useState(1);
  const [translationZoom, setTranslationZoom] = useState(1);
  const [targetLanguage, setTargetLanguage] = useState("ZH");
  const [sourceLanguage, setSourceLanguage] = useState("AUTO");
  const [ocrEnabled, setOcrEnabled] = useState(true);
  const [wordLayoutMode, setWordLayoutMode] = useState(false);
  const [sourceType, setSourceType] = useState<SourceType>("pdf");
  const [genericDocuments, setGenericDocuments] = useState<Partial<Record<SourceType, GenericDocumentState>>>({});
  const [apiKey, setApiKey] = useState("");
  const [rememberKey, setRememberKey] = useState(true);
  const [showApiKey, setShowApiKey] = useState(false);
  const [keyStatus, setKeyStatus] = useState<DeepLKeyStatus>({ configured: false });
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>();
  const [currentVersion, setCurrentVersion] = useState<string>();
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [sponsorOpen, setSponsorOpen] = useState(false);
  const [glossaryName, setGlossaryName] = useState<string>(defaultGlossaryName);
  const [glossaryEntries, setGlossaryEntries] = useState<GlossaryEntry[]>(defaultGlossaryEntries);
  const activeAbortController = useRef<AbortController | undefined>(undefined);

  useEffect(() => { if (isTauri) { void invoke<DeepLKeyStatus>("deepl_key_status").then(setKeyStatus).catch(() => setKeyStatus({ configured: false })); void invoke<string>("app_version").then(setCurrentVersion).catch(() => setCurrentVersion("不可用")); void checkForUpdate(); } }, []);
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    void listen<DocumentTranslationProgress>("document-translation-progress", ({ payload }) => {
      if (payload.stage !== "translating") return;
      setProgress(payload.total ? Math.round(payload.completed / payload.total * 100) : 100);
      setMessage(payload.total ? `正在翻译 ${sourceTypes.find((type) => type.id === sourceType)?.label ?? "文档"}：${payload.completed}/${payload.total} 段` : "文档中没有需要翻译的文本。");
    }).then((stop) => { unlisten = stop; });
    return () => unlisten?.();
  }, [sourceType]);
  useEffect(() => { setPhase((current) => restoreSourceReview(current, Boolean(model) && stage === "completed")); }, [model, stage]);

  async function checkForUpdate(): Promise<void> {
    if (!isTauri) { setMessage("请在桌面应用中检查更新。"); return; }
    setCheckingUpdate(true);
    try {
      const status = await invoke<UpdateStatus>("check_for_update");
      setUpdateStatus(status); setCurrentVersion(status.currentVersion); setMessage(status.available ? `发现 v${status.version} 更新。` : `当前已是最新版本 v${status.currentVersion}。`);
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
    if (!acceptsSourceFile(path, "pdf")) { setMessage("文件格式不匹配：PDF 页面仅接受 .pdf 文件。"); return; }
    const controller = new AbortController(); activeAbortController.current = controller; setPhase("importing");
    try {
      setStage("analyzing"); setProgress(0); setMessage("正在分析 PDF：准备中");
      const bytes = browserFile ? new Uint8Array(await browserFile.arrayBuffer()) : await readFile(path);
      const previewBytes = bytes.slice();
      const result = await new DocumentPipeline().process(bytes, path, { ocrEnabled: isTauri && ocrEnabled, ocrProvider: isTauri && ocrEnabled ? new TauriOcrProvider() : undefined, ocrLanguage: sourceLanguage === "AUTO" ? undefined : sourceLanguage, signal: controller.signal, onProgress: (pipelineStage, completed, total) => { setStage(pipelineStage); setMessage(progressMessage(pipelineStage, completed, total)); } });
      const reconstructed = result.document;
      const pages = reconstructed.pages;
      setModel(reconstructed);
      setGenericDocuments({});
      setOcrPages(new Set(result.analysis.pageTypes.filter((page) => page.type === "scanned").map((page) => page.pageNumber)));
      setSourceBytes(previewBytes);
      setSourceZoom(1); setTranslationZoom(1);
      setName(path.split(/[\\/]/).pop()); setStage("completed"); setPhase("review-source"); setProgress(0);
      setMessage(`已导入 ${pages.length} 页，请确认原文后点击开始翻译。`);
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") { setStage("idle"); setPhase("empty"); setMessage("已取消导入和 OCR。"); }
      else { recordDiagnostic("import", error); setStage("failed"); setPhase("empty"); setMessage(userMessage(error, "PDF 导入失败，请尝试其他文件。")); }
    } finally { activeAbortController.current = undefined; }
  }

  async function selectSource(): Promise<void> {
    if (sourceType === "pdf") { await selectPdf(); return; }
    if (!isTauri) { setMessage("请在桌面应用中导入此类文档。"); return; }
    const type = sourceTypes.find((item) => item.id === sourceType)!;
    const path = await open({ multiple: false, filters: [{ name: type.label, extensions: type.extensions }] });
    if (typeof path !== "string") return;
    if (!acceptsSourceFile(path, sourceType)) { setMessage("文件格式不匹配：" + type.label + " 页面仅接受 " + type.extensions.map((extension) => "." + extension).join("、") + " 文件。"); return; }
    setModel(undefined); setSourceBytes(undefined); setOcrPages(new Set()); setName(path.split(/[\\/]/).pop());
    setGenericDocuments((documents) => ({ ...documents, [sourceType]: { sourcePath: path, name: path.split(/[\\/]/).pop() } }));
    setPhase("importing"); setStage("analyzing"); setProgress(0); setMessage("正在读取并生成 " + type.label + " 预览…");
    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (sourceType === "text" || sourceType === "code") {
        const sourceText = decodePreviewText(await readFile(path));
        setGenericDocuments((documents) => ({ ...documents, [sourceType]: { ...documents[sourceType], sourceText } }));
      }
      else {
        const sourcePreview = await renderDocumentPreview(path);
        setGenericDocuments((documents) => ({ ...documents, [sourceType]: { ...documents[sourceType], sourcePreview } }));
      }
      setStage("completed"); setPhase("review-source"); setProgress(0); setMessage("已确认 " + type.label + " 文件格式，请点击开始翻译。");
    } catch (error: unknown) {
      recordDiagnostic("import", error); setStage("completed"); setPhase("review-source"); setMessage(userMessage(error, "预览生成失败：" + String(error)));
    }
  }

  async function renderDocumentPreview(sourcePath: string): Promise<Uint8Array> {
    const previewPath = await invoke<string>("render_document_preview", { request: { sourcePath } });
    try { return await addDocumentPdfPadding(await readFile(previewPath)); }
    finally { await invoke("release_document_preview", { previewPath }).catch(() => undefined); }
  }

  async function validateCodeDocument(sourcePath: string, translatedPath: string, translatedText: string): Promise<CodeValidation> {
    const extension = codeLanguageForPath(sourcePath);
    if (!extension) return { valid: false, message: "无法识别代码文件类型，未执行语法校验。" };
    const validation = validateCodeText(translatedText, extension);
    if (!validation.valid || extension !== "py") return validation;
    try {
      await invoke("validate_code_file", { sourcePath: translatedPath });
      return { valid: true, message: "Python 语法与缩进校验通过。" };
    } catch (error: unknown) {
      return { valid: false, message: String(error).replace(/^CODE_VALIDATION_FAILED:\s*/, "") };
    }
  }

  async function revalidateCode(): Promise<void> {
    const document = genericDocuments.code;
    if (!document?.sourcePath || !document.translatedPath || document.translatedText === undefined) return;
    const validation = await validateCodeDocument(document.sourcePath, document.translatedPath, document.translatedText);
    setGenericDocuments((documents) => ({ ...documents, code: { ...documents.code, validation } }));
    setMessage(validation.valid ? validation.message : "代码校验失败：" + validation.message);
  }

  async function copyCode(text: string, label: string): Promise<void> {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const input = document.createElement("textarea"); input.value = text; document.body.append(input); input.select();
        const copied = document.execCommand("copy"); input.remove(); if (!copied) throw new Error("clipboard unavailable");
      }
      setMessage(`${label}代码已复制。`);
    } catch { setMessage("复制失败，请检查系统剪贴板权限。" ); }
  }

  async function exportDocx(): Promise<void> {
    if (!isTauri) { setMessage("DOM 调试仅支持 PDF 解析预览，请在桌面应用中导出。"); return; }
    if (!model || !canExport(phase)) { setMessage("请先完成翻译并确认译文后再导出 DOCX。"); return; }
    const path = await save({ defaultPath: `${targetLanguage.toLowerCase()}_${name?.replace(/\.pdf$/i, "") ?? "translated"}.docx`, filters: [{ name: "Word document", extensions: ["docx"] }] });
    if (!path) return;
    try {
      setStage("generating-docx"); setPhase("exporting-docx"); setMessage("正在生成保留版式的 DOCX…");
      if (wordLayoutMode) {
        await invoke("translate_pdf_via_docx", { request: { sourcePath: model.sourcePath, outputPath: path, targetLanguage, sourceLanguage: toDeepLSourceLanguage(sourceLanguage), apiKey: apiKey.trim() || undefined, format: "docx" } });
        setStage("completed"); setPhase("review-translation"); setMessage("已按 Word 版式优先路径导出 DOCX。"); return;
      }
      await writeFile(path, await docxBytes());
      setStage("completed"); setPhase("review-translation"); setMessage("DOCX 已导出。");
    } catch (error: unknown) {
      recordDiagnostic("docx-export", error); setStage("failed"); setPhase("review-translation"); setMessage(userMessage(error, "DOCX 导出失败，请重试。"));
    }
  }

  async function exportSourcePdfToDocx(): Promise<void> {
    if (!isTauri || !model) { setMessage("请在桌面端导入 PDF 后使用原 PDF → DOCX 测试。"); return; }
    const path = await save({ defaultPath: `${name?.replace(/\.pdf$/i, "") ?? "source"}.docx`, filters: [{ name: "Word document", extensions: ["docx"] }] });
    if (!path) return;
    const returnPhase = phase;
    try {
      setStage("generating-docx"); setPhase("exporting-docx"); setMessage("正在使用 pdf2docx 转换原始 PDF…");
      await invoke("convert_source_pdf_to_docx", { sourcePath: model.sourcePath, outputPath: path });
      setStage("completed"); setPhase(returnPhase); setMessage("原始 PDF 已转换为 DOCX（测试）。");
    } catch (error: unknown) {
      recordDiagnostic("docx-export", error); setStage("failed"); setPhase(returnPhase); setMessage(userMessage(error, "原始 PDF 转 DOCX 失败，请重试。"));
    }
  }

  async function translate(): Promise<void> {
    if (!isTauri) { setMessage("DOM 调试仅支持 PDF 解析预览，请在桌面应用中翻译。"); return; }
    if (sourceType !== "pdf") {
      const type = sourceTypes.find((item) => item.id === sourceType)!;
      const document = genericDocuments[sourceType];
      if (!document?.sourcePath || !canTranslate(phase)) { setMessage("请先导入并确认原文后再开始翻译。"); return; }
      if (!apiKey.trim() && !keyStatus.configured) { setMessage("请先填写或保存 DeepL API Key。"); return; }
      let codeValidation: CodeValidation | undefined;
      try {
        if (apiKey.trim() && rememberKey) setKeyStatus(await invoke<DeepLKeyStatus>("save_deepl_api_key", { request: { apiKey, remember: true } }));
        setStage("translating"); setPhase("translating"); setProgress(0); setMessage("正在翻译 " + type.label + "…");
        if (sourceType === "code") {
          const extension = codeLanguageForPath(document.sourcePath);
          const sourceText = document.sourceText ?? decodePreviewText(await readFile(document.sourcePath));
          if (!extension) throw new Error("DOCUMENT_INVALID_INPUT: 不支持的代码文件类型。");
          const codeSegments = extractCodeSegments(sourceText, extension);
          const controller = new AbortController(); activeAbortController.current = controller;
          const segments: TranslationSegment[] = codeSegments.map((segment) => ({ id: segment.id, sourceText: segment.text, targetLanguage, sourceLanguage: toDeepLSourceLanguage(sourceLanguage), elementIds: [segment.id] }));
          const result = await new TauriDeepLTranslator(apiKey.trim() || undefined, undefined, toDeepLSourceLanguage(sourceLanguage)).translate({ segments }, { signal: controller.signal, onProgress: (completed, total) => { setProgress(total ? Math.round(completed / total * 100) : 100); setMessage(total ? `正在翻译代码文本：${completed}/${total} 段` : "没有可翻译的代码文本。"); } });
          const glossary = new Map(glossaryEntries.map((entry) => [entry.source.trim(), entry.target.trim()]));
          const translations = new Map(result.translations.map((translation) => [translation.segmentId, glossary.get(codeSegments.find((segment) => segment.id === translation.segmentId)?.text.trim() ?? "") ?? translation.translatedText]));
          const translatedText = applyCodeTranslations(sourceText, codeSegments, translations);
          const output = await invoke<string>("save_translated_text_file", { sourcePath: document.sourcePath, content: translatedText });
          const validation = await validateCodeDocument(document.sourcePath, output, translatedText);
          codeValidation = validation;
          setGenericDocuments((documents) => ({ ...documents, [sourceType]: { ...documents[sourceType], translatedPath: output, translatedText, validation } }));
          activeAbortController.current = undefined;
        }
        else {
          const output = await invoke<string>("translate_document_file", { request: { sourcePath: document.sourcePath, outputPath: "", sourceType, targetLanguage, sourceLanguage: toDeepLSourceLanguage(sourceLanguage), apiKey: apiKey.trim() || undefined, glossary: glossaryEntries } });
          if (sourceType === "text") {
          const translatedText = decodePreviewText(await readFile(output));
          setGenericDocuments((documents) => ({ ...documents, [sourceType]: { ...documents[sourceType], translatedPath: output, translatedText } }));
          }
          else {
          const translatedPreview = await renderDocumentPreview(output);
          setGenericDocuments((documents) => ({ ...documents, [sourceType]: { ...documents[sourceType], translatedPath: output, translatedPreview } }));
          }
        }
        setProgress(100); setStage("completed"); setPhase("review-translation"); setMessage(codeValidation ? (codeValidation.valid ? "翻译完成，代码校验通过，可以导出文件。" : "翻译完成，但代码校验失败：" + codeValidation.message) : "翻译完成，请点击右侧按钮导出文件。");
      } catch (error: unknown) {
        recordDiagnostic("translation", error); setStage("failed"); setPhase("review-source"); setMessage(userMessage(error, type.label + " 翻译失败，请重试。"));
      } finally { activeAbortController.current = undefined; }
      return;
    }
    if (!model || !canTranslate(phase)) { setMessage("请先导入并确认原文后再开始翻译。"); return; }
    if (wordLayoutMode) {
      if (!apiKey.trim() && !keyStatus.configured) { setMessage("请先填写或保存 DeepL API Key。"); return; }
      setStage("completed"); setPhase("review-translation"); setMessage("Word 版式优先已启用：将在导出时重建并翻译 DOCX。"); return;
    }
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
      setGlossaryEntries(entries); setGlossaryName(path.split(/[\\/]/).pop() ?? path); setMessage(`已加载 ${entries.length} 条术语。`);
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
    const path = await save({ defaultPath: `${targetLanguage.toLowerCase()}_${name?.replace(/\.pdf$/i, "") ?? "translated"}.pdf`, filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (!path) return;
    try {
      setStage("generating-pdf"); setPhase("exporting-pdf"); setMessage("Generating PDF...");
      if (wordLayoutMode) {
        await invoke("translate_pdf_via_docx", { request: { sourcePath: model.sourcePath, outputPath: path, targetLanguage, sourceLanguage: toDeepLSourceLanguage(sourceLanguage), apiKey: apiKey.trim() || undefined, format: "pdf" } });
        setStage("completed"); setPhase("review-translation"); setMessage("已按 Word 版式优先路径导出 PDF。"); return;
      }
      if (!sourceBytes) throw new Error("PDF_EXPORT_FAILED: 原始 PDF 数据不可用，请重新导入文件。");
      await writeFile(path, await exportTranslatedPdf(sourceBytes, model, ocrPages));
      setStage("completed"); setPhase("review-translation"); setMessage("PDF exported.");
    } catch (error: unknown) {
      recordDiagnostic("pdf-export", error); setStage("failed"); setPhase("review-translation"); setMessage(userMessage(error, "PDF 导出失败，请重试。"));
    }
  }

  async function exportGenericNative(): Promise<void> {
    const type = sourceTypes.find((item) => item.id === sourceType)!;
    const document = genericDocuments[sourceType];
    if (!isTauri || !document?.translatedPath) { setMessage("请先完成翻译并确认译文后再导出。"); return; }
    if (sourceType === "code" && document.validation && !document.validation.valid) { setMessage("代码校验未通过，请修复译文后再导出。" ); return; }
    const extension = type.id === "code" ? document.sourcePath?.split(".").pop()?.toLowerCase() || type.outputExtension : type.id === "text" && /\.md(?:own)?$/i.test(document.sourcePath ?? "") ? "md" : type.outputExtension;
    const path = await save({ defaultPath: exportFileName(document.sourcePath, targetLanguage, type), filters: [{ name: type.label + " 译文", extensions: [extension] }] });
    if (!path) return;
    try {
      setPhase("exporting-docx"); setMessage("正在导出 " + extension.toUpperCase() + "…");
      await invoke("export_document_file", { sourcePath: document.translatedPath, outputPath: path });
      setStage("completed"); setPhase("review-translation"); setMessage("已导出：" + path.split(/[\\/]/).pop());
    } catch (error: unknown) {
      recordDiagnostic("document-export", error); setStage("failed"); setPhase("review-translation"); setMessage(userMessage(error, "文档导出失败，请重试。"));
    }
  }

  async function exportGenericPdf(): Promise<void> {
    const document = genericDocuments[sourceType];
    if (!isTauri || !document?.translatedPath) { setMessage("请先完成翻译并确认译文后再导出 PDF。"); return; }
    const base = document.sourcePath?.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? "translated";
    const path = await save({ defaultPath: `${targetLanguage.toLowerCase()}_${base}.pdf`, filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (!path) return;
    try {
      setPhase("exporting-pdf"); setMessage("正在导出 PDF…");
      await invoke("export_document_to_pdf", { sourcePath: document.translatedPath, outputPath: path });
      await writeFile(path, await addDocumentPdfPadding(await readFile(path)));
      setStage("completed"); setPhase("review-translation"); setMessage("已导出：" + path.split(/[\\/]/).pop());
    } catch (error: unknown) {
      recordDiagnostic("pdf-export", error); setStage("failed"); setPhase("review-translation"); setMessage(userMessage(error, "PDF 导出失败，请重试。"));
    }
  }

  function printTranslated(): void {
    if (!model || !canExport(phase)) { setMessage("请先完成翻译并确认译文后再打印。"); return; }
    window.print();
  }

  async function docxBytes(): Promise<Uint8Array> {
    if (!sourceBytes) throw new Error("DOCX_GENERATION_FAILED: 原始 PDF 数据不可用，请重新导入文件。");
    const blob = await Packer.toBlob(buildVisualDocx(await renderTranslatedPages(sourceBytes, model!, ocrPages)));
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
  const previewTerms = useMemo(
    () => glossaryEntries.length > 3 ? [...glossaryEntries.slice(0, 2), glossaryEntries[glossaryEntries.length - 1]!] : glossaryEntries,
    [glossaryEntries],
  );
  const issues = model?.issues ?? [];
  const activeSourceType = sourceTypes.find((type) => type.id === sourceType)!;
  const activeGenericDocument = genericDocuments[sourceType];
  const previewLoading = phase === "importing" && sourceType !== "pdf";
  return <main className="app-shell">
    <header className="app-header" data-tauri-drag-region><div className="brand" data-tauri-drag-region><img className="app-logo" src={appLogo} alt="" /><h1>Honsen Document Translator</h1></div><span className="brand-note" data-tauri-drag-region>目前无AI加持，图片型PDF翻译成功率低。没有米子接入AI (ó﹏ò｡)</span><UpdateCenter currentVersion={currentVersion} status={updateStatus} checking={checkingUpdate} installing={installingUpdate} desktop={isTauri} onCheck={() => void checkForUpdate()} onInstall={() => void installUpdate()} onClose={() => setUpdateStatus(undefined)} /><SponsorAuthor open={sponsorOpen} onToggle={() => setSponsorOpen((open) => !open)} onClose={() => setSponsorOpen(false)} /><WindowControls /></header>
    <nav className="source-type-tabs" aria-label="源文件类型">{sourceTypes.map((type) => <button key={type.id} type="button" className={sourceType === type.id ? "active" : ""} aria-current={sourceType === type.id ? "page" : undefined} onClick={() => { setSourceType(type.id); if (type.id !== "pdf") { setModel(undefined); setSourceBytes(undefined); const document = genericDocuments[type.id]; setPhase(document?.translatedPath ? "review-translation" : document?.sourcePath ? "review-source" : "empty"); setMessage(document?.sourcePath ? "已切换到 " + type.label + "。" : "请选择 " + type.label + " 文件。"); } }} disabled={isBusy(stage)}>{type.label}</button>)}</nav>
    <section className="toolbar-card" aria-label="翻译设置"><button className="button primary" type="button" onClick={() => void selectSource()} disabled={isBusy(stage)}>＋ 导入 {sourceTypes.find((type) => type.id === sourceType)?.label}</button><label>原文语言<select value={sourceLanguage} onChange={(event) => setSourceLanguage(event.currentTarget.value)} disabled={isBusy(stage)}><option value="AUTO">自动检测</option><option value="ZH">中文（简体）</option><option value="ZT">中文（繁体）</option><option value="EN">英语</option><option value="FR">法语</option><option value="ES">西班牙语</option><option value="DE">德语</option><option value="PT">葡萄牙语</option><option value="NL">荷兰语</option><option value="TR">土耳其语</option><option value="PL">波兰语</option><option value="NO">挪威语</option><option value="SV">瑞典语</option><option value="FI">芬兰语</option><option value="JA">日语</option><option value="KO">韩语</option><option value="RU">俄语</option><option value="UK">乌克兰语</option><option value="HU">匈牙利语</option><option value="KK">哈萨克语</option><option value="AR">阿拉伯语</option><option value="FA">波斯语</option></select></label><label>目标语言<select value={targetLanguage} onChange={(event) => setTargetLanguage(event.currentTarget.value)} disabled={isBusy(stage)}><option value="ZH">中文（简体）</option><option value="ZH-HANT">中文（繁体）</option><option value="EN">英语</option><option value="FR">法语</option><option value="ES">西班牙语</option><option value="DE">德语</option><option value="PT">葡萄牙语</option><option value="NL">荷兰语</option><option value="TR">土耳其语</option><option value="PL">波兰语</option><option value="NB">挪威语</option><option value="SV">瑞典语</option><option value="FI">芬兰语</option><option value="JA">日语</option><option value="KO">韩语</option><option value="RU">俄语</option><option value="UK">乌克兰语</option><option value="HU">匈牙利语</option><option value="AR">阿拉伯语</option></select></label><label className="key-field">DeepL API Key<input type={showApiKey ? "text" : "password"} value={apiKey} onChange={(event) => setApiKey(event.currentTarget.value)} onBlur={() => void saveKey()} autoComplete="off" placeholder={keyStatus.configured ? "已配置" : "粘贴你的 API Key"} /><button className="icon-button" type="button" aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"} onClick={() => setShowApiKey((value) => !value)}>{showApiKey ? "◉" : "◌"}</button></label><div className="key-memory"><label className="check-field"><input type="checkbox" checked={rememberKey} onChange={(event) => { const remember = event.currentTarget.checked; setRememberKey(remember); if (!remember) void invoke("save_deepl_api_key", { request: { apiKey: "", remember: false } }).then(() => invoke<DeepLKeyStatus>("deepl_key_status")).then(setKeyStatus); }} />记住此密钥</label><span className={`key-state ${keyStatus.configured ? "ready" : ""}`}>{keyStatus.configured ? `● 已保存到安全存储${keyStatus.source ? `（${keyStatus.source}）` : ""}` : "○ 未保存"}</span></div><label className="switch-field"><input type="checkbox" checked={ocrEnabled} onChange={(event) => setOcrEnabled(event.currentTarget.checked)} disabled={sourceType !== "pdf"} /><span aria-hidden="true" />OCR 增强</label><label className="check-field" title="仅适合文字型 PDF；导出时会重新翻译 DOCX"> <input type="checkbox" checked={wordLayoutMode} onChange={(event) => setWordLayoutMode(event.currentTarget.checked)} disabled={sourceType !== "pdf" || isBusy(stage)} />Word 版式优先</label><label>页面范围<select disabled={sourceType !== "pdf" || isBusy(stage)}><option>全部页面</option></select></label><button className="button primary" type="button" onClick={translate} disabled={(sourceType === "pdf" ? !model : !activeGenericDocument?.sourcePath) || isBusy(stage)}>▶ 开始翻译</button>{activeAbortController.current && <button className="button secondary" type="button" onClick={() => activeAbortController.current?.abort()}>取消当前任务</button>}</section>
    <section className="progress-card" aria-live="polite"><strong>{previewLoading ? "预览进度" : "翻译进度"}</strong><div className={`progress-track${previewLoading ? " is-indeterminate" : ""}`} role="progressbar" aria-label={previewLoading ? "正在生成文档预览" : `翻译进度 ${progress}%`} aria-valuenow={previewLoading ? undefined : progress} aria-valuemin={previewLoading ? undefined : 0} aria-valuemax={previewLoading ? undefined : 100} aria-valuetext={previewLoading ? "正在处理" : `${progress}%`}><span style={previewLoading ? undefined : { width: `${progress}%` }} /></div><span>{previewLoading ? "处理中…" : `${progress}%`}</span><span>{message}</span></section>
    {issues.length > 0 && <section className="issue-card" aria-label="文档问题" role="alert"><strong>文档问题（{issues.length}）</strong><ul>{issues.map((issue) => <li key={`${issue.code}-${issue.pageNumber ?? 0}`}>{issue.message}</li>)}</ul></section>}
    <section className="workspace" aria-label="PDF 翻译工作区">
      <article className="document-card">
        <div className="card-title"><h2>▧ 原始 {activeSourceType.label}</h2><div className="translation-actions">{sourceType === "code" && <button className="copy-code-button" type="button" aria-label="复制原始代码" title="复制原始代码" onClick={() => void copyCode(activeGenericDocument?.sourceText ?? "", "原始")}>⧉</button>}<ZoomControls zoom={sourceZoom} onZoom={setSourceZoom} />{sourceType === "pdf" && <button className="button secondary print-button" type="button" onClick={exportSourcePdfToDocx} disabled={!isTauri || !model || isBusy(stage)}>原 PDF → DOCX</button>}</div></div>
        {sourceBytes && model ? <OriginalPdfPreview sourceBytes={sourceBytes} pages={model.pages} zoom={sourceZoom} /> : activeGenericDocument?.sourcePreview ? <DocumentPdfPreview sourceBytes={activeGenericDocument.sourcePreview} label={"原始 " + activeSourceType.label} zoom={sourceZoom} /> : activeGenericDocument?.sourceText !== undefined ? sourceType === "code" ? <CodePreview text={activeGenericDocument.sourceText} zoom={sourceZoom} /> : <PlainTextPreview text={activeGenericDocument.sourceText} label={"原始 " + activeSourceType.label} zoom={sourceZoom} /> : <EmptyPreview text={activeGenericDocument?.sourcePath ? "已确认文件格式：" + (activeGenericDocument.name ?? "") : "导入 " + activeSourceType.label + " 后在这里查看原文"} />}
      </article>
      <article className="document-card translation-document-card">
        <div className="card-title"><h2>▧ {sourceType === "pdf" ? "译文（保留原页版式）" : activeSourceType.label + " 译文"}</h2><div className="translation-actions">{sourceType === "code" && <><button className="button secondary print-button" type="button" onClick={revalidateCode} disabled={!activeGenericDocument?.translatedPath || isBusy(stage)}>校验语法</button><button className="copy-code-button" type="button" aria-label="复制译文代码" title="复制译文代码" onClick={() => void copyCode(activeGenericDocument?.translatedText ?? "", "译文")} disabled={!activeGenericDocument?.translatedText}>⧉</button></>}<ZoomControls zoom={translationZoom} onZoom={setTranslationZoom} />{sourceType === "pdf" && <button className="button secondary print-button" type="button" onClick={printTranslated} disabled={!model || isBusy(stage)}>打印译文</button>}</div></div>
        <div className="translation-editor">
          {sourceType === "code" && activeGenericDocument?.validation && <p className={`code-validation ${activeGenericDocument.validation.valid ? "valid" : "invalid"}`} role={activeGenericDocument.validation.valid ? "status" : "alert"}>{activeGenericDocument.validation.valid ? "●" : "⚠"} {activeGenericDocument.validation.message}</p>}
          {phase === "review-translation" && model ? <div className="preview-content" style={{ width: `${translationZoom * 100}%` }}><TranslatedDocumentPreview sourceBytes={sourceBytes} pages={model.pages} maskedPages={ocrPages} onLineChange={commitLine} /></div> : activeGenericDocument?.translatedPreview ? <DocumentPdfPreview sourceBytes={activeGenericDocument.translatedPreview} label={activeSourceType.label + " 译文"} zoom={translationZoom} /> : activeGenericDocument?.translatedText !== undefined ? sourceType === "code" ? <CodePreview text={activeGenericDocument.translatedText} zoom={translationZoom} /> : <PlainTextPreview text={activeGenericDocument.translatedText} label={activeSourceType.label + " 译文"} zoom={translationZoom} /> : <EmptyPreview text={sourceType === "pdf" ? "确认原文后点击开始翻译；图片、签名和印章将保留在译文预览中。" : phase === "review-translation" ? "译文已保存，但预览生成失败。" : "确认原文后点击开始翻译。"} />}
        </div>
      </article>
      <aside className="glossary-card">
        <div className="card-title"><h2>▤ 术语表</h2></div>
        <p>使用 YAML 文件保持术语翻译一致。</p>
        <div className="glossary-file"><strong>{glossaryName}</strong><span>● 已加载 {glossaryEntries.length} 条术语</span><button className="button secondary" type="button" onClick={chooseGlossary}>选择 / 更换文件</button>{glossaryName !== defaultGlossaryName && <button className="text-button" type="button" onClick={() => { setGlossaryName(defaultGlossaryName); setGlossaryEntries(defaultGlossaryEntries); setMessage("已恢复内置术语库。"); }}>恢复内置</button>}</div>
        {previewTerms.length > 0 && <ol className="yaml-preview">
          {previewTerms.slice(0, 2).map((entry, index) => <li key={`${entry.source}-${index}`}><span className="yaml-index">{index + 1}.</span><code>{entry.source}: <b>{entry.target}</b></code></li>)}
          {glossaryEntries.length > 3 && <li className="yaml-ellipsis" aria-label="中间术语已省略"><span className="yaml-index">…</span></li>}
          {previewTerms.slice(2).map((entry, index) => <li key={`${entry.source}-${index + 2}`}><span className="yaml-index">{glossaryEntries.length > 3 ? glossaryEntries.length : index + 3}.</span><code>{entry.source}: <b>{entry.target}</b></code></li>)}
        </ol>}
        <div className="tip"><strong>💡 提示</strong><span>术语表会在翻译时优先应用，提升全篇一致性。</span></div>
        <div className="exports">{sourceType === "pdf" ? <><button className="button secondary" type="button" onClick={exportDocx} disabled={!model || isBusy(stage)}>导出 DOCX（版式）</button><button className="button secondary" type="button" onClick={exportPdf} disabled={!model || isBusy(stage)}>导出 PDF</button></> : <><button className="button secondary" type="button" onClick={exportGenericNative} disabled={!activeGenericDocument?.translatedPath || isBusy(stage)}>导出 {sourceType === "code" ? activeGenericDocument?.sourcePath?.split(".").pop()?.toUpperCase() : sourceType === "word" ? "DOCX" : sourceType === "presentation" ? "PPTX" : sourceType === "spreadsheet" ? "XLSX" : /\.md(?:own)?$/i.test(activeGenericDocument?.sourcePath ?? "") ? "MD" : "TXT"}</button>{sourceType !== "code" && <button className="button secondary" type="button" onClick={exportGenericPdf} disabled={!activeGenericDocument?.translatedPath || isBusy(stage)}>导出 PDF</button>}</>}</div>
      </aside>
    </section>
  </main>;
}

function EmptyPreview({ text }: { text: string }) { return <div className="empty-preview"><span>▧</span><p>{text}</p></div>; }

function OriginalPdfPreview({ sourceBytes, pages, zoom }: { sourceBytes: Uint8Array; pages: Array<Pick<DocumentPage, "number">>; zoom: number }) {
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
  return <div className="pdf-viewer"><div className="source-document" style={{ width: `${zoom * 100}%` }} aria-label="连续原始 PDF 预览">{pages.map(({ number: pageNumber }) => <canvas key={pageNumber} ref={(canvas) => { if (canvas) canvases.current.set(pageNumber, canvas); else canvases.current.delete(pageNumber); }} className="source-pdf-page" aria-label={`原始 PDF 第 ${pageNumber} 页`} />)}</div></div>;
}

function DocumentPdfPreview({ sourceBytes, label, zoom }: { sourceBytes: Uint8Array; label: string; zoom: number }) {
  const [pages, setPages] = useState<Array<Pick<DocumentPage, "number">>>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false; setFailed(false); setPages([]);
    void parsePdf(sourceBytes.slice(), label).then((document) => { if (!cancelled) setPages(document.pages.map((page) => ({ number: page.number }))); }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [label, sourceBytes]);
  if (failed) return <EmptyPreview text="文档预览暂时无法渲染。" />;
  if (pages.length === 0) return <EmptyPreview text="正在生成文档预览…" />;
  return <OriginalPdfPreview sourceBytes={sourceBytes} pages={pages} zoom={zoom} />;
}

function PlainTextPreview({ text, label, zoom }: { text: string; label: string; zoom: number }) {
  return <div className="plain-text-preview"><pre style={{ width: `${zoom * 100}%` }} aria-label={label}>{text}</pre></div>;
}

function CodePreview({ text, zoom }: { text: string; zoom: number }) {
  const lines: ReturnType<typeof tokenizeCode>[] = [[]];
  for (const token of tokenizeCode(text)) for (const part of token.text.split(/(\n)/)) {
    if (part === "\n") lines.push([]);
    else if (part) lines[lines.length - 1].push({ ...token, text: part });
  }
  return <div className="code-preview"><pre style={{ width: `${zoom * 100}%` }} aria-label="代码预览"><code>{lines.map((line, index) => <span className="code-line" key={index}><span className="code-line-number" aria-hidden="true">{index + 1}</span><span>{line.map((token, tokenIndex) => <span key={tokenIndex} className={`code-${token.kind}`}>{token.text}</span>)}</span></span>)}</code></pre></div>;
}

function UpdateCenter({ currentVersion, status, checking, installing, desktop, onCheck, onInstall, onClose }: { currentVersion?: string; status?: UpdateStatus; checking: boolean; installing: boolean; desktop: boolean; onCheck: () => void; onInstall: () => void; onClose: () => void }) {
  return <div className="update-center" data-tauri-drag-region="false"><span className="current-version" aria-live="polite">当前版本 {currentVersion ? (currentVersion === "不可用" ? currentVersion : `v${currentVersion}`) : "读取中…"}</span><button className="text-button" type="button" disabled={!desktop || checking || installing} onClick={onCheck}>{checking ? "正在检查…" : "检查更新"}</button>{status && <section className="update-result" aria-live="polite"><button className="update-result-close" type="button" aria-label="关闭更新提示" onClick={onClose}>×</button><strong>{status.available ? `发现 v${status.version}` : `已是最新版本（v${status.currentVersion}）`}</strong>{status.available && <><p>{status.releaseNotes?.trim() || "此版本未提供更新说明。"}</p><button className="button primary" type="button" disabled={installing} onClick={onInstall}>{installing ? "正在安装…" : "下载并安装"}</button></>}</section>}</div>;
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
  return <div className="translated-page" style={{ aspectRatio: `${page.width} / ${page.height}` }} aria-label={`第 ${page.number} 页译文，保留原始图片与版式`}>
    <canvas ref={canvasRef} aria-hidden="true" />
    {useWhiteMask && placements.map((placement, index) => <span key={`mask-${placement.id}-${index}`} className="translated-text-mask" aria-hidden="true" style={{ left: `${placement.bbox.x / page.width * 100}%`, top: `${placementTop(page.height, placement.bbox) / page.height * 100}%`, width: `${placement.bbox.width / page.width * 100}%`, height: `${placement.bbox.height / page.height * 100}%` }} />)}
    {placements.map((placement, index) => {
      const units = [...placement.text].reduce((total, character) => total + (character.charCodeAt(0) > 255 ? 1 : 0.55), 0.55);
      const fontSize = Math.max(0.35, Math.min(placement.fontSize / page.width * 100, placement.bbox.height / page.width * 100 / 1.15, placement.bbox.width / page.width * 100 / units));
      return <textarea key={`${placement.id}-${index}`} className={`translated-line${useWhiteMask ? "" : " clean-background"}`} aria-label={`编辑第 ${page.number} 页译文`} dir={placement.direction === "rtl" ? "rtl" : "ltr"} rows={1} wrap="off" defaultValue={placement.text} onBlur={(event) => onLineChange(placement.lineId, event.currentTarget.value)} style={{ left: `${placement.bbox.x / page.width * 100}%`, top: `${placementTop(page.height, placement.bbox) / page.height * 100}%`, width: `${placement.bbox.width / page.width * 100}%`, height: `${placement.bbox.height / page.height * 100}%`, fontSize: `${fontSize}cqw`, color: placement.color ?? "#263246", fontWeight: placement.bold ? 700 : undefined, fontStyle: placement.italic ? "italic" : undefined }} />;
    })}
  </div>;
}

function WindowControls() {
  return <div className="window-controls" aria-label="窗口控制"><button type="button" className="window-control minimize" aria-label="最小化窗口" onClick={() => void getCurrentWindow().minimize()}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10" /></svg></button><button type="button" className="window-control close" aria-label="关闭窗口" onClick={() => void getCurrentWindow().close()}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8" /></svg></button></div>;
}

function toDeepLSourceLanguage(language: string): string | undefined { return ({ ZH: "ZH", ZT: "ZH", EN: "EN", FR: "FR", ES: "ES", DE: "DE", PT: "PT", NL: "NL", TR: "TR", PL: "PL", NO: "NO", SV: "SV", FI: "FI", JA: "JA", KO: "KO", RU: "RU", UK: "UK", HU: "HU", AR: "AR" } as Record<string, string>)[language]; }

function decodePreviewText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.slice(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.slice(2));
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder("utf-8").decode(bytes.slice(3));
  return new TextDecoder().decode(bytes);
}

function ZoomControls({ zoom, onZoom }: { zoom: number; onZoom: (value: (previous: number) => number) => void }) { return <div className="page-controls"><button type="button" aria-label="缩小" onClick={() => onZoom((value) => Math.max(0.75, value - 0.25))}>−</button><span>{Math.round(zoom * 100)}%</span><button type="button" aria-label="放大" onClick={() => onZoom((value) => Math.min(2, value + 0.25))}>＋</button></div>; }

export default App;
