# Agent 项目导航

这是 Windows 文档翻译桌面应用，前端使用 React/TypeScript，桌面后端使用 Tauri/Rust，工作区使用 pnpm。先阅读 [README](README.md) 了解功能与开发命令。

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

文档有冲突时，以相关代码、配置和当前测试为依据；历史测试通过记录不代表当前版本已通过。改动契约时同步更新相关文档和引用，不要把计划描述为已实现。

## 常用验证

按改动范围选择 `pnpm test`、`pnpm typecheck`、`pnpm lint` 和 `pnpm build`；Rust 或安装器相关改动还需检查对应测试及 `package.json` 中的发布、安装验证命令。实际运行结果优先于旧文档中的通过记录。
