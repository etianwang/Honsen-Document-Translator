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
  $conversion = Start-Process -FilePath $soffice -ArgumentList @('--headless', $profileArg, '--convert-to', 'pdf', '--outdir', ([System.IO.Path]::GetTempPath()), $docx) -PassThru
  try { Wait-Process -Id $conversion.Id -Timeout 60 -ErrorAction Stop } catch { if (-not (Test-Path -LiteralPath $pdf)) { throw 'Bundled LibreOffice did not finish the DOCX export fixture.' } }
  if (Get-Process -Id $conversion.Id -ErrorAction SilentlyContinue) { Stop-Process -Id $conversion.Id -Force; Wait-Process -Id $conversion.Id -ErrorAction SilentlyContinue }
  if (-not (Test-Path -LiteralPath $pdf) -or (Get-Item -LiteralPath $pdf).Length -eq 0) { throw 'Bundled LibreOffice could not export the DOCX fixture.' }

  Write-Host 'Installed-runtime verification passed: Inno install, bundled Poppler/Tesseract OCR, bundled LibreOffice PDF export, and uninstall.'
}
finally {
  $image = "$imagePrefix.png"
  if (Test-Path -LiteralPath $image) { Remove-Item -LiteralPath $image -Force }
  foreach ($path in @($docx, $pdf)) { if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force } }
  if (Test-Path -LiteralPath $profile) { Remove-Item -LiteralPath $profile -Recurse -Force }
  $uninstaller = Join-Path $installRoot 'unins000.exe'
  if (Test-Path -LiteralPath $uninstaller) {
    $uninstall = Start-Process -FilePath $uninstaller -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART') -Wait -PassThru
    if ($uninstall.ExitCode -ne 0) { throw "Uninstaller exited with code $($uninstall.ExitCode)." }
  }
  if (Test-Path -LiteralPath $installRoot) { throw "Installer cleanup failed: $installRoot" }
}
