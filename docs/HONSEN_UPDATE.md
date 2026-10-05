# Honsen unified updater

The fixed app ID is `honsen.document-translator`; its fixed main executable is `HonsenPdfTranslator.exe`. The installer writes `HonsenUpdateRunner.exe`, `honsen.app.json`, and the Honsen Program registry record into one installation directory.

Desktop and Start menu shortcuts use the only launch path:

```text
HonsenUpdateRunner.exe launch
```

The runner validates the registry record and same-directory `honsen.app.json`, including app ID, install directory, main executable, runner, and update manifest URL. It starts the main executable when no update is available; otherwise it downloads, verifies, silently installs, validates, and restarts from a temporary runner copy. Results are written to `%LOCALAPPDATA%\Honsen Program\UpdateResults\honsen.document-translator.json`.

Toolbox opens the application with:

```text
<LauncherPath> launch
```

Toolbox updates after downloading and verifying the installer:

```text
HonsenUpdateRunner.exe apply ^
  --source toolbox ^
  --app-id honsen.document-translator ^
  --wait-pid 0 ^
  --installer "C:\\Downloads\\Honsen-Document-Translator-Setup.exe" ^
  --sha256 "<verified SHA-256>" ^
  --target-dir "<InstallLocation read from the Honsen Program registry record>" ^
  --expected-version "1.4.1" ^
  --restart false
```

The runner verifies SHA-256, target directory, update mutex, Inno exit status/log, main EXE file version, registry version, and manifest version. The main application never downloads or replaces application files.
