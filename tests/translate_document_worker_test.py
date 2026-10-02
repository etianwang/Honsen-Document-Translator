import runpy
import unittest


worker = runpy.run_path("src-tauri/resources/scripts/translate_document.py")


class MarkdownProtectionTest(unittest.TestCase):
    def test_keeps_markdown_structure_and_extracts_only_text(self):
        parts, values = worker["split_markdown"]("---\ntitle: Hello\n---\n# Guide\n[Read](https://example.com)\n")
        self.assertEqual(values, ["Hello", "Guide", "Read"])
        self.assertTrue(any("https://example.com" in part for part in parts if isinstance(part, str)))

    def test_spreadsheet_keeps_formula_and_merged_cells(self):
        source = b'''<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>TEXT</t></is></c><c r="B1"><f>SUM(A2:A3)</f><v>2</v></c></row></sheetData><mergeCells count="1"><mergeCell ref="A1:A2"/></mergeCells></worksheet>'''
        parts = {"xl/worksheets/sheet1.xml": source}
        worker["translate_spreadsheet"](parts, "ZH", "", [])
        result = parts["xl/worksheets/sheet1.xml"]
        self.assertIn(b"SUM(A2:A3)", result)
        self.assertIn(b'mergeCell ref="A1:A2"', result)

    def test_word_replaces_text_without_changing_paragraph_properties(self):
        source = b'''<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Hello</w:t></w:r></w:p></w:body></w:document>'''
        globals_ = worker["translate_word"].__globals__
        original_deepl = globals_["deepl"]
        globals_["deepl"] = lambda values, *_: ["你好" for _ in values]
        try:
            parts = {"word/document.xml": source}
            worker["translate_word"](parts, "ZH", "", [])
        finally:
            globals_["deepl"] = original_deepl
        self.assertIn(b"pStyle", parts["word/document.xml"])
        self.assertIn("\u4f60\u597d".encode(), parts["word/document.xml"])


if __name__ == "__main__":
    unittest.main()
