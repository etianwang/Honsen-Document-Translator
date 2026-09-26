# PDF Translator Desktop

An offline-first Windows desktop workflow for opening a PDF, reconstructing its text, translating with DeepL, and exporting DOCX or PDF.

## Local setup

Copy `.env.example` to `.env` and add your DeepL API key:

```text
DEEPL_API_KEY=your-key
```

The renderer never reads this file or sends the key to JavaScript. The Tauri backend reads it at request time and communicates with DeepL over HTTPS.

## OCR

Scanned PDF pages use local Poppler rendering and Tesseract OCR; no document is sent to an OCR cloud service. The application bundles 21 language packs plus Tesseract's orientation-and-script detector, but development currently expects `pdftoppm` on `PATH` and Tesseract at `C:\Program Files\Tesseract-OCR\tesseract.exe`. A production installer must still bundle the Poppler and Tesseract executables before release.

Only pages classified as fully scanned are sent through OCR. For hybrid PDFs that already contain selectable text, embedded images, signatures, and seals remain part of the original page instead of being OCR-translated. See [the OCR policy](docs/OCR.md).

## Development and verification

```powershell
pnpm install
pnpm test
pnpm typecheck
pnpm lint
pnpm b
pnpm tauri dev
```

For the current release audit and remaining blockers, see `docs/PRODUCTION_AUDIT.md` and `docs/RELEASE_CHECKLIST.md`.
