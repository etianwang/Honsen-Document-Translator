param(
  [string]$Source = 'C:\Program Files\LibreOffice',
  [string]$Target = (Join-Path $PSScriptRoot '..\src-tauri\resources\libreoffice'),
  [ValidateSet('full', 'safe', 'headless')]
  [string]$Mode = 'headless'
)

$ErrorActionPreference = 'Stop'
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

if ($Mode -ne 'full') {
  # These are help/UI assets only. Writer, Calc, Impress, formulas and document
  # conversion components remain intact.
  foreach ($relative in @('help', 'share\gallery', 'share\template', 'share\autotext', 'share\palette')) {
    $path = Join-Path $target $relative
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
  }
}
if ($Mode -eq 'headless') {
  # The application invokes LibreOffice only with --headless, so icon themes are unused.
  Get-ChildItem -LiteralPath (Join-Path $target 'share\config') -Filter 'images_*.zip' -File |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
}

Get-ChildItem -LiteralPath $target -Recurse -File | Measure-Object Length -Sum |
  ForEach-Object { "LibreOffice staged ($Mode): $([math]::Round($_.Sum / 1MB, 1)) MB at $target" }
