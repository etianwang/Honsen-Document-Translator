# Release Checklist

The authoritative, execution-ready checklist is [TASKS.md](TASKS.md). Do not release while any P0 task there remains unchecked.

Current verified baseline (2026-09-30):

- [x] lint and TypeScript typecheck
- [x] 41 TypeScript tests and 10 Rust regular tests
- [x] local OCR health check: image PDF → Poppler → Tesseract
- [x] real minimal DeepL integration check without outputting the API Key
- [x] DOCX OOXML package validation
- [x] Inno 安装包构建
- [x] `pnpm verify:installed-runtime`：Inno 安装、内置 Poppler/Tesseract OCR、内置 LibreOffice DOCX→PDF、卸载（2026-09-30）
- [ ] 干净 Windows 虚拟机：安装 / 升级 / 卸载，以及无系统 OCR/Office 依赖验证
- [ ] E2E happy path, visual regression, large-file test
- [x] source/Git key scan, production dependency audit and privacy data-flow documentation
- [ ] final installer artifact scan and third-party redistribution-license audit
