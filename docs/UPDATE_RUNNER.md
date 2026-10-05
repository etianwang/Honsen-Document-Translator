# 文档翻译器更新逻辑与 Honsen 工具箱联动

本文记录 Honsen 文档翻译器当前 Windows 更新协议，供 Honsen 工具箱与发布流程校对。

## 固定身份

| 项目 | 值 |
| --- | --- |
| appId | `honsen.document-translator` |
| 主程序 | `HonsenPdfTranslator.exe` |
| 更新执行器 | `HonsenUpdateRunner.exe` |
| 安装描述文件 | `<InstallLocation>\honsen.app.json` |
| 更新源 | GitHub `releases/latest` API |

Runner 是唯一允许安装、替换、验证和重启应用的组件。Runner 和工具箱可以下载，但下载方必须校验 SHA-256；任何下载方都只能把已校验安装包交给 Runner。主程序不下载、不安装、不替换文件，只做 Runner 健康检查和唤起。工具箱不得直接启动 Inno 或覆盖应用文件。

## 注册表与识别文件

全电脑安装使用：

```text
HKLM\Software\Honsen Program\Apps\honsen.document-translator
```

安装器写入：

```text
AppId              = honsen.document-translator
DisplayName        = Honsen Document Translator
Version            = <安装版本>
InstallLocation    = <唯一安装目录>
ExecutablePath     = <InstallLocation>\HonsenPdfTranslator.exe
LauncherPath       = <InstallLocation>\HonsenUpdateRunner.exe
UpdateRunnerPath   = <InstallLocation>\HonsenUpdateRunner.exe
UpdateManifestUrl  = https://api.github.com/repos/etianwang/Honsen-Document-Translator/releases/latest
UpdateUrl          = 同 UpdateManifestUrl（兼容字段）
InstallScope       = machine
Publisher          = Honsen
```

同目录 `honsen.app.json` 为 UTF-8，标准字段包括：`schemaVersion`、`appId`、`displayName`、`version`、`executable`、`publisher`、`updateManifestUrl` 与 `updateRunner`。

Runner 每次更新前确认固定 appId、注册表的安装目录/主程序/Runner 路径、`honsen.app.json` 一致。不会按显示名猜测路径、扫描磁盘、迁移目录或创建第二个安装实例。

## 启动与更新

开始菜单、桌面快捷方式和工具箱“打开”均调用：

```text
<LauncherPath> launch
```

快捷方式显式使用 `HonsenPdfTranslator.exe` 的图标。

`launch` 流程：

```text
校验注册表与 honsen.app.json
→ 请求 UpdateManifestUrl
→ 无更新：启动 ExecutablePath
→ 有更新：显示版本、Release 说明、立即更新/稍后提醒/跳过此版本
→ 下载安装包并校验 SHA-256
→ 由同一 Runner 执行 apply
→ 验证并重启新版主程序
```

选择“稍后提醒”时启动当前版本，下次启动仍提示。选择“跳过此版本”时写入：

```text
%LOCALAPPDATA%\Honsen Program\UpdatePreferences\honsen.document-translator.json
```

记录的 `skipVersion` 仅抑制该目标版本；出现更高版本时会再次提示。删除该文件即可重新测试跳过逻辑。

## 工具箱调用

工具箱更新前自行下载并校验 SHA-256，但只能让 Runner 安装：

```text
<UpdateRunnerPath> apply ^
  --source toolbox ^
  --app-id honsen.document-translator ^
  --wait-pid 0 ^
  --installer "C:\\Temp\\Honsen-Document-Translator-Setup.exe" ^
  --sha256 "<已校验 SHA-256>" ^
  --target-dir "<InstallLocation>" ^
  --expected-version "<目标版本>" ^
  --restart false ^
  --operation-id "<GUID>" ^
  --result-path "%LOCALAPPDATA%\\Honsen Program\\UpdateResults\\honsen.document-translator\\<GUID>.json"
```

`--restart true` 时，Runner 仅通过更新后重新读取并验证的 `ExecutablePath` 启动程序。

## apply 安全流程

```text
复制 Runner 至 %TEMP%\Honsen Program\UpdateRunner\<随机目录>\
→ 获取 Global\HonsenUpdate-honsen_document-translator 互斥锁
→ 验证身份、目标目录与 SHA-256
→ 等待目标 PID 最多 30 秒
→ 仅路径严格匹配 ExecutablePath 时才可结束超时旧进程
→ 静默运行 Inno 覆盖注册表记录的原目录
→ 检查退出码、日志、注册表、manifest、EXE 文件版本
→ 写入结果并按 restart 参数决定是否重启
```

Inno 固定参数：

```text
/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-
/DIR="<InstallLocation>"
/LOG="<本地日志路径>"
```

成功要求：退出码为 0、日志存在、安装目录未变、主程序和 Runner 仍在原目录、注册表版本、JSON 版本和主 EXE 版本均为目标版本。

## 结果文件

每次操作使用独立的结果文件：

```text
%LOCALAPPDATA%\Honsen Program\UpdateResults\honsen.document-translator\<operationId>.json
```

工具箱调用应传入：

```text
--operation-id <GUID>
--result-path "%LOCALAPPDATA%\Honsen Program\UpdateResults\honsen.document-translator\<GUID>.json"
```

工具箱只读取自己传入的结果文件。固定结果字段为：

```text
operationId
appId
status
source
fromVersion
toVersion
step
installerExitCode
installerLogPath
message
completedAtUtc
```

结果另附安装目录和主程序路径，便于展示与诊断。

## 主程序职责

主程序只读取自身运行目录的 `honsen.app.json`，确认 Runner 与注册表身份一致，并调用 Runner。它不应下载、替换或直接安装自身文件。Runner 缺失或注册表/JSON 不一致时，应显示“更新服务异常，请通过 Honsen 工具箱修复”。

## 安装与卸载

- 首次安装可选择目录。
- 已存在相同 appId 时，安装器拒绝在不同目录建立第二份安装；更新/修复只能使用原 `InstallLocation`。
- 卸载只删除本应用 `{app}` 内文件和 `honsen.document-translator` 专属注册表键。
- 不删除 `C:\Program Files\Honsen Program` 共享父目录，也不删除其他 Honsen 应用的注册表项或文件。

## 校验清单

1. 安装后检查注册表值、`honsen.app.json` 与 `HonsenUpdateRunner.exe`。
2. 启动快捷方式：无更新时应启动主程序；有更新时应显示三选项提示。
3. 点“稍后提醒”：本次启动主程序，下次仍提示。
4. 点“跳过此版本”：本次启动主程序，下次不提示相同版本；删除偏好 JSON 后再次提示。
5. 工具箱 `apply --restart false` 后读取结果文件，显示“更新完成，可打开”。
6. 卸载文档翻译器后确认其他 `Honsen Program` 子目录与其他 appId 注册表键仍存在。
