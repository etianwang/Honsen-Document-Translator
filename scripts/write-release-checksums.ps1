$ErrorActionPreference = 'Stop'
$bundles = Get-ChildItem -LiteralPath 'src-tauri/target/release/bundle' -Recurse -File -Include '*.msi','*-setup.exe'
if ($bundles.Count -eq 0) { throw 'No release installer found. Run pnpm tauri build first.' }
$bundles | Get-FileHash -Algorithm SHA256 | Select-Object Hash, Path | ConvertTo-Json | Set-Content -LiteralPath 'src-tauri/target/release/bundle/SHA256SUMS.json' -Encoding utf8
Write-Host 'Wrote SHA-256 checksums for release installers.'
