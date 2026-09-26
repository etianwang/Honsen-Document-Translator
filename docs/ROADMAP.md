# Roadmap

## Phase 0 — Architecture (complete)

- [x] pnpm workspace, Tauri + React shell, strict TypeScript, ESLint, Vitest, CI-ready scripts
- [x] Architecture, DIR, roadmap, and decisions documents
- [x] `document-model` interfaces and a contract test

## Phase 1 — Round trip (in progress)

- [x] PDF.js raw text extraction with page geometry and a verified fixture
- [x] Text item to line, paragraph, and block layout reconstruction
- [x] Semantic DOCX generation and desktop PDF export (LibreOffice first, Word fallback)
- [x] Fixture-backed PDF -> DOCX integration test and render QA
- [x] Rule-based tables, repeated headers/footers, page numbers, and simple embedded RGB images

## Phase 2 — Translation

- [x] Mock translator and run-level translation mapping
- [ ] Real provider adapters, glossary, translation memory, and overflow fitting

## Phase 3 — OCR

- [ ] Page-level text/scanned/hybrid detection and OCR provider support

## Phase 4 — Advanced layout

- [ ] Columns, complex tables, floating objects, shapes, notes, and lists
