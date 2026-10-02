import json
import os
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
S = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def keep(value):
    value = value.strip()
    return not value or all(character.isdigit() or character in " .,:/%+-×xX" for character in value) or (len(value) <= 4 and value.upper() == value)


def deepl(values, target, source, glossary):
    items = [(index, value) for index, value in enumerate(values) if not keep(value)]
    translated = list(values)
    if not items:
        return translated
    endpoint = "https://api-free.deepl.com/v2/translate" if os.environ["DEEPL_API_KEY"].endswith(":fx") else "https://api.deepl.com/v2/translate"
    terms = {entry["source"].strip(): entry["target"].strip() for entry in glossary}
    for start in range(0, len(items), 50):
        batch = items[start:start + 50]
        fields = [("text", value) for _, value in batch] + [("target_lang", target)]
        if source:
            fields.append(("source_lang", source))
        request = urllib.request.Request(endpoint, data=urllib.parse.urlencode(fields).encode(), headers={"Authorization": "DeepL-Auth-Key " + os.environ["DEEPL_API_KEY"]})
        response = json.loads(urllib.request.urlopen(request, timeout=45).read())["translations"]
        if len(response) != len(batch):
            raise RuntimeError("DEEPL_INVALID_RESPONSE")
        for (index, value), result in zip(batch, response):
            translated[index] = terms.get(value.strip(), result["text"])
    return translated


def replace_nodes(groups, target, source, glossary):
    values = ["".join(node.text or "" for node in nodes) for nodes in groups]
    for nodes, translation in zip(groups, deepl(values, target, source, glossary)):
        if not nodes or translation == "".join(node.text or "" for node in nodes):
            continue
        nodes[0].text = translation
        for node in nodes[1:]:
            node.text = ""


def xml_bytes(root):
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def translate_word(parts, target, source, glossary):
    for name, data in list(parts.items()):
        root = ET.fromstring(data)
        groups = [[node for node in paragraph.iter(W + "t")] for paragraph in root.iter(W + "p")]
        replace_nodes(groups, target, source, glossary)
        parts[name] = xml_bytes(root)


def translate_presentation(parts, target, source, glossary):
    for name, data in list(parts.items()):
        root = ET.fromstring(data)
        groups = [[node for node in paragraph.iter(A + "t")] for paragraph in root.iter(A + "p")]
        replace_nodes(groups, target, source, glossary)
        parts[name] = xml_bytes(root)


def translate_spreadsheet(parts, target, source, glossary):
    shared = "xl/sharedStrings.xml"
    if shared in parts:
        root = ET.fromstring(parts[shared])
        groups = [[node for node in item.iter(S + "t")] for item in root.iter(S + "si")]
        replace_nodes(groups, target, source, glossary)
        parts[shared] = xml_bytes(root)
    for name, data in list(parts.items()):
        if not re.fullmatch(r"xl/worksheets/sheet\d+\.xml", name):
            continue
        root = ET.fromstring(data)
        groups = []
        for cell in root.iter(S + "c"):
            if cell.find(S + "f") is None:
                inline = cell.find(S + "is")
                if inline is not None:
                    groups.append([node for node in inline.iter(S + "t")])
        replace_nodes(groups, target, source, glossary)
        parts[name] = xml_bytes(root)


def split_markdown(text):
    parts, values = [], []
    def add(value):
        match = re.match(r"^(\s*)(.*?)(\s*)$", value, flags=re.S)
        prefix, body, suffix = match.groups()
        parts.append(prefix)
        if keep(body):
            parts.append(body)
        else:
            parts.append(len(values))
            values.append(body)
        parts.append(suffix)
    def inline(value):
        cursor = 0
        for match in re.finditer(r"\`[^\`]*\`|(!?\[)([^\]]*)(\]\([^)]+\))|https?://[^\s]+", value):
            add(value[cursor:match.start()])
            if match.group(2) is not None:
                parts.append(match.group(1)); add(match.group(2)); parts.append(match.group(3))
            else:
                parts.append(match.group(0))
            cursor = match.end()
        add(value[cursor:])
    fence = False
    front = False
    front_pending = text.startswith("---\n") or text.startswith("---\r\n")
    for raw in text.splitlines(keepends=True):
        line, ending = re.match(r"^(.*?)(\r?\n|\r)?$", raw, flags=re.S).groups()
        if re.match(r"^\s*(\`\`\`|~~~)", line):
            fence = not fence; parts.extend([line, ending or ""]); continue
        if front_pending:
            front_pending = False; front = True; parts.extend([line, ending or ""]); continue
        if front and line.strip() == "---":
            front = False; parts.extend([line, ending or ""]); continue
        if fence:
            parts.extend([line, ending or ""]); continue
        if front:
            match = re.match(r"^(\s*[^:#][^:]*:\s*)(.*)$", line)
            if match:
                parts.append(match.group(1)); inline(match.group(2))
            else:
                parts.append(line)
        elif "|" in line and not re.fullmatch(r"[\s|:-]+", line):
            cells = line.split("|")
            for index, cell in enumerate(cells):
                inline(cell)
                if index < len(cells) - 1:
                    parts.append("|")
        else:
            match = re.match(r"^(\s*(?:#{1,6}\s+|>\s*|[-+*]\s+|\d+[.)]\s+)?)(.*)$", line)
            parts.append(match.group(1)); inline(match.group(2))
        parts.append(ending or "")
    return parts, values


def read_text(path):
    raw = open(path, "rb").read()
    if raw.startswith(b"\xff\xfe"): return raw[2:].decode("utf-16le"), "utf-16le", b"\xff\xfe"
    if raw.startswith(b"\xfe\xff"): return raw[2:].decode("utf-16be"), "utf-16be", b"\xfe\xff"
    if raw.startswith(b"\xef\xbb\xbf"): return raw[3:].decode("utf-8"), "utf-8", b"\xef\xbb\xbf"
    return raw.decode("utf-8"), "utf-8", b""


def translate_text(source_path, output_path, target, source, glossary, markdown):
    text, encoding, bom = read_text(source_path)
    parts, values = split_markdown(text) if markdown else ([], [])
    if not markdown:
        for raw in text.splitlines(keepends=True):
            content, ending = re.match(r"^(.*?)(\r?\n|\r)?$", raw, flags=re.S).groups()
            parts.extend([len(values), ending or ""]); values.append(content)
    translations = deepl(values, target, source, glossary)
    output = "".join(translations[part] if isinstance(part, int) else part for part in parts)
    with open(output_path, "wb") as output_file:
        output_file.write(bom + output.encode(encoding))


def translate_ooxml(source_path, output_path, kind, target, source, glossary):
    with zipfile.ZipFile(source_path) as archive:
        parts = {name: archive.read(name) for name in archive.namelist()}
    if kind == "word":
        targets = {name: data for name, data in parts.items() if name == "word/document.xml" or re.fullmatch(r"word/(header|footer)\d+\.xml", name)}
        translate_word(targets, target, source, glossary)
    elif kind == "presentation":
        targets = {name: data for name, data in parts.items() if re.fullmatch(r"ppt/(slides/slide|notesSlides/notesSlide)\d+\.xml", name)}
        translate_presentation(targets, target, source, glossary)
    elif kind == "spreadsheet":
        targets = {name: data for name, data in parts.items() if name == "xl/sharedStrings.xml" or re.fullmatch(r"xl/worksheets/sheet\d+\.xml", name)}
        translate_spreadsheet(targets, target, source, glossary)
    else:
        raise RuntimeError("DOCUMENT_UNSUPPORTED_TYPE")
    parts.update(targets)
    with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as output:
        for name, data in parts.items():
            output.writestr(name, data)


def main():
    source_path, output_path, kind, target, source, glossary_json = sys.argv[1:]
    glossary = json.loads(glossary_json)
    if kind in ("text", "markdown"):
        translate_text(source_path, output_path, target, source, glossary, kind == "markdown")
    else:
        translate_ooxml(source_path, output_path, kind, target, source, glossary)


if __name__ == "__main__":
    main()
