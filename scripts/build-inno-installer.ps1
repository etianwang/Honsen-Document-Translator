$ErrorActionPreference = 'Stop'
$installedCompiler = Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'Inno Setup*' -and $_.InstallLocation } | ForEach-Object { Join-Path $_.InstallLocation 'ISCC.exe' }
$compiler = @("${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "${env:ProgramFiles}\Inno Setup 6\ISCC.exe") + $installedCompiler | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $compiler) { throw 'Inno Setup 6 is required. Install it, then rerun this script.' }
if (-not (Test-Path -LiteralPath 'src-tauri/target/release/tauri-app.exe')) { throw 'Release EXE not found. Run pnpm tauri build first.' }
if (-not (Test-Path -LiteralPath 'src-tauri/target/release/HonsenUpdateRunner.exe')) { throw 'Update runner EXE not found. Run pnpm tauri build first.' }
& $compiler 'installer/Honsen-PDF-Translator.iss'
if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed with exit code $LASTEXITCODE." }
