# 干净 Windows 虚拟机验收记录

此记录是正式稳定版的 P0 门禁；开发机上的 `pnpm verify:installed-runtime` 不能替代它。每次候选版本单独填写一份，附终端输出与截图。

## 环境

- Windows 版本与架构：
- VM 快照/镜像标识：
- 候选版本、Release URL、安装包 SHA-256：
- 预装软件检查：`Get-Command tesseract,pdftoppm,soffice -ErrorAction SilentlyContinue` 的输出必须为空。

## 安装与 OCR

1. 从 GitHub Release 下载当前发布的安装包和 `SHA256SUMS.json`，校验下载文件的 SHA-256。
2. 静默安装到临时目录，或通过图形安装器确认中文安装界面、桌面快捷方式和开始菜单名称均为“`Honsen 文档翻译器`”。
3. 导入一份扫描报价单，选择对应 OCR 语言，确认能出现可编辑的识别结果且不会提示缺少 Poppler/Tesseract。
4. 导入一份纯文字 PDF 与一份混合 PDF，确认导入失败时显示用户可理解的错误，且混合页的图片/签名未被 OCR 改写。

## 翻译与导出

1. 使用测试专用 DeepL Key 分别翻译文字、扫描、混合三份样本；不得记录或截图 API Key。
2. 导出 DOCX 与 PDF；在 VM 中用内置 LibreOffice 打开 PDF，并在外部 Word 或 LibreOffice 中检查 DOCX。
3. 对文字、表格、图片、页眉页脚和 RTL 样本保存前后对照截图；记录所有布局降级或失败页码。

## 升级、卸载与证据

1. 从上一稳定版安装后升级到候选版，确认应用仍能启动、固定快捷方式保持可用。
2. 卸载候选版，确认程序目录已删除，且不修改其他桌面、开始菜单或任务栏快捷方式。
3. 保存：安装日志、版本号、样本 SHA-256、OCR/导出截图、失败复现步骤与许可证审计结论。

只有所有项目通过且第三方许可证审计确认后，才能在 [`TASKS.md`](TASKS.md) 勾选对应 P0。
