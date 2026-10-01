# 第三方运行库审计

审计日期：2026-09-30。此文档记录技术事实，不构成法律意见；正式稳定发布前应由许可证负责人确认。

| 组件 | 当前包内证据 | 上游许可证证据 | 状态 |
| --- | --- | --- | --- |
| Tesseract | `tesseract.exe --version`：5.4.0.20240606；含 Leptonica、libarchive、zlib、libpng 等运行依赖 | [Tesseract](https://github.com/tesseract-ocr/tesseract) 为 Apache-2.0，但其依赖需要逐项归档 | 阻塞：当前 Windows 二进制目录没有许可证、NOTICE 或构建来源记录。 |
| tessdata_fast | 22 个 `.traineddata` 文件 | [tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast) 为 Apache-2.0 | 待在最终分发包附 Apache-2.0 正文与上游归属。 |
| Poppler | `pdftoppm -v`：26.07.0，署名 Poppler Developers 与 Glyph & Cog | [Poppler](https://poppler.freedesktop.org/)；其核心为 GPL 组件 | 阻塞：必须确定该 Windows 构建的准确来源、所有 DLL 许可证、再分发条件与源码提供义务。 |
| LibreOffice | 完整运行时含 `LICENSE.html`、`license.txt`、`NOTICE` | 随运行时提供 | 待人工核对安装器内文件可访问性。 |

## 已验证的安装包事实

- v1.0.2 安装包 SHA-256：`6d3a39ecc599aa6df13b4bc2c1647440a092579c0707cc1f0a51320d13c2b025`；已通过 Inno 安装、内置 Poppler/Tesseract OCR、内置 LibreOffice PDF 导出与卸载验收。
- v1.0.1 安装包 SHA-256：`a26888adff2addf681d561c7decef78483277f4527e8e4a42468d76664b67940`。
- `Get-AuthenticodeSignature` 返回 `NotSigned`；当前版本按内部使用发布，Windows 可能显示未知发布者或 SmartScreen 提示。
- `src-tauri/resources/bin/poppler` 与 `src-tauri/resources/bin/tesseract` 中未找到许可证、NOTICE、COPYING、README 或 AUTHORS 文件。

## 解除条件

1. 将 Poppler 与 Tesseract Windows 构建替换为可追溯来源的固定版本，并记录下载 URL、SHA-256 与构建者。
2. 将所有要求随二进制分发的许可证与 NOTICE 纳入安装包，并在安装目录提供可访问入口。
3. 由许可证负责人确认 Poppler 的分发方案；无法确认时，不得随闭源正式版本分发该二进制。
4. 使用组织代码签名证书签署最终安装包，并重新记录签名和 SHA-256。
