param([string]$PythonExe = 'C:\Users\This PC\AppData\Local\Programs\Python\Python314\python.exe')

$ErrorActionPreference = 'Stop'
$target = Join-Path $PSScriptRoot '..\src-tauri\resources\python'
if (-not (Test-Path -LiteralPath $PythonExe)) { throw "Python is unavailable at $PythonExe. Install Python 3.14 or pass -PythonExe." }
$pythonRoot = Split-Path -Parent (Resolve-Path -LiteralPath $PythonExe)
if ((Test-Path -LiteralPath $target) -and ((Resolve-Path -LiteralPath $target).Path -eq $pythonRoot)) { throw 'The staging destination must not be the installed Python directory.' }

New-Item -ItemType Directory -Force -Path $target | Out-Null
foreach ($name in @('python.exe', 'python3.dll', 'python314.dll', 'vcruntime140.dll', 'vcruntime140_1.dll')) {
  Copy-Item -LiteralPath (Join-Path $pythonRoot $name) -Destination $target -Force
}
& robocopy (Join-Path $pythonRoot 'DLLs') (Join-Path $target 'DLLs') /MIR /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -gt 7) { throw "Python DLL staging failed (robocopy exit code $LASTEXITCODE)." }
& robocopy (Join-Path $pythonRoot 'Lib') (Join-Path $target 'Lib') /MIR /XD site-packages test tkinter idlelib ensurepip venv /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -gt 7) { throw "Python standard-library staging failed (robocopy exit code $LASTEXITCODE)." }
$stagedPython = Join-Path $target 'python.exe'
& $stagedPython -c "import json, ssl, urllib.request, xml.etree.ElementTree, zipfile"
if ($LASTEXITCODE -ne 0) { throw 'The staged Python runtime cannot load the document translator dependencies.' }
Get-ChildItem -LiteralPath $target -Recurse -File | Measure-Object Length -Sum | ForEach-Object { "Python runtime staged: $([math]::Round($_.Sum / 1MB, 1)) MB at $target" }
