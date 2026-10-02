# Release Checklist

The authoritative, execution-ready checklist is [TASKS.md](TASKS.md). Do not release while any P0 task there remains unchecked.

Current v2.0.0 candidate evidence (2026-10-02):

- [x] lint and TypeScript typecheck
- [x] TypeScript typecheck, Rust check and document-worker tests
- [x] local OCR health check: image PDF → Poppler → Tesseract
- [x] real minimal DeepL integration check without outputting the API Key
- [x] Real DeepL E2E: DOCX, PPTX, XLSX, TXT and Markdown; Office outputs converted through bundled LibreOffice for preview
- [x] Inno 安装包构建
- [ ] `pnpm verify:installed-runtime`：待 v2.0.0 最终 Inno 包完成后执行，须覆盖内置 Python
- [ ] 干净 Windows 虚拟机：安装 / 升级 / 卸载，以及无系统 OCR/Office 依赖验证
- [ ] E2E happy path, visual regression, large-file test
- [x] source/Git key scan, production dependency audit and privacy data-flow documentation
- [ ] final installer artifact scan and third-party redistribution-license audit
