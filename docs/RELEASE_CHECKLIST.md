# Release Checklist

The authoritative, execution-ready checklist is [TASKS.md](TASKS.md). Do not release while any P0 task there remains unchecked.

Current verified baseline (2026-09-26):

- [x] lint and TypeScript typecheck
- [x] 23 TypeScript tests and 4 Rust regular tests
- [x] local OCR health check: image PDF → Poppler → Tesseract
- [x] real minimal DeepL integration check without outputting the API Key
- [x] DOCX OOXML package validation
- [x] unsigned debug installer build: MSI + NSIS
- [ ] clean install / upgrade / uninstall
- [ ] E2E happy path, visual regression, large-file test
- [x] source/Git key scan, production dependency audit and privacy data-flow documentation
- [ ] final installer artifact scan and third-party redistribution-license audit
