# Architecture Decisions

## ADR-001: Preserve a semantic DIR between pipeline stages

**Problem:** PDF drawing commands do not directly represent editable document structure.

**Current design:** PDF parsing produces raw elements; a layout engine produces versioned DIR; DOCX generation consumes DIR.

**Reason:** It isolates parser choices, supports future OCR, and makes DOCX output editable rather than a page image.

**Impact:** Each pipeline package must depend only on `document-model`, not directly on a neighboring implementation.

## ADR-002: Root desktop app with workspace packages

**Problem:** Phase 0 needs a runnable desktop shell and a reusable model without empty speculative packages.

**Current design:** The Tauri + React app stays at the repository root; reusable domain code starts in `packages/document-model`.

**Reason:** It is the smallest pnpm monorepo shape that preserves future package boundaries.

**Impact:** Parser, layout, translation, and DOCX packages are created only as their phases begin.

## ADR-003: PDF exporter uses Word only when LibreOffice is unavailable

**Problem:** The configured environment has Microsoft Word but no `soffice.exe`.

**Current design:** The desktop command tries headless LibreOffice first. If it is unavailable or fails, it uses Word COM to create the PDF.

**Reason:** The MVP must produce a PDF and report a meaningful failure rather than expose a non-functional export button.

**Impact:** LibreOffice remains the primary production path. The Word fallback is Windows-only and can be removed when a bundled LibreOffice runtime is supplied.
