# Architecture

## Scope

The desktop app translates selectable PDF text while retaining the source-page raster, images, stamps, and drawing geometry. The shared Document Intermediate Representation (DIR) carries text, image, and vector-path coordinates in PDF points.

## Data flow

`PDF.js extraction -> raw DIR (text, images, vector paths) -> layout engine -> translation segments -> shared placements -> preview / PDF export`

Each arrow crosses a package boundary. A producer emits plain, serializable domain data; consumers do not import producer-specific objects. The desktop UI coordinates services and renders state only.

## Planned packages

| Package | Owns | Does not own |
| --- | --- | --- |
| `document-model` | DIR types, errors, processing state | PDF.js, UI, I/O |
| `pdf-parser` | PDF.js raw text, image, and vector-path extraction | paragraph/table semantics |
| `layout-engine` | runs, paragraphs, blocks, vector-cell tables, reading order | translation, DOCX |
| `translation-engine` | segment batching and provider adapters | PDF/DOCX handling |
| `docx-engine` | semantic Word generation from DIR | PDF parsing |
| `desktop` | Tauri commands, user interaction, progress | document semantics |

## Failure and observability

Services return typed failures using `DocumentErrorCode`; UI maps them to actionable messages. Structured logs use `debug`, `info`, `warning`, and `error`, and must include page and document identifiers where applicable. No API key is stored in source code; future cloud providers receive text segments only.

## Execution model

Parsing, layout, translation, and generation run outside React rendering. The implementation choice (worker thread or Tauri background command) belongs to the package introducing the workload. Preview rendering is lazy around the active page.

## Layout V2

For pages containing connected vector-cell rectangles, the layout engine treats the rectangles as table cells and assigns text to a cell by its center point. A cell is the writable region; a visual row is never used as the writable region for a vector table. Images remain independent blocks and are treated as obstacles by the translation-placement fallback.

Pages without enough connected vector rectangles retain the existing text-coordinate fallback. This is intentional: scanned pages, unbordered tables, and decorative paths do not provide reliable grid geometry. See [Layout V2](LAYOUT_V2.md) for scope and manual validation.

## Tests

Unit tests protect DIR contracts and pure layout logic. Later integration tests exercise PDF -> DIR -> DOCX -> PDF. Visual regression uses fixture PDFs, generated-page PNGs, and pixel-difference artifacts. Fixtures live under `tests/fixtures` when parsing begins.
