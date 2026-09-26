# Document Intermediate Representation (DIR)

DIR is the versioned, JSON-serializable representation passed between document-processing packages. Coordinates use PDF points with origin and rotation retained from the source page.

## Hierarchy

`DocumentModel -> DocumentPage -> DocumentBlock -> ParagraphModel -> TextLine -> TextRun`

`DocumentBlock` is a discriminated union of `text`, `table`, and `image`. Text blocks preserve `readingOrder`; table cells contain paragraphs rather than flattened strings. Pages preserve geometry and margins. Sections preserve per-range page geometry plus semantic headers and footers.

## Styling and fonts

`TextStyle` stores source font identity, resolved family candidates, size, decoration, colors, spacing, baseline shift, and rotation. Font resolution is centralized and yields `ResolvedFont`; renderers apply configured fallbacks rather than hard-coding a font.

## Translation

Translation operates on `TranslationSegment`, which links a contextual source string to one or more element IDs. `translatedText` is stored on the matching run after mapping. This prevents individual drawing instructions from being translated without context.

## Extension contracts

The model also publishes boundary contracts for future adapters: `OcrProvider`, `Translator`, and `PdfExporter`. OCR returns positioned and confidence-scored text, translators receive segments rather than PDF objects, and exporters receive only input/output paths.

## Compatibility

The root `version` is currently `1`. Additive optional fields are permitted within a version. Breaking structural changes require a new version and a migration plan recorded in Architecture Decisions.
