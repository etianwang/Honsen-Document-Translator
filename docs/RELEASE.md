# Release

Current status: **NOT PRODUCTION READY**. Debug installers are unsigned development artifacts only.

For a public Windows release, set a SemVer version, application publisher, icon, and installer configuration; sign the resulting installer with the organization certificate; verify clean install, upgrade, uninstall, PDF export, and absence of secrets before publication. Telemetry is disabled by design.

## Windows installer and automatic updates

Run `pnpm release:inno` to build the Tauri release binary, then create `Honsen-PDF-Translator-Setup.exe` with Inno Setup and its adjacent `SHA256SUMS.json`. Upload exactly those two files to a non-draft GitHub Release whose tag is the release version, for example `v0.1.1`.

Installed release builds check `etianwang/Honsen-PDF-Translator` on startup. A newer non-prerelease version is downloaded only when its published SHA-256 matches, then started with Inno Setup's silent switches. The installer always writes the stable `HonsenPdfTranslator.exe` name, explicitly deletes only the two named historical product executables, and creates only its own `Honsen PDF Translator` Start Menu/Desktop shortcuts. It never scans or changes unrelated shortcuts.

## Binary distribution

The current repository includes Tesseract and Poppler runtime files to validate the desktop bundle. GitHub warned that `libtesseract-5.dll` exceeds its recommended 50 MB repository-file size. Before a public release, move these runtimes to a verified build download or a GitHub Release asset, pin checksums, and retain their redistribution notices; do not keep adding large runtime binaries to ordinary Git history.
