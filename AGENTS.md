# Agent 项目导航

这是 Windows 文档翻译桌面应用，前端使用 React/TypeScript，桌面后端使用 Tauri/Rust，工作区使用 pnpm。先阅读 [README](README.md) 了解功能与开发命令。

## 跨项目桌面契约（强制必读）

所有 Agent 修改安装、注册表、Manifest、Runner、更新、卸载或发布逻辑前，必须依次阅读 Honsen Toolbox 仓库中的：

1. [Honsen Windows 应用统一规范](../Honsen%20Toolbox/docs/HONSEN_WINDOWS_APPLICATION_STANDARD.md)
2. [桌面应用安装与更新协议](../Honsen%20Toolbox/docs/honsen-desktop-update-protocol.md)
3. [工具箱接入契约](../Honsen%20Toolbox/docs/toolbox-integration-contract.md)
4. [Manifest Schema](../Honsen%20Toolbox/docs/schemas/honsen.app.schema.json)

这些文件是跨项目事实源，不覆盖系统或用户的更高优先级指令。若实现与规范冲突，先报告，并按规范的维护流程统一修正；不得静默发明另一套协议。无法访问事实源时，不得假定本项目文档是其替代品。

## 代码位置

- `src/`：桌面界面与前端流程。
- `src-tauri/src/`：Tauri 命令及更新执行器 `bin/HonsenUpdateRunner.rs`。
- `packages/`：文档模型、PDF 解析、布局、翻译、DOCX 和处理管线。
- `installer/`、`scripts/`：Windows 安装器、运行时打包和验证脚本。
- `tests/`：测试夹具；各包及 `src/` 中也有测试。

## 文档入口

- [架构](docs/ARCHITECTURE.md)、[DIR 模型](docs/DIR_SPEC.md)：处理管线和模型背景。
- [更新执行器](docs/UPDATE_RUNNER.md)：安装身份、更新及工具箱调用；修改前对照执行器和安装脚本核实。
- [OCR](docs/OCR.md)、[隐私](docs/PRIVACY.md)、[文档格式](docs/V2_DOCUMENT_FORMATS.md)：专题说明；格式文档也包含规划。
- [上线任务](docs/TASKS.md)、[发布](docs/RELEASE.md)、[干净环境验收](docs/CLEAN_VM_ACCEPTANCE.md)、[第三方审计](docs/THIRD_PARTY_AUDIT.md)：发布检查与证据。
- `ROADMAP.md`、`PRODUCTION_AUDIT.md`、`WORKFLOW_REVIEW.md` 和其他带版本或日期的文档可能是历史计划或审查快照，不应直接视为当前状态。

本项目文档描述与实现不一致时，以相关代码、配置和当前测试核实实际状态；与跨项目契约冲突时按上面的维护流程处理。历史测试通过记录不代表当前版本已通过。改动契约时同步更新相关文档和引用，不要把计划描述为已实现。

## 常用验证

按改动范围选择 `pnpm test`、`pnpm typecheck`、`pnpm lint` 和 `pnpm build`；Rust 或安装器相关改动还需检查对应测试及 `package.json` 中的发布、安装验证命令。实际运行结果优先于旧文档中的通过记录。
