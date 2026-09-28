#define AppName "Honsen PDF 翻译器"
#define AppVersion GetFileVersion("..\src-tauri\target\release\tauri-app.exe")
#define AppExeName "HonsenPdfTranslator.exe"

[Setup]
AppId={{F0A4E014-4D3A-4AEE-B496-0A51895AA227}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Honsen
DefaultDirName={autopf}\Honsen PDF 翻译器
DefaultGroupName=Honsen PDF 翻译器
DisableProgramGroupPage=yes
OutputDir=..\src-tauri\target\release\installer
OutputBaseFilename=Honsen-PDF-Translator-Setup
SetupIconFile=..\logo.ico
UninstallDisplayIcon={app}\{#AppExeName}
Compression=lzma2
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "chinesesimp"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[CustomMessages]
chinesesimp.CreateDesktopShortcut=创建桌面快捷方式
chinesesimp.LaunchApplication=启动 Honsen PDF 翻译器

[Files]
Source: "..\src-tauri\target\release\tauri-app.exe"; DestDir: "{app}"; DestName: "{#AppExeName}"; Flags: ignoreversion
Source: "..\src-tauri\target\release\resources\*"; DestDir: "{app}\resources"; Flags: ignoreversion recursesubdirs createallsubdirs

[InstallDelete]
; Explicit product-owned legacy executable names only. Never scan user shortcut locations.
Type: files; Name: "{app}\tauri-app.exe"
Type: files; Name: "{app}\Honsen PDF Translator.exe"

[Icons]
Name: "{group}\Honsen PDF 翻译器"; Filename: "{app}\{#AppExeName}"
Name: "{autodesktop}\Honsen PDF 翻译器"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopShortcut}"; Flags: unchecked

[Run]
Filename: "{app}\{#AppExeName}"; Description: "{cm:LaunchApplication}"; Flags: nowait postinstall skipifsilent
