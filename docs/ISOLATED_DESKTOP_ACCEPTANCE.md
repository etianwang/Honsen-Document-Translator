# 隔离 Windows 验收准备（NOT RUN）

当前集成尚未完成，不可发布。此清单不代表验收通过，也不授权在正式电脑上安装或卸载。

## 环境和前置条件

- 使用专用 Windows 10/11 虚拟机，创建可恢复快照；禁止共享正式用户配置、真实文档、凭据和安装目录。准备标准用户及管理员凭据，以测试 UAC 同意和拒绝。
- 使用测试专用构建及受控更新源；记录安装器、主 EXE、Runner、Manifest、版本和 SHA-256。不要修改正式 GitHub Release。
- 至少准备 NTFS 虚拟磁盘及含空格、中文的安装路径；其他支持文件系统和硬链接能力须另行确认。保留 VM 快照、登记导出和虚拟数据哈希供比较。
- 在四个注册表视图无正式应用登记的干净快照中运行；若存在任何正式数据或登记，停止。当前安装器四视图判断与 Runner UAC 尚未完成，不得将以下步骤标记通过。

## 只读环境记录（在 VM 内）

```powershell
Get-ComputerInfo | Select-Object WindowsProductName, WindowsVersion, OsHardwareAbstractionLayer
Get-Volume | Select-Object DriveLetter, FileSystem, HealthStatus
whoami /groups
reg query "HKLM\Software\Honsen Program\Apps\honsen.document-translator" /reg:64
reg query "HKLM\Software\Honsen Program\Apps\honsen.document-translator" /reg:32
reg query "HKCU\Software\Honsen Program\Apps\honsen.document-translator" /reg:64
reg query "HKCU\Software\Honsen Program\Apps\honsen.document-translator" /reg:32
Get-FileHash -Algorithm SHA256 -LiteralPath '<测试安装器绝对路径>'
```

找不到登记的 `reg query` 可能返回非零；逐条记录，不要用它推断所有视图均已检查。

## 修复完成后执行的验收

1. 从快照首次安装到 Unicode 路径，记录四视图登记、Windows 卸载登记、Manifest、EXE 和 Runner；验证开始菜单与工具箱启动。再次安装到不同目录，验证拒绝；另测损坏登记及冲突登记。
2. 在每次试验前恢复快照；使用独立 GUID 和结果文件，分别验证应用和工具箱 apply、原目录不变、UAC 同意/拒绝、错误哈希、错误目标目录、错误 PID、非零退出码及安装后版本不符。记录退出码、结果 JSON、安装器日志和进程状态。符号链接与目录逃逸应在 VM 临时目录构造，不能指向宿主机文件。
3. 在 VM 创建测试用户数据及其他应用标记文件并记录 `Get-FileHash`，执行被测卸载器后再次计算哈希，检查仅本应用登记被删除；验证共享父目录、其他产品及数据仍存在。
4. 现有 `pnpm verify:installed-runtime` 会进行真实安装和卸载，只能在检查其当前内容、确认隔离并恢复干净快照后使用；它不覆盖上述完整验收。所有安装、更新、卸载及数据保留试验当前均为 **NOT RUN**。

回滚使用 VM 快照；不要假定运行旧安装器是安全降级。记录每次快照、命令、输出和失败项，未经全部验证不得将集成标记为可自动安装或更新。
