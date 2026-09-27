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

## ADR-003: Portable PDF exporter bundles LibreOffice

**Problem:** Customer machines must export PDF without Microsoft Office or a separate LibreOffice installation.

**Current design:** The release build stages the installed LibreOffice runtime under `src-tauri/resources/libreoffice`, then Tauri bundles it beside the app. The exporter prefers that bundled `soffice.exe` and gives it a per-export temporary profile.

**Reason:** LibreOffice is the smallest established local DOCX-to-PDF engine available here that works on a customer machine without requiring Microsoft Office.

**Impact:** The installer grows by about 681 MB and must include LibreOffice license/notice files (staged with the runtime). Word remains a development fallback only.
