# OCR Language Support

`src-tauri/resources/tessdata` contains `osd.traineddata` and the 21 language packs below (about 77.4 MB total), sourced from Tesseract's official `tessdata_fast` project. The application resources additionally stage Tesseract and Poppler executables with their Windows runtime dependencies. Before a formal release, this still requires a clean-machine installation test and third-party redistribution-license review.

| UI language | Tesseract pack | Text direction |
| --- | --- | --- |
| 中文（简体） | `chi_sim` | LTR |
| 中文（繁体） | `chi_tra` | LTR |
| 英语 | `eng` | LTR |
| 法语 | `fra` | LTR |
| 西班牙语 | `spa` | LTR |
| 德语 | `deu` | LTR |
| 葡萄牙语 | `por` | LTR |
| 日语 | `jpn` | LTR |
| 韩语 | `kor` | LTR |
| 俄语 | `rus` | LTR |
| 匈牙利语 | `hun` | LTR |
| 哈萨克语 | `kaz` | LTR |
| 阿拉伯语 | `ara` | RTL |
| 波斯语 | `fas` | RTL |
| 荷兰语 | `nld` | LTR |
| 土耳其语 | `tur` | LTR |
| 波兰语 | `pol` | LTR |
| 挪威语 | `nor` | LTR |
| 瑞典语 | `swe` | LTR |
| 芬兰语 | `fin` | LTR |
| 乌克兰语 | `ukr` | LTR |

Arabic and Persian are not treated as a special OCR-only case. OCR geometry is transformed into PDF coordinates, RTL runs are ordered from right to left, the editor uses `dir="rtl"`, and DOCX paragraphs/runs use OOXML bidirectional properties. Mixed RTL/LTR paragraphs require visual regression fixtures before release.

## Hybrid-PDF policy

OCR runs only for pages classified as `scanned`. Hybrid pages with embedded selectable text do not OCR their images: photographs, signatures, seals, and other embedded graphics remain unchanged. This avoids accidentally translating a seal or signature and preserves the original visual evidence. The current PDF parser preserves basic RGB images; uncommon image encodings and vector-only seals still need production fidelity fixtures.
