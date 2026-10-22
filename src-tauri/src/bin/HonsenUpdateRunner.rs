#![windows_subsystem = "windows"]

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{env, ffi::OsStr, fs, io::{Read, Write}, os::windows::{ffi::OsStrExt, process::CommandExt}, path::{Path, PathBuf}, process::{Child, Command, ExitCode}, ptr, time::{Duration, SystemTime, UNIX_EPOCH}};
use windows_sys::Win32::{Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS, ERROR_INVALID_PARAMETER, HANDLE, WAIT_ABANDONED, WAIT_OBJECT_0, WAIT_TIMEOUT}, System::Threading::{CreateMutexW, OpenProcess, QueryFullProcessImageNameW, ReleaseMutex, TerminateProcess, WaitForSingleObject, INFINITE, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE, PROCESS_TERMINATE}};
use winreg::{enums::*, RegKey};

#[link(name = "kernel32")]
extern "system" { fn MoveFileW(existing: *const u16, new_name: *const u16) -> i32; }

const APP_ID: &str = "honsen.document-translator";
const REGISTRY_KEY: &str = "Software\\Honsen Program\\Apps\\honsen.document-translator";
const RUNNER_NAME: &str = "HonsenUpdateRunner.exe";
const EXE_NAME: &str = "HonsenPdfTranslator.exe";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    schema_version: u32,
    app_id: String,
    display_name: String,
    version: String,
    executable: String,
    update_runner: String,
    publisher: String,
    update_manifest_url: String,
}

#[derive(Clone)]
struct RegistryRecord {
    version: String,
    install_location: PathBuf,
    executable_path: PathBuf,
    update_runner_path: PathBuf,
    update_manifest_url: String,
}

struct Arguments {
    source: String,
    app_id: String,
    wait_pid: u32,
    installer: PathBuf,
    sha256: String,
    target_dir: PathBuf,
    expected_version: String,
    restart: bool,
    operation_id: String,
    result_path: PathBuf,
}

struct LaunchArguments { source: String, wait_pid: u32, operation_id: String, result_path: PathBuf, wait_for_update: bool }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateResult {
    app_id: String,
    operation_id: String,
    status: String,
    source: String,
    from_version: Option<String>,
    to_version: String,
    install_location: Option<String>,
    executable_path: Option<String>,
    step: Option<String>,
    installer_exit_code: Option<i32>,
    installer_log_path: Option<String>,
    message: Option<String>,
    completed_at_utc: String,
}

struct UpdateLock(HANDLE);
struct ProgressWindow { path: PathBuf, host: Child }

#[derive(Deserialize)] struct GithubRelease { tag_name: String, draft: bool, prerelease: bool, body: Option<String>, assets: Vec<GithubAsset> }
#[derive(Deserialize)] struct GithubAsset { name: String, browser_download_url: String }
#[derive(Deserialize)] struct Checksums { assets: Vec<Checksum> }
#[derive(Deserialize)] struct Checksum { name: String, sha256: String }

impl Drop for UpdateLock {
    fn drop(&mut self) { unsafe { ReleaseMutex(self.0); CloseHandle(self.0); } }
}

impl ProgressWindow {
    fn start() -> Result<Self, String> {
        let directory = ui_directory()?;
        let path = directory.join("progress.txt");
        fs::write(&path, "-1|正在检查更新，请稍候…").map_err(|error| format!("UPDATE_UI_FAILED: {error}"))?;
        let script = directory.join("progress.ps1");
        fs::write(&script, progress_script()).map_err(|error| format!("UPDATE_UI_FAILED: {error}"))?;
        let host = wscript(&script, true, [("HONSEN_PROGRESS_FILE", path.as_os_str())])?;
        Ok(Self { path, host })
    }

    fn set(&self, percent: u8, message: &str) { let _ = fs::write(&self.path, format!("{percent}|{message}")); }
    fn close(&mut self) { self.set(100, "完成"); let _ = self.host.wait(); }
}

impl Drop for ProgressWindow {
    fn drop(&mut self) { self.close(); }
}

fn main() -> ExitCode {
    let raw = env::args().collect::<Vec<_>>();
    if raw.iter().any(|value| value == "--help" || value == "-h") { print_help(raw.get(1).map(String::as_str)); return ExitCode::SUCCESS; }
    if !raw.iter().any(|value| value == "--runner-copied") {
        return match copy_and_relaunch(&raw) {
            Ok(()) => ExitCode::SUCCESS,
            Err(error) => { eprintln!("{error}"); ExitCode::from(1) }
        };
    }
    let result = match raw.get(1).map(String::as_str) {
        Some("launch") => parse_launch(&raw).and_then(run_launch),
        Some("repair") => parse_launch(&raw).and_then(run_launch),
        _ => parse_arguments(&raw).and_then(run_update),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => { eprintln!("{error}"); ExitCode::from(1) }
    }
}

fn print_help(command: Option<&str>) {
    let usage = match command {
        Some("launch") | Some("repair") => "HonsenUpdateRunner.exe launch --app-id honsen.document-translator [--source app|toolbox] [--wait-pid PID] [--operation-id ID] [--result-path PATH]",
        Some("apply") => "HonsenUpdateRunner.exe apply --source app|toolbox --app-id honsen.document-translator --wait-pid PID --installer PATH --sha256 SHA256 --target-dir PATH --expected-version VERSION --restart true|false --operation-id GUID --result-path PATH",
        _ => "HonsenUpdateRunner.exe <launch|repair|apply> [options]",
    };
    println!("{usage}");
}

fn parse_launch(raw: &[String]) -> Result<LaunchArguments, String> {
    let value = |name: &str| raw.windows(2).find_map(|pair| (pair[0] == name).then(|| pair[1].as_str()));
    if let Some(app_id) = value("--app-id") { if app_id != APP_ID { return Err("UPDATE_IDENTITY_FAILED: Unexpected appId.".into()); } }
    let wait_pid = value("--wait-pid").map(|value| value.parse().map_err(|_| "RUNNER_ARGUMENTS_INVALID: --wait-pid must be an integer.".to_owned())).transpose()?.unwrap_or(0);
    let operation_id = value("--operation-id").unwrap_or("launch").to_owned();
    let result_path = value("--result-path").map(PathBuf::from).unwrap_or(default_result_path(APP_ID, &operation_id)?);
    let source = value("--source").unwrap_or("app");
    if source != "app" && source != "toolbox" { return Err("RUNNER_ARGUMENTS_INVALID: --source must be app or toolbox.".into()); }
    Ok(LaunchArguments { source: source.to_owned(), wait_pid, operation_id, result_path, wait_for_update: raw.iter().any(|value| value == "--wait-for-update") })
}

fn run_launch(arguments: LaunchArguments) -> Result<(), String> {
    let _lock = if arguments.wait_for_update { wait_for_update_lock(APP_ID)? } else { acquire_lock(APP_ID)? };
    let before = registry_record().ok();
    let outcome = run_launch_inner(arguments.wait_pid, &arguments.operation_id, &arguments.result_path);
    let result = match &outcome {
        Ok(record) => UpdateResult { app_id: APP_ID.into(), operation_id: arguments.operation_id.clone(), status: "success".into(), source: arguments.source.clone(), from_version: before.as_ref().map(|value| value.version.clone()), to_version: record.version.clone(), install_location: Some(record.install_location.to_string_lossy().into_owned()), executable_path: Some(record.executable_path.to_string_lossy().into_owned()), step: None, installer_exit_code: Some(0), installer_log_path: Some(installer_log_path(APP_ID)?.to_string_lossy().into_owned()), message: None, completed_at_utc: completed_at() },
        Err(error) => UpdateResult { app_id: APP_ID.into(), operation_id: arguments.operation_id.clone(), status: "failed".into(), source: arguments.source.clone(), from_version: before.as_ref().map(|value| value.version.clone()), to_version: before.as_ref().map(|value| value.version.clone()).unwrap_or_default(), install_location: before.as_ref().map(|value| value.install_location.to_string_lossy().into_owned()), executable_path: before.as_ref().map(|value| value.executable_path.to_string_lossy().into_owned()), step: Some(error.split(':').next().unwrap_or("UPDATE_FAILED").into()), installer_exit_code: installer_exit_code(error), installer_log_path: installer_log_path(APP_ID).ok().map(|value| value.to_string_lossy().into_owned()), message: Some(error.clone()), completed_at_utc: completed_at() },
    };
    write_result(&arguments.result_path, &result)?;
    outcome.map(|_| ())
}

fn run_launch_inner(wait_pid: u32, operation_id: &str, result_path: &Path) -> Result<RegistryRecord, String> {
    let mut progress = ProgressWindow::start()?;
    let record = validate_install(&registry_record()?.install_location.canonicalize().map_err(|_| "UPDATE_TARGET_FAILED: InstallLocation is missing.")?)?;
    let client = reqwest::blocking::Client::builder().user_agent("Honsen-Document-Translator-Updater").timeout(Duration::from_secs(60)).build().map_err(|error| format!("UPDATE_CHECK_FAILED: {error}"))?;
    let release = client.get(&record.update_manifest_url).send().and_then(|response| response.error_for_status()).and_then(|response| response.json::<GithubRelease>());
    let release = match release {
        Ok(release) => release,
        Err(_) => {
            progress.set(100, "无法检查更新，正在启动…"); drop(progress);
            Command::new(&record.executable_path).spawn().map_err(|error| format!("UPDATE_RESTART_FAILED: {error}"))?;
            return Ok(record);
        }
    };
    if release.draft || release.prerelease || !is_newer(&release.tag_name, &record.version) || skipped_version().as_deref() == Some(release.tag_name.trim_start_matches('v')) {
        progress.set(100, "已是最新版本，正在启动…"); drop(progress);
        Command::new(&record.executable_path).spawn().map_err(|error| format!("UPDATE_RESTART_FAILED: {error}"))?;
        return Ok(record);
    }
    progress.close();
    match update_choice(&release.tag_name, release.body.as_deref().unwrap_or("此版本未提供更新说明。"))?.as_str() {
        "Yes" => {},
        "Cancel" => { save_skipped_version(release.tag_name.trim_start_matches('v'))?; Command::new(&record.executable_path).spawn().map_err(|error| format!("UPDATE_RESTART_FAILED: {error}"))?; return Ok(record); },
        _ => { Command::new(&record.executable_path).spawn().map_err(|error| format!("UPDATE_RESTART_FAILED: {error}"))?; return Ok(record); },
    }
    let progress = ProgressWindow::start()?;
    progress.set(0, "正在下载更新… 0%");
    let installer = release.assets.iter().find(|asset| asset.name == "Honsen-Document-Translator-Setup.exe").ok_or("UPDATE_CHECK_FAILED: Release installer is missing.")?;
    let sums = release.assets.iter().find(|asset| asset.name == "SHA256SUMS.json").ok_or("UPDATE_CHECK_FAILED: Release checksums are missing.")?;
    let sums = client.get(&sums.browser_download_url).send().map_err(|_| "UPDATE_CHECK_FAILED: Could not download checksums.")?.json::<Checksums>().map_err(|_| "UPDATE_CHECK_FAILED: Checksums are invalid.")?;
    let sha256 = sums.assets.into_iter().find(|entry| entry.name == installer.name).map(|entry| entry.sha256).ok_or("UPDATE_CHECK_FAILED: Installer SHA-256 is missing.")?;
    let path = env::temp_dir().join(format!("honsen-document-translator-{}.exe", release.tag_name));
    download_with_progress(client.get(&installer.browser_download_url).send().map_err(|_| "UPDATE_DOWNLOAD_FAILED: Could not download installer.")?, &path, &progress)?;
    progress.set(86, "正在校验更新包…");
    let arguments = Arguments { source: "app".into(), app_id: APP_ID.into(), wait_pid, installer: path, sha256, target_dir: record.install_location, expected_version: release.tag_name.trim_start_matches('v').into(), restart: true, result_path: result_path.to_path_buf(), operation_id: operation_id.into() };
    update_locked(&arguments, &record.version, Some(&progress))?;
    if arguments.restart { let after = validate_install(&arguments.target_dir.canonicalize().map_err(|_| "UPDATE_TARGET_FAILED: InstallLocation is missing.")?)?; Command::new(&after.executable_path).spawn().map_err(|error| format!("UPDATE_RESTART_FAILED: {error}"))?; }
    progress.set(100, "更新完成，正在重新打开…");
    Ok(registry_record()?)
}

fn is_newer(candidate: &str, current: &str) -> bool { let parse = |value: &str| value.trim_start_matches('v').split('.').map(str::parse::<u32>).collect::<Result<Vec<_>, _>>(); matches!((parse(candidate), parse(current)), (Ok(candidate), Ok(current)) if candidate > current) }

fn copy_and_relaunch(raw: &[String]) -> Result<(), String> {
    let exe = env::current_exe().map_err(|error| format!("RUNNER_PATH_FAILED: {error}"))?;
    let app_id = APP_ID;
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|error| error.to_string())?.as_nanos();
    let directory = env::temp_dir().join("Honsen Program").join("UpdateRunner").join(format!("{app_id}-{stamp}"));
    fs::create_dir_all(&directory).map_err(|error| format!("RUNNER_COPY_FAILED: {error}"))?;
    let copied = directory.join(RUNNER_NAME);
    fs::copy(&exe, &copied).map_err(|error| format!("RUNNER_COPY_FAILED: {error}"))?;
    let mut command = Command::new(copied);
    command.args(raw.iter().skip(1)).arg("--runner-copied");
    command.spawn().map_err(|error| format!("RUNNER_START_FAILED: {error}"))?;
    Ok(())
}

fn parse_arguments(raw: &[String]) -> Result<Arguments, String> {
    if raw.get(1).map(String::as_str) != Some("apply") { return Err("RUNNER_ARGUMENTS_INVALID: Expected `apply`.".into()); }
    let value = |name: &str| raw.windows(2).find_map(|pair| (pair[0] == name).then(|| pair[1].clone())).ok_or_else(|| format!("RUNNER_ARGUMENTS_INVALID: {name} is required."));
    let source = value("--source")?;
    if source != "app" && source != "toolbox" { return Err("RUNNER_ARGUMENTS_INVALID: --source must be app or toolbox.".into()); }
    let app_id = value("--app-id")?;
    let wait_pid = value("--wait-pid")?.parse().map_err(|_| "RUNNER_ARGUMENTS_INVALID: --wait-pid must be an integer.".to_owned())?;
    let sha256 = value("--sha256")?.to_ascii_lowercase();
    if sha256.len() != 64 || !sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) { return Err("RUNNER_ARGUMENTS_INVALID: --sha256 must be SHA-256.".into()); }
    let expected_version = value("--expected-version")?;
    if !valid_version(&expected_version) { return Err("RUNNER_ARGUMENTS_INVALID: --expected-version must be a numeric release version.".into()); }
    let restart = match value("--restart")?.as_str() { "true" => true, "false" => false, _ => return Err("RUNNER_ARGUMENTS_INVALID: --restart must be true or false.".into()) };
    let operation_id = value("--operation-id")?;
    if operation_id.len() != 36 || !operation_id.bytes().enumerate().all(|(i, b)| if [8, 13, 18, 23].contains(&i) { b == b'-' } else { b.is_ascii_hexdigit() }) { return Err("RUNNER_ARGUMENTS_INVALID: --operation-id must be a GUID.".into()); }
    let result_path = PathBuf::from(value("--result-path")?);
    let installer = PathBuf::from(value("--installer")?);
    let target_dir = PathBuf::from(value("--target-dir")?);
    if !result_path.is_absolute() || !installer.is_absolute() || !target_dir.is_absolute() || result_path.file_name().and_then(|v| v.to_str()) != Some(format!("{operation_id}.json").as_str()) { return Err("RUNNER_ARGUMENTS_INVALID: Absolute paths and an operation-specific result filename are required.".into()); }
    Ok(Arguments { source, app_id, wait_pid, installer, sha256, target_dir, expected_version, restart, operation_id, result_path })
}

fn run_update(arguments: Arguments) -> Result<(), String> {
    let _operation_lock = acquire_lock(&format!("{APP_ID}-{}", arguments.operation_id))?;
    if arguments.result_path.exists() { return Err("UPDATE_RESULT_FAILED: Result already exists.".into()); }
    let from_version = registry_record().ok().map(|record| record.version);
    let lock = acquire_lock(APP_ID);
    let outcome = if arguments.app_id != APP_ID { Err("UPDATE_IDENTITY_FAILED: Unexpected appId.".into()) } else { match &lock { Ok(_) => update_locked(&arguments, from_version.as_deref().unwrap_or_default(), None), Err(error) => Err(error.clone()) } };
    let result = match &outcome {
        Ok(record) => UpdateResult { app_id: arguments.app_id.clone(), operation_id: arguments.operation_id.clone(), status: "success".into(), source: arguments.source.clone(), from_version, to_version: arguments.expected_version.clone(), install_location: Some(record.install_location.to_string_lossy().into_owned()), executable_path: Some(record.executable_path.to_string_lossy().into_owned()), step: None, installer_exit_code: Some(0), installer_log_path: Some(installer_log_path(&arguments.app_id)?.to_string_lossy().into_owned()), message: None, completed_at_utc: completed_at() },
        Err(error) => UpdateResult { app_id: arguments.app_id.clone(), operation_id: arguments.operation_id.clone(), status: "failed".into(), source: arguments.source.clone(), from_version, to_version: arguments.expected_version.clone(), install_location: Some(arguments.target_dir.to_string_lossy().into_owned()), executable_path: None, step: Some(error.split(':').next().unwrap_or("UPDATE_FAILED").to_owned()), installer_exit_code: installer_exit_code(error), installer_log_path: Some(installer_log_path(&arguments.app_id)?.to_string_lossy().into_owned()), message: Some(error.clone()), completed_at_utc: completed_at() },
    };
    write_apply_result(&arguments.result_path, &result)?;
    let record = outcome?;
    if arguments.restart { Command::new(&record.executable_path).spawn().map_err(|error| format!("UPDATE_RESTART_FAILED: {error}"))?; }
    Ok(())
}

fn update_locked(arguments: &Arguments, from_version: &str, progress: Option<&ProgressWindow>) -> Result<RegistryRecord, String> {
    let target = arguments.target_dir.canonicalize().map_err(|_| "UPDATE_TARGET_FAILED: Target directory does not exist.".to_owned())?;
    let before = validate_install(&target)?;
    if before.version != from_version { return Err("UPDATE_REGISTRY_FAILED: Registry version changed before update started.".into()); }
    verify_hash(&arguments.installer, &arguments.sha256)?;
    if let Some(progress) = progress { progress.set(88, "正在等待旧版本退出…"); }
    wait_for_exit(arguments.wait_pid, &before.executable_path)?;
    if let Some(progress) = progress { progress.set(90, "正在解压并安装更新…"); }
    let log = installer_log_path(&arguments.app_id)?;
    if let Some(parent) = log.parent() { fs::create_dir_all(parent).map_err(|error| format!("UPDATE_LOG_FAILED: {error}"))?; }
    run_elevated_installer(&arguments.installer, &before.install_location, &log)?;
    if fs::read_to_string(&log).map_or(true, |content| content.trim().is_empty()) { return Err("UPDATE_LOG_FAILED: Inno Setup did not create a readable installation log.".into()); }
    if let Some(progress) = progress { progress.set(96, "正在验证新版本…"); }
    let after = validate_install(&target)?;
    if !same_install_path(&after.install_location, &target) || after.version != arguments.expected_version { return Err("UPDATE_VERIFICATION_FAILED: Installed registry state does not match the requested version and directory.".into()); }
    let manifest = load_manifest(&target)?;
    if manifest.version != arguments.expected_version { return Err("UPDATE_VERIFICATION_FAILED: honsen.app.json has an unexpected version.".into()); }
    if !versions_match(&executable_version(&after.executable_path)?, &arguments.expected_version) { return Err("UPDATE_VERIFICATION_FAILED: Main EXE has an unexpected file version.".into()); }
    Ok(after)
}

fn installer_outcome(output: &str) -> Result<(), String> {
    match output.trim() {
        "exit:0" => Ok(()),
        "cancelled" => Err("UPDATE_UAC_CANCELLED: Administrator approval was declined.".into()),
        value if value.starts_with("exit:") => match value[5..].parse::<i32>() {
            Ok(code) => Err(format!("INSTALLER_EXIT_{code}: Inno Setup failed.")),
            Err(_) => Err("UPDATE_INSTALLER_START_FAILED: Invalid installer response.".into()),
        },
        _ => Err("UPDATE_INSTALLER_START_FAILED: Could not start or wait for the installer.".into()),
    }
}

fn quoted_path_argument(prefix: &str, path: &Path) -> Result<String, String> {
    let value = path.to_str().ok_or("UPDATE_INSTALLER_START_FAILED: Invalid path.")?;
    if value.contains('"') { return Err("UPDATE_INSTALLER_START_FAILED: Invalid path.".into()); }
    let trailing = value.chars().rev().take_while(|c| *c == '\\').count();
    Ok(format!("\"{prefix}{value}{}\"", "\\".repeat(trailing)))
}

fn run_elevated_installer(installer: &Path, target: &Path, log: &Path) -> Result<(), String> {
    let params = format!("/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /HONSENUPDATER=1 {} {}", quoted_path_argument("/DIR=", target)?, quoted_path_argument("/LOG=", log)?);
    let script = r#"try { $p = Start-Process -FilePath $env:HONSEN_INSTALLER -ArgumentList $env:HONSEN_INSTALLER_ARGS -Verb RunAs -Wait -PassThru -ErrorAction Stop; [Console]::Out.Write('exit:' + $p.ExitCode) } catch { $e = $_.Exception; while ($e) { if ($e.NativeErrorCode -eq 1223) { [Console]::Out.Write('cancelled'); exit }; $e = $e.InnerException }; [Console]::Out.Write('start-failed') }"#;
    let output = hidden_powershell().args(["-NoProfile", "-NonInteractive", "-Command", script]).env("HONSEN_INSTALLER", installer).env("HONSEN_INSTALLER_ARGS", params).output().map_err(|error| format!("UPDATE_INSTALLER_START_FAILED: {error}"))?;
    if !output.status.success() { return Err("UPDATE_INSTALLER_START_FAILED: Elevation helper failed.".into()); }
    installer_outcome(&String::from_utf8_lossy(&output.stdout))
}

fn same_install_path(path: &Path, target: &Path) -> bool {
    path.canonicalize().is_ok_and(|path| path == target)
}

fn wait_for_update_lock(app_id: &str) -> Result<UpdateLock, String> {
    let name = wide(&format!("Global\\HonsenUpdate-{}", app_id.replace('.', "_")));
    unsafe {
        let handle = CreateMutexW(ptr::null(), 0, name.as_ptr());
        if handle.is_null() { return Err("UPDATE_LOCK_FAILED: Could not create the update mutex.".into()); }
        match WaitForSingleObject(handle, 300_000) {
            WAIT_OBJECT_0 | WAIT_ABANDONED => Ok(UpdateLock(handle)),
            _ => { CloseHandle(handle); Err("UPDATE_LOCKED: Timed out waiting for the update to finish.".into()) }
        }
    }
}

fn acquire_lock(app_id: &str) -> Result<UpdateLock, String> {
    let name = wide(&format!("Global\\HonsenUpdate-{}", app_id.replace('.', "_")));
    unsafe {
        let handle = CreateMutexW(ptr::null(), 1, name.as_ptr());
        if handle.is_null() { return Err("UPDATE_LOCK_FAILED: Could not create the update mutex.".into()); }
        if GetLastError() == ERROR_ALREADY_EXISTS {
            CloseHandle(handle);
            return Err("UPDATE_LOCKED: An update is already running for this appId.".into());
        }
        Ok(UpdateLock(handle))
    }
}

fn registry_record() -> Result<RegistryRecord, String> {
    for (hive, view) in [(HKEY_LOCAL_MACHINE, KEY_WOW64_64KEY), (HKEY_LOCAL_MACHINE, KEY_WOW64_32KEY), (HKEY_CURRENT_USER, KEY_WOW64_64KEY), (HKEY_CURRENT_USER, KEY_WOW64_32KEY)] {
        let root = RegKey::predef(hive);
        if let Ok(key) = root.open_subkey_with_flags(REGISTRY_KEY, KEY_READ | view) {
            let app_id: String = key.get_value("AppId").map_err(|_| "UPDATE_REGISTRY_FAILED: Missing AppId.")?;
            if app_id != APP_ID { return Err("UPDATE_REGISTRY_FAILED: Registry appId mismatch.".into()); }
            return Ok(RegistryRecord { version: key.get_value("Version").map_err(|_| "UPDATE_REGISTRY_FAILED: Missing Version.")?, install_location: PathBuf::from(key.get_value::<String, _>("InstallLocation").map_err(|_| "UPDATE_REGISTRY_FAILED: Missing InstallLocation.")?), executable_path: PathBuf::from(key.get_value::<String, _>("ExecutablePath").map_err(|_| "UPDATE_REGISTRY_FAILED: Missing ExecutablePath.")?), update_runner_path: PathBuf::from(key.get_value::<String, _>("UpdateRunnerPath").map_err(|_| "UPDATE_REGISTRY_FAILED: Missing UpdateRunnerPath.")?), update_manifest_url: key.get_value("UpdateManifestUrl").map_err(|_| "UPDATE_REGISTRY_FAILED: Missing UpdateManifestUrl.")? });
        }
    }
    Err("UPDATE_REGISTRY_FAILED: Honsen Program registry record was not found.".into())
}

fn validate_install(target: &Path) -> Result<RegistryRecord, String> {
    let record = registry_record()?;
    let install = record.install_location.canonicalize().map_err(|_| "UPDATE_REGISTRY_FAILED: InstallLocation is missing.")?;
    let executable_parent = record.executable_path.parent().and_then(|path| path.canonicalize().ok());
    let runner_parent = record.update_runner_path.parent().and_then(|path| path.canonicalize().ok());
    if install != target || executable_parent.as_deref() != Some(target) || runner_parent.as_deref() != Some(target) { return Err("UPDATE_IDENTITY_FAILED: Target directory does not match the registered installation.".into()); }
    for (path, name) in [(&record.executable_path, EXE_NAME), (&record.update_runner_path, RUNNER_NAME)] {
        if path.file_name().and_then(|value| value.to_str()) != Some(name) || !path.is_file() || path.canonicalize().ok().and_then(|path| path.parent().map(Path::to_path_buf)).as_deref() != Some(target) {
            return Err("UPDATE_IDENTITY_FAILED: Executable or runner is missing or resolves outside the installation.".into());
        }
    }
    let manifest = load_manifest(target)?;
    if !manifest_matches(&manifest, &record.version, &record.update_manifest_url) { return Err("UPDATE_IDENTITY_FAILED: honsen.app.json does not match the registered application.".into()); }
    Ok(record)
}

fn manifest_matches(manifest: &Manifest, version: &str, url: &str) -> bool {
    manifest.schema_version == 1 && manifest.app_id == APP_ID && !manifest.display_name.is_empty()
        && valid_version(version) && manifest.version == version && manifest.executable == EXE_NAME
        && manifest.update_runner == RUNNER_NAME && manifest.publisher == "Honsen"
        && url.starts_with("https://") && manifest.update_manifest_url == url
}

fn load_manifest(target: &Path) -> Result<Manifest, String> {
    let content = fs::read_to_string(target.join("honsen.app.json")).map_err(|_| "UPDATE_MANIFEST_FAILED: honsen.app.json is missing or not UTF-8.".to_owned())?;
    serde_json::from_str(&content).map_err(|_| "UPDATE_MANIFEST_FAILED: honsen.app.json is invalid.".into())
}

fn verify_hash(path: &Path, expected: &str) -> Result<(), String> {
    let bytes = fs::read(path).map_err(|_| "UPDATE_CHECKSUM_FAILED: Installer file is unavailable.".to_owned())?;
    if format!("{:x}", Sha256::digest(bytes)) != expected { return Err("UPDATE_CHECKSUM_FAILED: Installer SHA-256 mismatch.".into()); }
    Ok(())
}

fn wait_for_exit(pid: u32, expected_executable: &Path) -> Result<(), String> {
    if pid == 0 { return Ok(()); }
    unsafe {
        let handle = OpenProcess(PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE, 0, pid);
        if handle.is_null() {
            return if GetLastError() == ERROR_INVALID_PARAMETER { Ok(()) }
                else { Err("UPDATE_WAIT_FAILED: Could not open the target process to wait for it.".into()) };
        }
        let result = WaitForSingleObject(handle, 30_000);
        if result == WAIT_OBJECT_0 { CloseHandle(handle); return Ok(()); }
        if result != WAIT_TIMEOUT { CloseHandle(handle); return Err("UPDATE_WAIT_FAILED: Could not wait for the target process.".into()); }
        let mut image = vec![0u16; 32_768]; let mut size = image.len() as u32;
        let verified = QueryFullProcessImageNameW(handle, 0, image.as_mut_ptr(), &mut size) != 0
            && PathBuf::from(String::from_utf16_lossy(&image[..size as usize])).canonicalize().ok().as_deref() == expected_executable.canonicalize().ok().as_deref();
        if !verified || TerminateProcess(handle, 1) == 0 || WaitForSingleObject(handle, INFINITE) != WAIT_OBJECT_0 { CloseHandle(handle); return Err("UPDATE_WAIT_FAILED: The old application did not exit safely.".into()); }
        CloseHandle(handle); Ok(())
    }
}

fn hidden_powershell() -> Command { let mut command = Command::new("powershell.exe"); command.creation_flags(0x08000000); command }

fn ui_directory() -> Result<PathBuf, String> {
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|error| error.to_string())?.as_nanos();
    let directory = env::temp_dir().join("Honsen Program").join("UpdateRunner").join(format!("ui-{stamp}"));
    fs::create_dir_all(&directory).map_err(|error| format!("UPDATE_UI_FAILED: {error}"))?;
    Ok(directory)
}

fn wscript<'a>(script: &Path, wait: bool, environment: impl IntoIterator<Item = (&'a str, &'a OsStr)>) -> Result<Child, String> {
    let launcher = script.with_extension("vbs");
    let script = script.display().to_string().replace('"', "\"\"");
    fs::write(&launcher, format!("Set shell = CreateObject(\"WScript.Shell\")\nWScript.Quit shell.Run(\"powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -STA -File \"\"{script}\"\"\", 0, {})", if wait { "True" } else { "False" }))
        .map_err(|error| format!("UPDATE_UI_FAILED: {error}"))?;
    let mut command = Command::new("wscript.exe");
    command.arg(launcher).creation_flags(0x08000000);
    for (name, value) in environment { command.env(name, value); }
    command.spawn().map_err(|error| format!("UPDATE_UI_FAILED: {error}"))
}

fn progress_script() -> &'static str { r#"
Add-Type -AssemblyName PresentationFramework
$w = New-Object System.Windows.Window
$w.Title = 'Honsen 文档翻译器更新'; $w.Width = 410; $w.Height = 150
$w.WindowStartupLocation = 'CenterScreen'; $w.ResizeMode = 'NoResize'; $w.Topmost = $true
$panel = New-Object System.Windows.Controls.StackPanel; $panel.Margin = '24'
$text = New-Object System.Windows.Controls.TextBlock; $text.FontSize = 15; $text.Text = '正在检查更新，请稍候…'
$bar = New-Object System.Windows.Controls.ProgressBar; $bar.Height = 16; $bar.Margin = '0,18,0,0'; $bar.IsIndeterminate = $true
$panel.Children.Add($text); $panel.Children.Add($bar); $w.Content = $panel
$timer = New-Object System.Windows.Threading.DispatcherTimer; $timer.Interval = [TimeSpan]::FromMilliseconds(120)
$timer.Add_Tick({
  if (-not (Test-Path -LiteralPath $env:HONSEN_PROGRESS_FILE)) { $w.Close(); return }
  $parts = [IO.File]::ReadAllText($env:HONSEN_PROGRESS_FILE).Split('|', 2)
  if ($parts[0] -eq '100') { $w.Close(); return }
  $text.Text = $parts[1]
  $bar.IsIndeterminate = ($parts[0] -eq '-1')
  if (-not $bar.IsIndeterminate) { $bar.Value = [Math]::Min(99, [int]$parts[0]) }
})
$timer.Start(); $w.ShowDialog() | Out-Null
"# }

fn choice_script() -> &'static str { r#"
Add-Type -AssemblyName PresentationFramework
$choice = [System.Windows.MessageBox]::Show($env:HONSEN_UPDATE_TEXT, 'Honsen 文档翻译器更新', 'YesNoCancel', 'Information')
if ($choice -eq 'Yes') { exit 10 }; if ($choice -eq 'No') { exit 11 }; exit 12
"# }

fn download_with_progress(mut response: reqwest::blocking::Response, path: &Path, progress: &ProgressWindow) -> Result<(), String> {
    let total = response.content_length();
    let mut file = fs::File::create(path).map_err(|error| format!("UPDATE_DOWNLOAD_FAILED: {error}"))?;
    let mut buffer = [0u8; 64 * 1024]; let mut downloaded = 0u64; let mut displayed = u8::MAX;
    loop {
        let count = response.read(&mut buffer).map_err(|_| "UPDATE_DOWNLOAD_FAILED: Could not read installer.")?;
        if count == 0 { break; }
        file.write_all(&buffer[..count]).map_err(|error| format!("UPDATE_DOWNLOAD_FAILED: {error}"))?;
        downloaded += count as u64;
        if let Some(total) = total {
            let percent = ((downloaded.saturating_mul(85) / total).min(85)) as u8;
            if percent != displayed { progress.set(percent, &format!("正在下载更新… {}%", (downloaded.saturating_mul(100) / total).min(100))); displayed = percent; }
        } else { progress.set(0, "正在下载更新…"); }
    }
    Ok(())
}

fn executable_version(executable: &Path) -> Result<String, String> {
    let output = hidden_powershell().args(["-NoProfile", "-Command", "(Get-Item -LiteralPath $env:HONSEN_UPDATE_EXE).VersionInfo.FileVersion"]).env("HONSEN_UPDATE_EXE", executable)
        .output().map_err(|error| format!("UPDATE_VERIFICATION_FAILED: {error}"))?;
    let version = String::from_utf8_lossy(&output.stdout).trim().trim_start_matches('v').to_owned();
    if output.status.success() && !version.is_empty() { Ok(version) } else { Err("UPDATE_VERIFICATION_FAILED: Could not read the main EXE version.".into()) }
}

fn wide(value: &str) -> Vec<u16> { OsStr::new(value).encode_wide().chain(Some(0)).collect() }
fn versions_match(actual: &str, expected: &str) -> bool {
    let parse = |value: &str| -> Option<Vec<u32>> {
        let parts = value.split('.').map(str::parse::<u32>).collect::<Result<Vec<_>, _>>().ok()?;
        if !(3..=4).contains(&parts.len()) { return None; }
        Some(parts)
    };
    match (parse(actual), parse(expected)) {
        (Some(mut actual), Some(mut expected)) => { actual.resize(4, 0); expected.resize(4, 0); actual == expected }
        _ => false,
    }
}
fn valid_version(value: &str) -> bool { value.split('.').count() >= 3 && value.split('.').all(|part| !part.is_empty() && part.parse::<u32>().is_ok()) }
fn installer_exit_code(error: &str) -> Option<i32> { error.strip_prefix("INSTALLER_EXIT_").and_then(|value| value.split(':').next()).and_then(|value| value.parse().ok()) }

fn default_result_path(app_id: &str, operation_id: &str) -> Result<PathBuf, String> { Ok(PathBuf::from(env::var_os("LOCALAPPDATA").ok_or("UPDATE_RESULT_FAILED: LOCALAPPDATA is unavailable.")?).join("Honsen Program").join("UpdateResults").join(app_id).join(format!("{operation_id}.json"))) }
fn preference_path() -> Result<PathBuf, String> { Ok(PathBuf::from(env::var_os("LOCALAPPDATA").ok_or("UPDATE_RESULT_FAILED: LOCALAPPDATA is unavailable.")?).join("Honsen Program").join("UpdatePreferences").join(format!("{APP_ID}.json"))) }
fn skipped_version() -> Option<String> { preference_path().ok().and_then(|path| fs::read_to_string(path).ok()).and_then(|value| serde_json::from_str::<serde_json::Value>(&value).ok()).and_then(|value| value.get("skipVersion")?.as_str().map(str::to_owned)) }
fn save_skipped_version(version: &str) -> Result<(), String> { let path = preference_path()?; fs::create_dir_all(path.parent().unwrap()).map_err(|error| format!("UPDATE_PREFERENCE_FAILED: {error}"))?; fs::write(path, serde_json::json!({"skipVersion": version}).to_string()).map_err(|error| format!("UPDATE_PREFERENCE_FAILED: {error}")) }
fn update_choice(version: &str, notes: &str) -> Result<String, String> {
    let text = format!("发现 Honsen 文档翻译器 {version}。\r\n\r\n{}\r\n\r\n是：立即更新\r\n否：稍后提醒\r\n取消：跳过此版本", notes.chars().take(3000).collect::<String>());
    let directory = ui_directory()?; let script = directory.join("choice.ps1");
    fs::write(&script, choice_script()).map_err(|error| format!("UPDATE_PROMPT_FAILED: {error}"))?;
    let text = OsStr::new(&text);
    let exit = wscript(&script, true, [("HONSEN_UPDATE_TEXT", text)])?.wait().map_err(|error| format!("UPDATE_PROMPT_FAILED: {error}"))?.code();
    match exit { Some(10) => Ok("Yes".into()), Some(11) => Ok("No".into()), Some(12) => Ok("Cancel".into()), _ => Err("UPDATE_PROMPT_FAILED: Could not show update prompt.".into()) }
}
fn installer_log_path(app_id: &str) -> Result<PathBuf, String> { Ok(PathBuf::from(env::var_os("LOCALAPPDATA").ok_or("UPDATE_LOG_FAILED: LOCALAPPDATA is unavailable.")?).join("Honsen Program").join("UpdateLogs").join(format!("{app_id}.log"))) }
fn completed_at() -> String {
    hidden_powershell().args(["-NoProfile", "-Command", "[DateTime]::UtcNow.ToString('o')"]).output().ok()
        .filter(|output| output.status.success()).map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned()).filter(|value| !value.is_empty())
        .unwrap_or_else(|| SystemTime::now().duration_since(UNIX_EPOCH).map(|value| value.as_secs().to_string()).unwrap_or_default())
}
fn write_result(path: &Path, result: &UpdateResult) -> Result<(), String> { fs::create_dir_all(path.parent().unwrap()).map_err(|error| format!("UPDATE_RESULT_FAILED: {error}"))?; let json = serde_json::to_vec_pretty(result).map_err(|error| format!("UPDATE_RESULT_FAILED: {error}"))?; let mut file = fs::File::create(path).map_err(|error| format!("UPDATE_RESULT_FAILED: {error}"))?; file.write_all(&json).map_err(|error| format!("UPDATE_RESULT_FAILED: {error}")) }
fn write_apply_result(path: &Path, result: &UpdateResult) -> Result<(), String> {
    let parent = path.parent().ok_or("UPDATE_RESULT_FAILED: Result parent is missing.")?;
    fs::create_dir_all(parent).map_err(|error| format!("UPDATE_RESULT_FAILED: {error}"))?;
    let temp = parent.join(format!(".{}-{}.tmp", result.operation_id, std::process::id()));
    let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temp).map_err(|error| format!("UPDATE_RESULT_FAILED: {error}"))?;
    let write = || -> Result<(), String> {
        serde_json::to_writer_pretty(&mut file, result).map_err(|error| format!("UPDATE_RESULT_FAILED: {error}"))?;
        file.sync_all().map_err(|error| format!("UPDATE_RESULT_FAILED: {error}"))?;
        drop(file);
        let from: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
        let to: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        if unsafe { MoveFileW(from.as_ptr(), to.as_ptr()) } == 0 { return Err(format!("UPDATE_RESULT_FAILED: {}", std::io::Error::last_os_error())); }
        Ok(())
    };
    let outcome = write();
    if outcome.is_err() { let _ = fs::remove_file(temp); }
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installer_status_distinguishes_uac_and_exit_failures() {
        assert!(installer_outcome("exit:0").is_ok());
        assert!(installer_outcome("cancelled").unwrap_err().starts_with("UPDATE_UAC_CANCELLED:"));
        assert!(installer_outcome("start-failed").unwrap_err().starts_with("UPDATE_INSTALLER_START_FAILED:"));
        assert!(installer_outcome("exit:5").unwrap_err().starts_with("INSTALLER_EXIT_5:"));
        assert!(installer_outcome("garbage").is_err());
        assert_eq!(quoted_path_argument("/DIR=", Path::new("C:\\中文 目录\\")).unwrap(), "\"/DIR=C:\\中文 目录\\\\\"");
    }

    #[test]
    fn apply_result_is_not_overwritten() {
        let dir = env::temp_dir().join(format!("honsen-result-test-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("result.json");
        let result = UpdateResult { app_id: APP_ID.into(), operation_id: "test".into(), status: "failed".into(), source: "app".into(), from_version: None, to_version: "1.0.0".into(), install_location: None, executable_path: None, step: Some("identity-validation".into()), installer_exit_code: None, installer_log_path: None, message: None, completed_at_utc: "2026-01-01T00:00:00Z".into() };
        write_apply_result(&path, &result).unwrap();
        let original = fs::read(&path).unwrap();
        assert!(write_apply_result(&path, &result).is_err());
        assert_eq!(fs::read(&path).unwrap(), original);
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn simultaneous_result_publications_have_one_winner() {
        let dir = env::temp_dir().join(format!("honsen-concurrent-test-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&dir).unwrap();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let threads: Vec<_> = (0..2).map(|index| {
            let path = dir.join("result.json");
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                let result = UpdateResult { app_id: APP_ID.into(), operation_id: format!("test-{index}"), status: "failed".into(), source: "app".into(), from_version: None, to_version: "1.0.0".into(), install_location: None, executable_path: None, step: Some("identity-validation".into()), installer_exit_code: None, installer_log_path: None, message: None, completed_at_utc: "2026-01-01T00:00:00Z".into() };
                barrier.wait();
                write_apply_result(&path, &result)
            })
        }).collect();
        let successes = threads.into_iter().map(|thread| thread.join().unwrap()).filter(Result::is_ok).count();
        assert_eq!(successes, 1);
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        let parsed: serde_json::Value = serde_json::from_slice(&fs::read(dir.join("result.json")).unwrap()).unwrap();
        assert_eq!(parsed["status"], "failed");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn result_write_failure_does_not_publish_success() {
        let dir = env::temp_dir().join(format!("honsen-write-test-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&dir).unwrap();
        let blocker = dir.join("not-a-directory");
        fs::write(&blocker, b"unchanged").unwrap();
        let result = UpdateResult { app_id: APP_ID.into(), operation_id: "test".into(), status: "success".into(), source: "app".into(), from_version: None, to_version: "1.0.0".into(), install_location: None, executable_path: None, step: None, installer_exit_code: Some(0), installer_log_path: None, message: None, completed_at_utc: "2026-01-01T00:00:00Z".into() };
        assert!(write_apply_result(&blocker.join("result.json"), &result).is_err());
        assert_eq!(fs::read(&blocker).unwrap(), b"unchanged");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn wrong_identity_writes_failure_result() {
        let dir = env::temp_dir().join(format!("honsen-identity-test-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("result.json");
        let args = Arguments { source: "toolbox".into(), app_id: "honsen.other".into(), wait_pid: 0, installer: dir.join("setup.exe"), sha256: "a".repeat(64), target_dir: dir.clone(), expected_version: "1.0.0".into(), restart: false, operation_id: "test".into(), result_path: path.clone() };
        assert!(run_update(args).is_err());
        let result: serde_json::Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
        assert_eq!(result["status"], "failed");
        assert_eq!(result["step"], "UPDATE_IDENTITY_FAILED");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn rejects_manifest_version_mismatch() {
        let manifest = r#"{"schemaVersion":1,"appId":"honsen.document-translator","displayName":"Honsen Document Translator","version":"1.4.10","executable":"HonsenPdfTranslator.exe","updateRunner":"HonsenUpdateRunner.exe","publisher":"Honsen","updateManifestUrl":"https://example.test"}"#;
        let manifest: Manifest = serde_json::from_str(manifest).unwrap();
        assert!(!manifest_matches(&manifest, "1.4.11", "https://example.test"));
        assert!(manifest_matches(&manifest, "1.4.10", "https://example.test"));
    }

    #[test]
    fn accepts_canonical_install_path_after_update() {
        let path = std::env::temp_dir();
        let canonical = path.canonicalize().unwrap();
        assert!(same_install_path(&path, &canonical));
    }

    #[test]
    fn installer_launch_waits_for_an_in_progress_update() {
        let id = format!("test.{}.{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos());
        let lock = acquire_lock(&id).unwrap();
        let (sent, received) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || { let _lock = wait_for_update_lock(&id).unwrap(); sent.send(()).unwrap(); });
        assert!(received.recv_timeout(Duration::from_millis(100)).is_err());
        drop(lock);
        received.recv_timeout(Duration::from_secs(5)).unwrap();
        worker.join().unwrap();
    }

    #[test]
    fn accepts_the_shared_update_runner_contract() {
        let args = vec!["runner".into(), "apply".into(), "--source".into(), "app".into(), "--app-id".into(), APP_ID.into(), "--wait-pid".into(), "0".into(), "--installer".into(), "C:\\update.exe".into(), "--sha256".into(), "a".repeat(64), "--target-dir".into(), "C:\\Honsen".into(), "--expected-version".into(), "1.3.2".into(), "--restart".into(), "true".into(), "--operation-id".into(), "0f3b2a90-34c4-4d99-bd17-a964da43f6a6".into(), "--result-path".into(), "C:\\Results\\0f3b2a90-34c4-4d99-bd17-a964da43f6a6.json".into()];
        assert_eq!(parse_arguments(&args).unwrap().app_id, APP_ID);
        assert!(parse_arguments(&args[..args.len()-4]).is_err());
    }

    #[test]
    fn compares_all_significant_file_version_parts() {
        assert!(versions_match("1.4.11.0", "1.4.11"));
        assert!(versions_match("1.4.11.2", "1.4.11.2"));
        assert!(!versions_match("1.4.11.3", "1.4.11.2"));
        assert!(!versions_match("1.4.11.1", "1.4.11"));
    }
    #[test]
    fn keeps_the_toolbox_operation_result_path() {
        let args = vec!["runner".into(), "apply".into(), "--source".into(), "toolbox".into(), "--app-id".into(), APP_ID.into(), "--wait-pid".into(), "0".into(), "--installer".into(), "C:\\update.exe".into(), "--sha256".into(), "a".repeat(64), "--target-dir".into(), "C:\\Honsen".into(), "--expected-version".into(), "1.4.3".into(), "--restart".into(), "false".into(), "--operation-id".into(), "0f3b2a90-34c4-4d99-bd17-a964da43f6a6".into(), "--result-path".into(), "C:\\Results\\0f3b2a90-34c4-4d99-bd17-a964da43f6a6.json".into()];
        let parsed = parse_arguments(&args).unwrap();
        assert_eq!(parsed.operation_id, "0f3b2a90-34c4-4d99-bd17-a964da43f6a6"); assert_eq!(parsed.result_path, PathBuf::from("C:\\Results\\0f3b2a90-34c4-4d99-bd17-a964da43f6a6.json"));
    }

    #[test]
    fn accepts_toolbox_launch_result_arguments() {
        let args = vec!["runner".into(), "launch".into(), "--source".into(), "toolbox".into(), "--operation-id".into(), "open-1".into(), "--result-path".into(), "C:\\Results\\open-1.json".into()];
        let parsed = parse_launch(&args).unwrap();
        assert_eq!(parsed.source, "toolbox"); assert_eq!(parsed.operation_id, "open-1");
    }
}
