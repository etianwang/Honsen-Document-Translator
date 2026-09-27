param([string]$Source = 'C:\Program Files\LibreOffice')

$ErrorActionPreference = 'Stop'
$target = Join-Path $PSScriptRoot '..\src-tauri\resources\libreoffice'
$sourceProgram = Join-Path $Source 'program\soffice.exe'
if (-not (Test-Path -LiteralPath $sourceProgram) -or -not (Test-Path -LiteralPath (Join-Path $Source 'share'))) {
  throw "LibreOffice is incomplete or unavailable at $Source. Install it, or pass -Source with its installation directory."
}
if ((Test-Path -LiteralPath $target) -and ((Resolve-Path -LiteralPath $target).Path -eq (Resolve-Path -LiteralPath $Source).Path)) {
  throw 'The staging destination must not be the installed LibreOffice directory.'
}
New-Item -ItemType Directory -Force -Path $target | Out-Null
& robocopy $Source $target /MIR /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -gt 7) { throw "LibreOffice staging failed (robocopy exit code $LASTEXITCODE)." }
if (-not (Test-Path -LiteralPath (Join-Path $target 'program\soffice.exe'))) { throw 'LibreOffice staging did not produce soffice.exe.' }
Get-ChildItem -LiteralPath $target -Recurse -File | Measure-Object Length -Sum | ForEach-Object { "LibreOffice staged: $([math]::Round($_.Sum / 1MB, 1)) MB at $target" }
