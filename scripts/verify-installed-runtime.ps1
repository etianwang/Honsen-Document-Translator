param(
  [string]$Installer = 'src-tauri/target/release/installer/Honsen-PDF-Translator-Setup.exe',
  [string]$Fixture = 'tests/fixtures/01-simple-paragraph.pdf'
)

$ErrorActionPreference = 'Stop'
$installerPath = (Resolve-Path -LiteralPath $Installer).Path
$fixturePath = (Resolve-Path -LiteralPath $Fixture).Path
$installRoot = Join-Path ([System.IO.Path]::GetTempPath()) "honsen-installer-check-$PID"
$imagePrefix = Join-Path ([System.IO.Path]::GetTempPath()) "honsen-ocr-proof-$PID"
$docx = Join-Path ([System.IO.Path]::GetTempPath()) "honsen-export-proof-$PID.docx"
$pdf = [System.IO.Path]::ChangeExtension($docx, 'pdf')
$profile = Join-Path ([System.IO.Path]::GetTempPath()) "honsen-libreoffice-check-$PID"

function Stop-TestLibreOffice([string]$InstallRoot) {
  $expected = Join-Path $InstallRoot 'resources\libreoffice\program\soffice.exe'
  $processes = @(Get-CimInstance Win32_Process -Filter "Name='soffice.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -and $_.ExecutablePath -ieq $expected })
  foreach ($process in $processes) { Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue }
  foreach ($process in $processes) { Wait-Process -Id $process.ProcessId -ErrorAction SilentlyContinue }
}

function Remove-TestInstallRoot([string]$InstallRoot) {
  if (-not (Test-Path -LiteralPath $InstallRoot)) { return }
  $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\') + '\'
  $target = [System.IO.Path]::GetFullPath($InstallRoot)
  if (-not $target.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $target) -notmatch '^honsen-installer-check-\d+$') {
    throw "Refusing to remove an unexpected verification directory: $target"
  }
  Remove-Item -LiteralPath $target -Recurse -Force
}

try {
  $install = Start-Process -FilePath $installerPath -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/DIR=`"$installRoot`"") -Wait -PassThru
  if ($install.ExitCode -ne 0) { throw "Installer exited with code $($install.ExitCode)." }

  $pdftoppm = Join-Path $installRoot 'resources\bin\poppler\pdftoppm.exe'
  $tesseract = Join-Path $installRoot 'resources\bin\tesseract\tesseract.exe'
  $tessdata = Join-Path $installRoot 'resources\tessdata'
  $soffice = Join-Path $installRoot 'resources\libreoffice\program\soffice.exe'
  foreach ($path in @($pdftoppm, $tesseract, (Join-Path $tessdata 'eng.traineddata'), $soffice)) {
    if (-not (Test-Path -LiteralPath $path)) { throw "Missing bundled runtime: $path" }
  }

  & $pdftoppm -f 1 -l 1 -r 300 -png -singlefile $fixturePath $imagePrefix
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath "$imagePrefix.png")) { throw 'Bundled Poppler could not render the OCR fixture.' }
  $ocrText = & $tesseract "$imagePrefix.png" stdout --tessdata-dir $tessdata -l eng --psm 3
  if ($LASTEXITCODE -ne 0 -or ($ocrText -join "`n") -notmatch 'Fixture\s+title') { throw 'Bundled Tesseract did not recognize the OCR fixture.' }

  & node (Join-Path $PSScriptRoot 'create-export-fixture.mjs') $docx
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $docx)) { throw 'Could not create the DOCX export fixture.' }
  $profileArg = "-env:UserInstallation=file:///$($profile.Replace('\\', '/'))"
  & $soffice '--headless' $profileArg '--convert-to' 'pdf' '--outdir' ([System.IO.Path]::GetTempPath()) $docx
  if ($LASTEXITCODE -ne 0) { throw 'Bundled LibreOffice did not start the DOCX export fixture.' }
  $deadline = (Get-Date).AddSeconds(60)
  while (-not (Test-Path -LiteralPath $pdf) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 1 }
  Stop-TestLibreOffice $installRoot
  if (-not (Test-Path -LiteralPath $pdf) -or (Get-Item -LiteralPath $pdf).Length -eq 0) { throw 'Bundled LibreOffice could not export the DOCX fixture.' }

  Write-Host 'Installed-runtime verification passed: Inno install, bundled Poppler/Tesseract OCR, bundled LibreOffice PDF export, and uninstall.'
}
finally {
  Stop-TestLibreOffice $installRoot
  $image = "$imagePrefix.png"
  if (Test-Path -LiteralPath $image) { Remove-Item -LiteralPath $image -Force }
  foreach ($path in @($docx, $pdf)) { if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force } }
  if (Test-Path -LiteralPath $profile) { Remove-Item -LiteralPath $profile -Recurse -Force }
  $uninstaller = Join-Path $installRoot 'unins000.exe'
  if (Test-Path -LiteralPath $uninstaller) {
    $uninstall = Start-Process -FilePath $uninstaller -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART') -Wait -PassThru
    if ($uninstall.ExitCode -ne 0) { throw "Uninstaller exited with code $($uninstall.ExitCode)." }
  }
  Remove-TestInstallRoot $installRoot
  if (Test-Path -LiteralPath $installRoot) { throw "Installer cleanup failed: $installRoot" }
}
