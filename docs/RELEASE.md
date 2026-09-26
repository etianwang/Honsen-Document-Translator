# Release

Current status: **NOT PRODUCTION READY**. Debug installers are unsigned development artifacts only.

For a public Windows release, set a SemVer version, application publisher, icon, and installer configuration; sign the resulting installer with the organization certificate; verify clean install, upgrade, uninstall, PDF export, and absence of secrets before publication. Telemetry is disabled by design.

## Binary distribution

The current repository includes Tesseract and Poppler runtime files to validate the desktop bundle. GitHub warned that `libtesseract-5.dll` exceeds its recommended 50 MB repository-file size. Before a public release, move these runtimes to a verified build download or a GitHub Release asset, pin checksums, and retain their redistribution notices; do not keep adding large runtime binaries to ordinary Git history.
