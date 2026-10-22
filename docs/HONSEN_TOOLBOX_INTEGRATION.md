# Honsen Toolbox 集成状态

本文件记录源码审计状态，不代表端到端验收通过。跨项目事实源及必读顺序见根目录 AGENTS.md。

- appId：`honsen.document-translator`；产品目录：`Honsen Document Translator`；主程序：`HonsenPdfTranslator.exe`；Runner：`HonsenUpdateRunner.exe`；安装器：Inno Setup（machine）。
- 当前构建资产仍为 `Honsen-Document-Translator-Setup.exe`，不符合版本化资产及同名 `.sha256` 要求。Runner 和应用更新入口目前依赖此名称及 `SHA256SUMS.json`，因此不能只改发布文件名；旧安装的迁移也需要协调。
- 快捷方式使用 `launch --app-id honsen.document-translator --source app`。Runner 兼容旧的无参数启动及 Toolbox 附加的 `--wait-pid`、`--operation-id`、`--result-path`。`apply` 参数见 [Runner 说明](UPDATE_RUNNER.md)，但当前实现尚未完全满足统一契约。
- Runner 使用 UAC 请求启动安装器；检查更新失败时启动已验证的应用。上述行为及安装、更新和数据保留仍需隔离环境验收。完整失败结果、Manifest/路径校验、发布 digest 和重复安装仍有缺口；不得据此标记为已通过自动更新验收。
- 旧版硬编码旧资产名与 `SHA256SUMS.json`，无法自动发现仅含规范版本化资产的新 Release。可选择跨项目批准过渡 Release，先将旧版升级到支持新格式的版本；或者提供用户手动运行的新安装器，并验证其仅覆盖原目录。前者需先处理稳定 Release 规范的过渡例外；两条路径均尚未实测。
- 安装、更新、卸载、UAC、Unicode 路径与数据保留的隔离环境端到端验收：**NOT RUN**。
- 安装器不再按名称删除旧快捷方式；不能可靠确认归属的链接保留。
