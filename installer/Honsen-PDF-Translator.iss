#define AppName "Honsen PDF Translator"
#define AppVersion GetFileVersion("..\src-tauri\target\release\tauri-app.exe")
#define AppExeName "HonsenPdfTranslator.exe"

[Setup]
AppId={{F0A4E014-4D3A-4AEE-B496-0A51895AA227}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Honsen
DefaultDirName={autopf}\Honsen PDF Translator
DefaultGroupName=Honsen PDF Translator
DisableProgramGroupPage=yes
OutputDir=..\src-tauri\target\release\installer
OutputBaseFilename=Honsen-PDF-Translator-Setup
SetupIconFile=..\logo.ico
UninstallDisplayIcon={app}\{#AppExeName}
Compression=lzma2
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible

[Files]
Source: "..\src-tauri\target\release\tauri-app.exe"; DestDir: "{app}"; DestName: "{#AppExeName}"; Flags: ignoreversion
Source: "..\src-tauri\target\release\resources\*"; DestDir: "{app}\resources"; Flags: ignoreversion recursesubdirs createallsubdirs

[InstallDelete]
; Explicit product-owned legacy executable names only. Never scan user shortcut locations.
Type: files; Name: "{app}\tauri-app.exe"
Type: files; Name: "{app}\Honsen PDF Translator.exe"

[Icons]
Name: "{group}\Honsen PDF Translator"; Filename: "{app}\{#AppExeName}"
Name: "{autodesktop}\Honsen PDF Translator"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; Flags: unchecked

[Run]
Filename: "{app}\{#AppExeName}"; Description: "Launch Honsen PDF Translator"; Flags: nowait postinstall skipifsilent
