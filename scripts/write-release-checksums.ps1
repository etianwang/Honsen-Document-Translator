$ErrorActionPreference = 'Stop'
$installer = Get-Item -LiteralPath 'src-tauri/target/release/installer/Honsen-Document-Translator-Setup.exe' -ErrorAction SilentlyContinue
if (-not $installer) { throw 'Inno Setup installer not found. Run scripts/build-inno-installer.ps1 first.' }
$stream = [System.IO.File]::OpenRead($installer.FullName)
try { $hash = -join ([System.Security.Cryptography.SHA256]::Create().ComputeHash($stream) | ForEach-Object { $_.ToString('x2') }) }
finally { $stream.Dispose() }
$checksums = @{ version = (Get-Content -Raw 'src-tauri/tauri.conf.json' | ConvertFrom-Json).version; assets = @(@{ name = $installer.Name; sha256 = $hash }) } | ConvertTo-Json
[System.IO.File]::WriteAllText((Join-Path $installer.DirectoryName 'SHA256SUMS.json'), $checksums, [System.Text.UTF8Encoding]::new($false))
Write-Host 'Wrote SHA-256SUMS.json for the Inno Setup installer.'
