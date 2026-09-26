# Release Checklist

Do not release while any P0 item in `PRODUCTION_AUDIT.md` remains open.

- [x] lint (2026-09-26)
- [x] typecheck (2026-09-26)
- [x] unit tests: 11 TypeScript + 2 Rust boundary tests (2026-09-26)
- [ ] integration tests
- [ ] E2E happy path
- [ ] visual regression
- [ ] large-file test
- [x] local OCR engine health check: image PDF → Poppler → Tesseract (2026-09-26; English development language pack)
- [ ] DeepL integration test without exposing a key
- [x] DOCX OOXML package validation (2026-09-26; required parts and main relationship)
- [ ] PDF export with LibreOffice
- [x] debug installer build: MSI + NSIS (2026-09-26; unsigned, not releasable)
- [ ] clean install / upgrade / uninstall
- [ ] GUI human-path regression (desktop automation unavailable in this environment)
- [ ] no bundled API key or secret
- [ ] privacy and dependency audit
