# 隐私说明

最后更新：2026-09-26

## 数据处理方式

- PDF 文件由应用在本机读取和分析。扫描页 OCR 使用本机内置的 Poppler 与 Tesseract，不会发送到 OCR 云服务。
- 用户点击“开始翻译”后，待翻译的文字片段、所选源语言和目标语言会通过 HTTPS 发送至 DeepL。图片、签名、印章和原始 PDF 文件不会发送给 DeepL。
- DeepL API Key 只在本机内存中使用；若用户勾选“记住此密钥”，它存入 Windows Credential Manager。日志和导出文件不会写入 API Key。
- YAML 术语表仅在本机读取。
- 应用不会建立用户账号、行为分析或遥测上传功能。

## 用户可控制的数据

- 可在 Windows Credential Manager 删除已保存的 DeepL API Key，或在应用中关闭“记住此密钥”。
- 导出的 DOCX/PDF 和原始 PDF 均由用户选择保存位置；删除这些本地文件即可移除它们。
- 使用 DeepL 前，请同时阅读 [DeepL 的隐私政策](https://www.deepl.com/privacy)。

## 发布前承诺

正式发布前会完成第三方许可证清单、干净环境安装验证和发行版密钥扫描。此说明会随版本更新。
