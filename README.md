# Honsen PDF Translator

面向 Windows 的 PDF 翻译桌面应用。它会提取并重建 PDF 文字，调用 DeepL 翻译，并导出 DOCX 或保留版式的 PDF。

## 配置

复制 `.env.example` 为 `.env`，填写 DeepL API Key：

```text
DEEPL_API_KEY=your-key
```

渲染界面不会读取该文件或把密钥发送给 JavaScript；Tauri 后端仅在发起翻译请求时读取密钥，并通过 HTTPS 调用 DeepL。也可在应用界面中保存密钥至 Windows 凭据管理器。

## OCR 与扫描件

扫描型 PDF 使用本地 Poppler 渲染和 Tesseract OCR，不会把文档上传到 OCR 云服务。应用打包 Poppler、Tesseract、21 种语言包及方向/脚本检测数据。

没有文字层的页面会自动进入 OCR。含可选中文本、图片、签名或印章的混合页面默认保留原有图片内容，避免把印章和图片误识别为文字。详细策略见 [OCR 说明](docs/OCR.md)。

## 更新与便携版

界面右上角可检查 GitHub Releases 中的新版、查看更新说明，并在确认后下载、校验 SHA-256、静默安装。不会自动下载或安装更新。

`pnpm tauri:portable` 会把本机 LibreOffice 运行时一并打包，用于 DOCX 转 PDF；最终用户无需安装 Microsoft Office 或 LibreOffice。发布前先执行 `pnpm stage:libreoffice`。该运行时目录会被 Git 忽略。

## 开发与验证

```powershell
pnpm install
pnpm test
pnpm typecheck
pnpm lint
pnpm b
pnpm tauri dev
```

本地处理与 DeepL 数据流见 [隐私说明](docs/PRIVACY.md)。发布审计与剩余检查项见 `docs/PRODUCTION_AUDIT.md`、`docs/RELEASE_CHECKLIST.md`。
