const messages: Record<string, string> = {
  DEEPL_AUTH_FAILED: "DeepL API Key 无效，请检查后重试。",
  DEEPL_NOT_CONFIGURED: "请先填写或保存 DeepL API Key。",
  DEEPL_QUOTA_EXCEEDED: "DeepL 可用额度已用完，请检查账户额度。",
  DEEPL_UNAVAILABLE: "暂时无法连接 DeepL，请检查网络后重试。",
  DEEPL_REQUEST_FAILED: "DeepL 未能处理此次请求，请稍后重试。",
  ENCRYPTED_PDF: "此 PDF 已加密，请先移除密码后再导入。",
  INVALID_PDF: "请选择有效的 PDF 文件。",
  OCR_ENGINE_UNAVAILABLE: "本地 OCR 组件不可用，请重新安装应用。",
  OCR_LANGUAGE_UNAVAILABLE: "所选 OCR 语言包不可用，请更换语言后重试。",
  OCR_RENDER_FAILED: "无法将此页转换为 OCR 图像，请尝试其他 PDF。",
  OCR_FAILED: "此页 OCR 失败，可关闭 OCR 后继续导入。",
  PDF_PARSE_FAILED: "无法解析此 PDF，请尝试重新导出或使用其他文件。",
  PDF_EXPORT_FAILED: "PDF 导出失败，请重试；若仍失败请重新安装应用。",
  DOCX_VALIDATION_FAILED: "生成的 DOCX 无法验证，请重试导出。",
  PDF2DOCX_INVALID_INPUT: "请选择已导入的本地 PDF 文件。",
  PDF2DOCX_INVALID_OUTPUT: "请选择以 .docx 结尾的保存位置。",
  PDF2DOCX_UNAVAILABLE: "未检测到本机 pdf2docx。请安装 Python 后执行：python -m pip install pdf2docx。",
  PDF2DOCX_FAILED: "pdf2docx 未能生成 DOCX；复杂 PDF 的效果取决于原始版式。",
  DOCUMENT_INVALID_INPUT: "所选文件与当前文件类型不匹配，请重新选择。",
  DOCUMENT_INVALID_OUTPUT: "保存文件的扩展名与当前文件类型不匹配。",
  DOCUMENT_CONVERSION_FAILED: "旧版 Office 文件转换失败，请确认文件可正常打开后重试。",
  DOCUMENT_TRANSLATOR_UNAVAILABLE: "文档翻译组件不可用。请重新安装应用，或确认本机已安装 Python。",
  DOCUMENT_TRANSLATION_FAILED: "文档翻译未生成输出文件，请检查文件是否受保护或已被其他程序占用。",
  UPDATE_CHECK_FAILED: "检查更新失败，请稍后重试。",
  UPDATE_DOWNLOAD_FAILED: "更新下载安装包失败，请稍后重试。",
  UPDATE_CHECKSUM_FAILED: "更新文件校验失败，已取消安装。",
};

export function userMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : "";
  const code = message.split(":", 1)[0];
  return messages[code] ?? (message && !message.includes(":") && /[\u4e00-\u9fff]/.test(message) ? message : fallback);
}

export function diagnosticCode(error: unknown): string {
  const code = error instanceof Error ? error.message.split(":", 1)[0] : "";
  return /^[A-Z_]{1,64}$/.test(code) ? code : "UNKNOWN_ERROR";
}
