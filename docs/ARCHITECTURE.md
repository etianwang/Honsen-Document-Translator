# Architecture

## Scope

Phase 0 establishes the desktop shell and shared Document Intermediate Representation (DIR). It intentionally contains no PDF parsing, translation, OCR, DOCX generation, or export implementation.

## Data flow

`PDF parser -> raw DIR -> layout engine -> DIR -> translator -> DIR -> DOCX engine -> DOCX -> PDF exporter`

Each arrow crosses a package boundary. A producer emits plain, serializable domain data; consumers do not import producer-specific objects. The desktop UI coordinates services and renders state only.

## Planned packages

| Package | Owns | Does not own |
| --- | --- | --- |
| `document-model` | DIR types, errors, processing state | PDF.js, UI, I/O |
| `pdf-parser` | PDF.js raw page extraction | paragraph/table semantics |
| `layout-engine` | runs, lines, paragraphs, blocks, reading order | translation, DOCX |
| `translation-engine` | segment batching and provider adapters | PDF/DOCX handling |
| `docx-engine` | semantic Word generation from DIR | PDF parsing |
| `desktop` | Tauri commands, user interaction, progress | document semantics |

## Failure and observability

Services return typed failures using `DocumentErrorCode`; UI maps them to actionable messages. Structured logs use `debug`, `info`, `warning`, and `error`, and must include page and document identifiers where applicable. No API key is stored in source code; future cloud providers receive text segments only.

## Execution model

Parsing, layout, translation, and generation run outside React rendering. The implementation choice (worker thread or Tauri background command) belongs to the package introducing the workload. Preview rendering is lazy around the active page.

## Tests

Unit tests protect DIR contracts and pure layout logic. Later integration tests exercise PDF -> DIR -> DOCX -> PDF. Visual regression uses fixture PDFs, generated-page PNGs, and pixel-difference artifacts. Fixtures live under `tests/fixtures` when parsing begins.
