#define AppName "Honsen Document Translator"
#define AppVersion GetFileVersion("..\src-tauri\target\release\tauri-app.exe")
#define AppExeName "HonsenPdfTranslator.exe"
#define HonsenAppId "honsen.document-translator"
#define HonsenRegistryKey "Software\Honsen Program\Apps\" + HonsenAppId

[Setup]
AppId={{F0A4E014-4D3A-4AEE-B496-0A51895AA227}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Honsen
DefaultDirName={autopf}\Honsen Program\Honsen Document Translator
DefaultGroupName=Honsen 文档翻译器
DisableProgramGroupPage=yes
UsePreviousGroup=no
OutputDir=..\src-tauri\target\release\installer
OutputBaseFilename=Honsen-Document-Translator-Setup
SetupIconFile=..\logo.ico
UninstallDisplayIcon={app}\{#AppExeName}
Compression=lzma2
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "chinesesimp"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[CustomMessages]
chinesesimp.CreateDesktopShortcut=创建桌面快捷方式
chinesesimp.LaunchApplication=启动 Honsen 文档翻译器

[Files]
Source: "..\src-tauri\target\release\tauri-app.exe"; DestDir: "{app}"; DestName: "{#AppExeName}"; Flags: ignoreversion
Source: "..\src-tauri\resources\*"; DestDir: "{app}\resources"; Flags: ignoreversion recursesubdirs createallsubdirs

[Registry]
; This installer is machine-wide, so publish the protocol record in native HKLM.
Root: HKLM64; Subkey: "{#HonsenRegistryKey}"; ValueType: string; ValueName: "AppId"; ValueData: "{#HonsenAppId}"; Flags: uninsdeletekey
Root: HKLM64; Subkey: "{#HonsenRegistryKey}"; ValueType: string; ValueName: "DisplayName"; ValueData: "{#AppName}"
Root: HKLM64; Subkey: "{#HonsenRegistryKey}"; ValueType: string; ValueName: "Version"; ValueData: "{#AppVersion}"
Root: HKLM64; Subkey: "{#HonsenRegistryKey}"; ValueType: string; ValueName: "InstallLocation"; ValueData: "{app}"
Root: HKLM64; Subkey: "{#HonsenRegistryKey}"; ValueType: string; ValueName: "ExecutablePath"; ValueData: "{app}\{#AppExeName}"
Root: HKLM64; Subkey: "{#HonsenRegistryKey}"; ValueType: string; ValueName: "InstallScope"; ValueData: "machine"
Root: HKLM64; Subkey: "{#HonsenRegistryKey}"; ValueType: string; ValueName: "Publisher"; ValueData: "Honsen"
Root: HKLM64; Subkey: "{#HonsenRegistryKey}"; ValueType: string; ValueName: "UpdateManifestUrl"; ValueData: ""

[InstallDelete]
; Explicit product-owned legacy executable names only. Never scan user shortcut locations.
Type: files; Name: "{app}\tauri-app.exe"
Type: files; Name: "{app}\Honsen PDF Translator.exe"
Type: files; Name: "{autodesktop}\Honsen PDF 翻译器.lnk"
Type: files; Name: "{autoprograms}\Honsen PDF 翻译器\Honsen PDF 翻译器.lnk"

[UninstallDelete]
Type: files; Name: "{app}\honsen.app.json"

[Icons]
Name: "{group}\Honsen 文档翻译器"; Filename: "{app}\{#AppExeName}"
Name: "{autodesktop}\Honsen 文档翻译器"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopShortcut}"; Flags: unchecked

[Code]
procedure WriteHonsenAppManifest;
var
  Lines: TArrayOfString;
begin
  SetArrayLength(Lines, 9);
  Lines[0] := '{';
  Lines[1] := '  "schemaVersion": 1,';
  Lines[2] := '  "appId": "{#HonsenAppId}",';
  Lines[3] := '  "displayName": "{#AppName}",';
  Lines[4] := '  "version": "{#AppVersion}",';
  Lines[5] := '  "executable": "{#AppExeName}",';
  Lines[6] := '  "publisher": "Honsen",';
  Lines[7] := '  "updateManifestUrl": ""';
  Lines[8] := '}';

  if not SaveStringsToUTF8FileWithoutBOM(ExpandConstant('{app}\honsen.app.json'), Lines, False) then
    RaiseException('Unable to write honsen.app.json.');
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    WriteHonsenAppManifest;
end;

function IsSilentUpdate: Boolean;
begin
  Result := WizardSilent;
end;

[Run]
Filename: "{app}\{#AppExeName}"; Flags: nowait runasoriginaluser; Check: IsSilentUpdate
Filename: "{app}\{#AppExeName}"; Description: "{cm:LaunchApplication}"; Flags: nowait postinstall skipifsilent
