#![windows_subsystem = "windows"]

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{env, ffi::OsStr, fs, io::Write, os::windows::ffi::OsStrExt, path::{Path, PathBuf}, process::{Command, ExitCode}, ptr, time::{Duration, SystemTime, UNIX_EPOCH}};
use windows_sys::Win32::{Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS, ERROR_INVALID_PARAMETER, HANDLE, WAIT_OBJECT_0, WAIT_TIMEOUT}, System::Threading::{CreateMutexW, OpenProcess, QueryFullProcessImageNameW, ReleaseMutex, TerminateProcess, WaitForSingleObject, INFINITE, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE, PROCESS_TERMINATE}};
use winreg::{enums::*, RegKey};

const APP_ID: &str = "honsen.document-translator";
const REGISTRY_KEY: &str = "Software\\Honsen Program\\Apps\\honsen.document-translator";
const RUNNER_NAME: &str = "HonsenUpdateRunner.exe";
const EXE_NAME: &str = "HonsenPdfTranslator.exe";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    app_id: String,
    version: String,
    executable: String,
    update_runner: String,
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
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateResult {
    app_id: String,
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

#[derive(Deserialize)] struct GithubRelease { tag_name: String, draft: bool, prerelease: bool, assets: Vec<GithubAsset> }
#[derive(Deserialize)] struct GithubAsset { name: String, browser_download_url: String }
#[derive(Deserialize)] struct Checksums { assets: Vec<Checksum> }
#[derive(Deserialize)] struct Checksum { name: String, sha256: String }

impl Drop for UpdateLock {
    fn drop(&mut self) { unsafe { ReleaseMutex(self.0); CloseHandle(self.0); } }
}

fn main() -> ExitCode {
    let raw = env::args().collect::<Vec<_>>();
    if !raw.iter().any(|value| value == "--runner-copied") {
        return match copy_and_relaunch(&raw) {
            Ok(()) => ExitCode::SUCCESS,
            Err(error) => { eprintln!("{error}"); ExitCode::from(1) }
        };
    }
    let result = match raw.get(1).map(String::as_str) {
        Some("launch") => parse_launch(&raw).and_then(|pid| run_launch("app", pid)),
        Some("repair") => parse_launch(&raw).and_then(|pid| run_launch("repair", pid)),
        _ => parse_arguments(&raw).and_then(run_update),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => { eprintln!("{error}"); ExitCode::from(1) }
    }
}

fn parse_launch(raw: &[String]) -> Result<u32, String> {
    let value = |name: &str| raw.windows(2).find_map(|pair| (pair[0] == name).then(|| pair[1].as_str()));
    if let Some(app_id) = value("--app-id") { if app_id != APP_ID { return Err("UPDATE_IDENTITY_FAILED: Unexpected appId.".into()); } }
    value("--wait-pid").map(|value| value.parse().map_err(|_| "RUNNER_ARGUMENTS_INVALID: --wait-pid must be an integer.".into())).transpose().map(|value| value.unwrap_or(0))
}

fn run_launch(source: &str, wait_pid: u32) -> Result<(), String> {
    let before = registry_record().ok();
    let outcome = run_launch_inner(wait_pid);
    let result = match &outcome {
        Ok(record) => UpdateResult { app_id: APP_ID.into(), status: "success".into(), source: source.into(), from_version: before.as_ref().map(|value| value.version.clone()), to_version: record.version.clone(), install_location: Some(record.install_location.to_string_lossy().into_owned()), executable_path: Some(record.executable_path.to_string_lossy().into_owned()), step: None, installer_exit_code: Some(0), installer_log_path: Some(installer_log_path(APP_ID)?.to_string_lossy().into_owned()), message: None, completed_at_utc: completed_at() },
        Err(error) => UpdateResult { app_id: APP_ID.into(), status: "failed".into(), source: source.into(), from_version: before.as_ref().map(|value| value.version.clone()), to_version: before.as_ref().map(|value| value.version.clone()).unwrap_or_default(), install_location: before.as_ref().map(|value| value.install_location.to_string_lossy().into_owned()), executable_path: before.as_ref().map(|value| value.executable_path.to_string_lossy().into_owned()), step: Some(error.split(':').next().unwrap_or("UPDATE_FAILED").into()), installer_exit_code: installer_exit_code(error), installer_log_path: installer_log_path(APP_ID).ok().map(|value| value.to_string_lossy().into_owned()), message: Some(error.clone()), completed_at_utc: completed_at() },
    };
    write_result(&result_path(APP_ID)?, &result)?;
    outcome.map(|_| ())
}

fn run_launch_inner(wait_pid: u32) -> Result<RegistryRecord, String> {
    let record = validate_install(&registry_record()?.install_location.canonicalize().map_err(|_| "UPDATE_TARGET_FAILED: InstallLocation is missing.")?)?;
    let client = reqwest::blocking::Client::builder().user_agent("Honsen-Document-Translator-Updater").timeout(Duration::from_secs(60)).build().map_err(|error| format!("UPDATE_CHECK_FAILED: {error}"))?;
    let release = client.get(&record.update_manifest_url).send().map_err(|_| "UPDATE_CHECK_FAILED: Could not contact the update manifest.")?.error_for_status().map_err(|_| "UPDATE_CHECK_FAILED: The update manifest returned an error.")?.json::<GithubRelease>().map_err(|_| "UPDATE_CHECK_FAILED: Release metadata is invalid.")?;
    if release.draft || release.prerelease || !is_newer(&release.tag_name, &record.version) { Command::new(&record.executable_path).spawn().map_err(|error| format!("UPDATE_RESTART_FAILED: {error}"))?; return Ok(record); }
    let installer = release.assets.iter().find(|asset| asset.name == "Honsen-Document-Translator-Setup.exe").ok_or("UPDATE_CHECK_FAILED: Release installer is missing.")?;
    let sums = release.assets.iter().find(|asset| asset.name == "SHA256SUMS.json").ok_or("UPDATE_CHECK_FAILED: Release checksums are missing.")?;
    let sums = client.get(&sums.browser_download_url).send().map_err(|_| "UPDATE_CHECK_FAILED: Could not download checksums.")?.json::<Checksums>().map_err(|_| "UPDATE_CHECK_FAILED: Checksums are invalid.")?;
    let sha256 = sums.assets.into_iter().find(|entry| entry.name == installer.name).map(|entry| entry.sha256).ok_or("UPDATE_CHECK_FAILED: Installer SHA-256 is missing.")?;
    let bytes = client.get(&installer.browser_download_url).send().map_err(|_| "UPDATE_DOWNLOAD_FAILED: Could not download installer.")?.bytes().map_err(|_| "UPDATE_DOWNLOAD_FAILED: Could not read installer.")?;
    let path = env::temp_dir().join(format!("honsen-document-translator-{}.exe", release.tag_name));
    fs::write(&path, bytes).map_err(|error| format!("UPDATE_DOWNLOAD_FAILED: {error}"))?;
    run_update(Arguments { source: "app".into(), app_id: APP_ID.into(), wait_pid, installer: path, sha256, target_dir: record.install_location, expected_version: release.tag_name.trim_start_matches('v').into(), restart: true })?;
    registry_record()
}

fn is_newer(candidate: &str, current: &str) -> bool { let parse = |value: &str| value.trim_start_matches('v').split('.').map(str::parse::<u32>).collect::<Result<Vec<_>, _>>(); matches!((parse(candidate), parse(current)), (Ok(candidate), Ok(current)) if candidate > current) }

fn copy_and_relaunch(raw: &[String]) -> Result<(), String> {
    let exe = env::current_exe().map_err(|error| format!("RUNNER_PATH_FAILED: {error}"))?;
    let app_id = raw.windows(2).find_map(|pair| (pair[0] == "--app-id").then(|| pair[1].clone())).unwrap_or_else(|| APP_ID.into());
    if app_id != APP_ID { return Err("UPDATE_IDENTITY_FAILED: Unexpected appId.".into()); }
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
    Ok(Arguments { source, app_id, wait_pid, installer: PathBuf::from(value("--installer")?), sha256, target_dir: PathBuf::from(value("--target-dir")?), expected_version, restart })
}

fn run_update(arguments: Arguments) -> Result<(), String> {
    if arguments.app_id != APP_ID { return Err("UPDATE_IDENTITY_FAILED: Unexpected appId.".into()); }
    let result_path = result_path(&arguments.app_id)?;
    let from_version = registry_record().ok().map(|record| record.version);
    let outcome = update(&arguments, from_version.as_deref().unwrap_or_default());
    let result = match &outcome {
        Ok(record) => UpdateResult { app_id: arguments.app_id.clone(), status: "success".into(), source: arguments.source.clone(), from_version, to_version: arguments.expected_version.clone(), install_location: Some(record.install_location.to_string_lossy().into_owned()), executable_path: Some(record.executable_path.to_string_lossy().into_owned()), step: None, installer_exit_code: Some(0), installer_log_path: Some(installer_log_path(&arguments.app_id)?.to_string_lossy().into_owned()), message: None, completed_at_utc: completed_at() },
        Err(error) => UpdateResult { app_id: arguments.app_id.clone(), status: "failed".into(), source: arguments.source.clone(), from_version, to_version: arguments.expected_version.clone(), install_location: Some(arguments.target_dir.to_string_lossy().into_owned()), executable_path: None, step: Some(error.split(':').next().unwrap_or("UPDATE_FAILED").to_owned()), installer_exit_code: installer_exit_code(error), installer_log_path: Some(installer_log_path(&arguments.app_id)?.to_string_lossy().into_owned()), message: Some(error.clone()), completed_at_utc: completed_at() },
    };
    write_result(&result_path, &result)?;
    outcome.map(|_| ())
}

fn update(arguments: &Arguments, from_version: &str) -> Result<RegistryRecord, String> {
    let _lock = acquire_lock(&arguments.app_id)?;
    let target = arguments.target_dir.canonicalize().map_err(|_| "UPDATE_TARGET_FAILED: Target directory does not exist.".to_owned())?;
    let before = validate_install(&target)?;
    if before.version != from_version { return Err("UPDATE_REGISTRY_FAILED: Registry version changed before update started.".into()); }
    verify_hash(&arguments.installer, &arguments.sha256)?;
    wait_for_exit(arguments.wait_pid, &before.executable_path)?;
    let log = installer_log_path(&arguments.app_id)?;
    if let Some(parent) = log.parent() { fs::create_dir_all(parent).map_err(|error| format!("UPDATE_LOG_FAILED: {error}"))?; }
    let exit = Command::new(&arguments.installer).args(["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/SP-", &format!("/DIR={}", target.display()), &format!("/LOG={}", log.display())])
        .status().map_err(|error| format!("UPDATE_INSTALLER_START_FAILED: {error}"))?;
    if !exit.success() { return Err(format!("INSTALLER_EXIT_{}: Inno Setup exited with {:?}.", exit.code().unwrap_or(-1), exit.code())); }
    if fs::read_to_string(&log).map_or(true, |content| content.trim().is_empty()) { return Err("UPDATE_LOG_FAILED: Inno Setup did not create a readable installation log.".into()); }
    let after = validate_install(&target)?;
    if after.install_location != target || after.version != arguments.expected_version { return Err("UPDATE_VERIFICATION_FAILED: Installed registry state does not match the requested version and directory.".into()); }
    let manifest = load_manifest(&target)?;
    if manifest.version != arguments.expected_version { return Err("UPDATE_VERIFICATION_FAILED: honsen.app.json has an unexpected version.".into()); }
    if release_version(&executable_version(&after.executable_path)?) != arguments.expected_version { return Err("UPDATE_VERIFICATION_FAILED: Main EXE has an unexpected file version.".into()); }
    if arguments.restart { Command::new(&after.executable_path).spawn().map_err(|error| format!("UPDATE_RESTART_FAILED: {error}"))?; }
    Ok(after)
}

fn acquire_lock(app_id: &str) -> Result<UpdateLock, String> {
    let name = wide(&format!("Local\\HonsenUpdateRunner-{app_id}"));
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
    if !record.executable_path.is_file() || !record.update_runner_path.is_file() { return Err("UPDATE_IDENTITY_FAILED: Registered executable or update runner is missing.".into()); }
    let manifest = load_manifest(target)?;
    if manifest.app_id != APP_ID || manifest.executable != EXE_NAME || manifest.update_runner != RUNNER_NAME || manifest.update_manifest_url.is_empty() || manifest.update_manifest_url != record.update_manifest_url || record.executable_path.file_name().and_then(|value| value.to_str()) != Some(manifest.executable.as_str()) { return Err("UPDATE_IDENTITY_FAILED: honsen.app.json does not match the registered application.".into()); }
    Ok(record)
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

fn executable_version(executable: &Path) -> Result<String, String> {
    let output = Command::new("powershell.exe").args(["-NoProfile", "-Command", "(Get-Item -LiteralPath $env:HONSEN_UPDATE_EXE).VersionInfo.FileVersion"]).env("HONSEN_UPDATE_EXE", executable)
        .output().map_err(|error| format!("UPDATE_VERIFICATION_FAILED: {error}"))?;
    let version = String::from_utf8_lossy(&output.stdout).trim().trim_start_matches('v').to_owned();
    if output.status.success() && !version.is_empty() { Ok(version) } else { Err("UPDATE_VERIFICATION_FAILED: Could not read the main EXE version.".into()) }
}

fn wide(value: &str) -> Vec<u16> { OsStr::new(value).encode_wide().chain(Some(0)).collect() }
fn release_version(value: &str) -> String { value.trim_start_matches('v').split('.').take(3).collect::<Vec<_>>().join(".") }
fn valid_version(value: &str) -> bool { value.split('.').count() >= 3 && value.split('.').all(|part| !part.is_empty() && part.parse::<u32>().is_ok()) }
fn installer_exit_code(error: &str) -> Option<i32> { error.strip_prefix("INSTALLER_EXIT_").and_then(|value| value.split(':').next()).and_then(|value| value.parse().ok()) }

fn result_path(app_id: &str) -> Result<PathBuf, String> { Ok(PathBuf::from(env::var_os("LOCALAPPDATA").ok_or("UPDATE_RESULT_FAILED: LOCALAPPDATA is unavailable.")?).join("Honsen Program").join("UpdateResults").join(format!("{app_id}.json"))) }
fn installer_log_path(app_id: &str) -> Result<PathBuf, String> { Ok(PathBuf::from(env::var_os("LOCALAPPDATA").ok_or("UPDATE_LOG_FAILED: LOCALAPPDATA is unavailable.")?).join("Honsen Program").join("UpdateLogs").join(format!("{app_id}.log"))) }
fn completed_at() -> String {
    Command::new("powershell.exe").args(["-NoProfile", "-Command", "[DateTime]::UtcNow.ToString('o')"]).output().ok()
        .filter(|output| output.status.success()).map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned()).filter(|value| !value.is_empty())
        .unwrap_or_else(|| SystemTime::now().duration_since(UNIX_EPOCH).map(|value| value.as_secs().to_string()).unwrap_or_default())
}
fn write_result(path: &Path, result: &UpdateResult) -> Result<(), String> { fs::create_dir_all(path.parent().unwrap()).map_err(|error| format!("UPDATE_RESULT_FAILED: {error}"))?; let json = serde_json::to_vec_pretty(result).map_err(|error| format!("UPDATE_RESULT_FAILED: {error}"))?; let mut file = fs::File::create(path).map_err(|error| format!("UPDATE_RESULT_FAILED: {error}"))?; file.write_all(&json).map_err(|error| format!("UPDATE_RESULT_FAILED: {error}")) }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_the_shared_update_runner_contract() {
        let args = vec!["runner".into(), "apply".into(), "--source".into(), "app".into(), "--app-id".into(), APP_ID.into(), "--wait-pid".into(), "0".into(), "--installer".into(), "update.exe".into(), "--sha256".into(), "a".repeat(64), "--target-dir".into(), "C:\\Honsen".into(), "--expected-version".into(), "1.3.2".into(), "--restart".into(), "true".into()];
        assert_eq!(parse_arguments(&args).unwrap().app_id, APP_ID);
    }

    #[test]
    fn accepts_windows_four_part_file_versions() {
        assert_eq!(release_version("1.4.0.0"), "1.4.0");
    }
}
