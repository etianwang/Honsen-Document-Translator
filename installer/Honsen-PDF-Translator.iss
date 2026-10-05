#define AppName "Honsen Document Translator"
#define AppVersion "1.4.1"
#define AppExeName "HonsenPdfTranslator.exe"
#define HonsenAppId "honsen.document-translator"
#define HonsenRegistryKey "Software\Honsen Program\Apps\" + HonsenAppId

[Setup]
AppId={{F0A4E014-4D3A-4AEE-B496-0A51895AA227}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Honsen
PrivilegesRequired=admin
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
Source: "..\src-tauri\target\release\HonsenUpdateRunner.exe"; DestDir: "{app}"; Flags: ignoreversion
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
Root: HKLM64; Subkey: "{#HonsenRegistryKey}"; ValueType: string; ValueName: "UpdateManifestUrl"; ValueData: "https://api.github.com/repos/etianwang/Honsen-Document-Translator/releases/latest"
Root: HKLM64; Subkey: "{#HonsenRegistryKey}"; ValueType: string; ValueName: "UpdateRunnerPath"; ValueData: "{app}\HonsenUpdateRunner.exe"
Root: HKLM64; Subkey: "{#HonsenRegistryKey}"; ValueType: string; ValueName: "LauncherPath"; ValueData: "{app}\HonsenUpdateRunner.exe"

[InstallDelete]
; Explicit product-owned legacy executable names only. Never scan user shortcut locations.
Type: files; Name: "{app}\tauri-app.exe"
Type: files; Name: "{app}\Honsen PDF Translator.exe"
Type: files; Name: "{autodesktop}\Honsen PDF 翻译器.lnk"
Type: files; Name: "{autoprograms}\Honsen PDF 翻译器\Honsen PDF 翻译器.lnk"

[UninstallDelete]
Type: files; Name: "{app}\honsen.app.json"

[Icons]
Name: "{group}\Honsen 文档翻译器"; Filename: "{app}\HonsenUpdateRunner.exe"; Parameters: "launch"
Name: "{autodesktop}\Honsen 文档翻译器"; Filename: "{app}\HonsenUpdateRunner.exe"; Parameters: "launch"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopShortcut}"; Flags: unchecked

[Code]
function QueryHonsenInstallation(const RootKey: Integer; var InstallLocation: String): Boolean;
var
  RegisteredAppId: String;
begin
  Result := RegQueryStringValue(RootKey, '{#HonsenRegistryKey}', 'AppId', RegisteredAppId) and
    (RegisteredAppId = '{#HonsenAppId}') and
    RegQueryStringValue(RootKey, '{#HonsenRegistryKey}', 'InstallLocation', InstallLocation);
end;

function SameInstallLocation(const Left, Right: String): Boolean;
begin
  Result := CompareText(AddBackslash(Left), AddBackslash(Right)) = 0;
end;

function HasConflictingHonsenInstallation(const TargetLocation: String; var ExistingLocation: String): Boolean;
begin
  Result := QueryHonsenInstallation(HKEY_LOCAL_MACHINE_64, ExistingLocation) and not SameInstallLocation(TargetLocation, ExistingLocation);
  if Result then Exit;
  Result := QueryHonsenInstallation(HKEY_LOCAL_MACHINE_32, ExistingLocation) and not SameInstallLocation(TargetLocation, ExistingLocation);
  if Result then Exit;
  Result := QueryHonsenInstallation(HKEY_CURRENT_USER_64, ExistingLocation) and not SameInstallLocation(TargetLocation, ExistingLocation);
  if Result then Exit;
  Result := QueryHonsenInstallation(HKEY_CURRENT_USER_32, ExistingLocation) and not SameInstallLocation(TargetLocation, ExistingLocation);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  ExistingLocation: String;
begin
  Result := True;
  if (CurPageID = wpSelectDir) and HasConflictingHonsenInstallation(WizardDirValue, ExistingLocation) then
  begin
    MsgBox('Honsen 文档翻译器已安装在：' + #13#10 + ExistingLocation + #13#10 + #13#10 +
      '为保护现有安装，更新或修复只能使用该目录。', mbError, MB_OK);
    Result := False;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ExistingLocation: String;
begin
  Result := '';
  if HasConflictingHonsenInstallation(WizardDirValue, ExistingLocation) then
    Result := 'Honsen 文档翻译器已安装在：' + ExistingLocation +
      '。更新或修复只能使用该目录。';
end;

procedure WriteHonsenAppManifest;
var
  Lines: TArrayOfString;
begin
  SetArrayLength(Lines, 10);
  Lines[0] := '{';
  Lines[1] := '  "schemaVersion": 1,';
  Lines[2] := '  "appId": "{#HonsenAppId}",';
  Lines[3] := '  "displayName": "{#AppName}",';
  Lines[4] := '  "version": "{#AppVersion}",';
  Lines[5] := '  "executable": "{#AppExeName}",';
  Lines[6] := '  "publisher": "Honsen",';
  Lines[7] := '  "updateManifestUrl": "https://api.github.com/repos/etianwang/Honsen-Document-Translator/releases/latest",';
  Lines[8] := '  "updateRunner": "HonsenUpdateRunner.exe"';
  Lines[9] := '}';

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
Filename: "{app}\HonsenUpdateRunner.exe"; Parameters: "launch"; Flags: nowait runasoriginaluser; Check: IsSilentUpdate
Filename: "{app}\HonsenUpdateRunner.exe"; Parameters: "launch"; Description: "{cm:LaunchApplication}"; Flags: nowait postinstall skipifsilent
