# Release

Current status: **v1.0.4 is an unsigned internal release**. The bundled Poppler/Tesseract Windows binaries have unresolved external-redistribution evidence; see [THIRD_PARTY_AUDIT.md](THIRD_PARTY_AUDIT.md).

Before the next stable Windows release, set a SemVer version, application publisher, icon, and installer configuration; sign the resulting installer with the organization certificate; verify clean install, upgrade, uninstall, PDF export, and absence of secrets before publication. Telemetry is disabled by design.

## Windows installer and automatic updates

Run `pnpm release:inno` to build the Tauri release binary, then create the installer and its adjacent `SHA256SUMS.json`. Run `pnpm verify:installed-runtime` against that installer before upload. Upload exactly those two files to a non-draft GitHub Release whose tag is the release version, for example `v1.0.4`.

Installed release builds check `etianwang/Honsen-Document-Translator` on startup. A newer non-prerelease version is downloaded only when its published SHA-256 matches, then started with Inno Setup's silent switches. The installer retains its internal executable and asset names for update compatibility, while creating only its own `Honsen 文档翻译器` Start Menu/Desktop shortcuts. It never scans or changes unrelated shortcuts.

## Binary distribution

The current repository includes Tesseract and Poppler runtime files to validate the desktop bundle. GitHub warned that `libtesseract-5.dll` exceeds its recommended 50 MB repository-file size. Before a public release, move these runtimes to a verified build download or a GitHub Release asset, pin checksums, and retain their redistribution notices; do not keep adding large runtime binaries to ordinary Git history.
