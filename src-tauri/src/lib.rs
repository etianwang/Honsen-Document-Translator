use std::{ffi::OsStr, fs, io::{BufRead, BufReader, Write}, os::windows::process::CommandExt, path::PathBuf, process::{Command, Stdio}, time::{Duration, SystemTime, UNIX_EPOCH}};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{Emitter, Manager};
use winreg::{enums::*, RegKey};

const DEEPL_FREE_ENDPOINT: &str = "https://api-free.deepl.com/v2/translate";
const DEEPL_PRO_ENDPOINT: &str = "https://api.deepl.com/v2/translate";
const KEYRING_SERVICE: &str = "Honsen PDF Translator";
const KEYRING_ACCOUNT: &str = "deepl-api-key";
const UPDATE_REPOSITORY: &str = "etianwang/Honsen-Document-Translator";
const UPDATE_INSTALLER: &str = "Honsen-Document-Translator-Setup.exe";
const UPDATE_CHECKSUMS: &str = "SHA256SUMS.json";
const HONSEN_APP_ID: &str = "honsen.document-translator";
const HONSEN_UPDATE_RUNNER: &str = "HonsenUpdateRunner.exe";
const HONSEN_MAIN_EXE: &str = "HonsenPdfTranslator.exe";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const DOCX_TRANSLATION_SCRIPT: &str = r#"
import json, os, sys, tempfile, urllib.parse, urllib.request
from pdf2docx import Converter
from docx import Document

source, output, target, source_lang = sys.argv[1:]
handle, temporary = tempfile.mkstemp(suffix='.docx'); os.close(handle)
try:
    converter = Converter(source); converter.convert(temporary); converter.close()
    document = Document(temporary)
    seen = set()
    def paragraphs(parent):
        for paragraph in parent.paragraphs: yield paragraph
        for table in parent.tables:
            for row in table.rows:
                for cell in row.cells: yield from paragraphs(cell)
    def keep(value):
        value = value.strip()
        return not value or all(character.isdigit() or character in ' .,:/%+-×xX' for character in value) or (len(value) <= 4 and all(character.isupper() or character == '.' for character in value))
    items = []
    for paragraph in paragraphs(document):
        if id(paragraph._p) in seen: continue
        seen.add(id(paragraph._p)); value = ''.join(run.text for run in paragraph.runs)
        if paragraph.runs and not keep(value): items.append((paragraph, value))
    endpoint = 'https://api-free.deepl.com/v2/translate' if os.environ['DEEPL_API_KEY'].endswith(':fx') else 'https://api.deepl.com/v2/translate'
    for start in range(0, len(items), 50):
        batch = items[start:start + 50]
        fields = [('text', value) for _, value in batch] + [('target_lang', target)]
        if source_lang: fields.append(('source_lang', source_lang))
        request = urllib.request.Request(endpoint, data=urllib.parse.urlencode(fields).encode(), headers={'Authorization': 'DeepL-Auth-Key ' + os.environ['DEEPL_API_KEY']})
        response = json.loads(urllib.request.urlopen(request, timeout=30).read())['translations']
        for (paragraph, _), translation in zip(batch, response):
            paragraph.runs[0].text = translation['text']
            for run in paragraph.runs[1:]: run.text = ''
    document.save(output)
finally:
    if os.path.exists(temporary): os.remove(temporary)
"#;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeepLRequest {
    segments: Vec<String>,
    target_language: String,
    source_language: Option<String>,
    api_key: Option<String>,
}

#[derive(Debug, Serialize)]
struct DeepLResponse {
    translations: Vec<String>,
}

#[derive(Deserialize)]
struct DeepLApiResponse {
    translations: Vec<DeepLApiTranslation>,
}

#[derive(Deserialize)]
struct DeepLApiTranslation {
    text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveDeepLKeyRequest {
    api_key: String,
    remember: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeepLKeyStatus {
    configured: bool,
    source: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OcrPdfRequest {
    source_path: String,
    page_number: u32,
    page_width: f32,
    page_height: f32,
    language: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OcrPdfResponse {
    page_number: u32,
    text: Vec<OcrText>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WordTranslationRequest {
    source_path: String,
    output_path: String,
    target_language: String,
    source_language: Option<String>,
    api_key: Option<String>,
    format: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct GlossaryEntryRequest {
    source: String,
    target: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DocumentTranslationRequest {
    source_path: String,
    output_path: String,
    source_type: String,
    target_language: String,
    source_language: Option<String>,
    api_key: Option<String>,
    glossary: Vec<GlossaryEntryRequest>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DocumentPreviewRequest {
    source_path: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[derive(Clone)]
struct DocumentTranslationProgress {
    stage: String,
    completed: usize,
    total: usize,
}

#[derive(Serialize)]
struct OcrText {
    text: String,
    bbox: OcrBox,
    confidence: f32,
}

#[derive(Serialize)]
struct OcrBox { x: f32, y: f32, width: f32, height: f32 }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticEvent { stage: String, code: String, page_number: Option<u32> }

#[derive(Deserialize)]
struct GithubRelease { tag_name: String, draft: bool, prerelease: bool, body: Option<String>, assets: Vec<GithubAsset> }

#[derive(Deserialize)]
struct GithubAsset { name: String, browser_download_url: String }

#[derive(Deserialize)]
struct ReleaseChecksums { assets: Vec<ReleaseChecksum> }

#[derive(Deserialize)]
struct ReleaseChecksum { name: String, sha256: String }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateStatus { available: bool, current_version: String, version: Option<String>, release_notes: Option<String> }

struct AvailableUpdate { version: String, release_notes: String, installer_url: String, sha256: String }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HonsenAppManifest { app_id: String, executable: String, update_runner: String, update_manifest_url: String }

fn background_command(program: impl AsRef<OsStr>) -> Command {
    let mut command = Command::new(program);
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

fn deepl_key(provided_key: Option<&str>) -> Result<String, String> {
    if let Some(key) = provided_key.filter(|key| !key.trim().is_empty()) { return Ok(key.trim().to_owned()); }
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT) {
        if let Ok(key) = entry.get_password() {
            if !key.trim().is_empty() { return Ok(key); }
        }
    }
    load_local_dotenv();
    ["DEEPL_API_KEY", "DEEPL_AUTH_KEY", "DEEPL_API_TOKEN"]
        .iter()
        .find_map(|name| std::env::var(name).ok().filter(|value| !value.trim().is_empty()))
        .ok_or_else(|| "DEEPL_NOT_CONFIGURED: Set DEEPL_API_KEY in the local .env file.".to_owned())
}

#[tauri::command]
fn record_diagnostic(app: tauri::AppHandle, event: DiagnosticEvent) -> Result<(), String> {
    if !valid_diagnostic_event(&event) { return Err("DIAGNOSTIC_INVALID_EVENT: Unsupported diagnostic event.".into()); }
    let directory = app.path().app_log_dir().map_err(|_| "DIAGNOSTIC_UNAVAILABLE: Could not open the diagnostics directory.".to_owned())?;
    let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| "DIAGNOSTIC_UNAVAILABLE: Could not create a diagnostic timestamp.".to_owned())?.as_secs();
    append_diagnostic(&directory, &event, timestamp)
}

fn append_diagnostic(directory: &std::path::Path, event: &DiagnosticEvent, timestamp: u64) -> Result<(), String> {
    fs::create_dir_all(directory).map_err(|_| "DIAGNOSTIC_UNAVAILABLE: Could not open the diagnostics directory.".to_owned())?;
    let line = serde_json::json!({ "timestamp": timestamp, "stage": event.stage, "code": event.code, "pageNumber": event.page_number });
    let mut output = fs::OpenOptions::new().create(true).append(true).open(directory.join("diagnostics.jsonl"))
        .map_err(|_| "DIAGNOSTIC_UNAVAILABLE: Could not write diagnostics.".to_owned())?;
    writeln!(output, "{line}").map_err(|_| "DIAGNOSTIC_UNAVAILABLE: Could not write diagnostics.".to_owned())
}

fn valid_diagnostic_event(event: &DiagnosticEvent) -> bool {
    matches!(event.stage.as_str(), "import" | "ocr" | "translation" | "docx-export" | "pdf-export" | "update" | "glossary" | "credential")
        && event.code.len() <= 64 && event.code.bytes().all(|byte| byte.is_ascii_uppercase() || byte == b'_')
        && event.page_number.is_none_or(|page| (1..=100_000).contains(&page))
}

#[tauri::command]
async fn legacy_check_for_update() -> Result<UpdateStatus, String> {
    Ok(update_status(latest_update().await?))
}

fn update_status(update: Option<AvailableUpdate>) -> UpdateStatus {
    UpdateStatus {
        available: update.is_some(), current_version: env!("CARGO_PKG_VERSION").into(),
        version: update.as_ref().map(|value| value.version.clone()),
        release_notes: update.map(|value| value.release_notes),
    }
}

#[tauri::command]
async fn legacy_install_update(app: tauri::AppHandle) -> Result<(), String> {
    let update = latest_update().await?.ok_or("UPDATE_NOT_AVAILABLE: No newer verified release is available.")?;
    let bytes = update_client()?.get(&update.installer_url).send().await
        .map_err(|_| "UPDATE_DOWNLOAD_FAILED: Could not download the installer.")?
        .error_for_status().map_err(|_| "UPDATE_DOWNLOAD_FAILED: The installer download failed.")?
        .bytes().await.map_err(|_| "UPDATE_DOWNLOAD_FAILED: Could not read the installer.")?;
    let actual = format!("{:x}", Sha256::digest(&bytes));
    if !actual.eq_ignore_ascii_case(&update.sha256) { return Err("UPDATE_CHECKSUM_FAILED: Downloaded installer did not match the published SHA-256 checksum.".into()); }
    let installer = std::env::temp_dir().join(format!("honsen-pdf-translator-{}-setup.exe", update.version));
    fs::write(&installer, bytes).map_err(|error| format!("UPDATE_DOWNLOAD_FAILED: {error}"))?;
    let (target_dir, runner) = installed_update_paths()?;
    let pid = std::process::id().to_string();
    let installer = installer.to_string_lossy().into_owned();
    let target_dir = target_dir.to_string_lossy().into_owned();
    background_command(&runner).args([
        "apply", "--source", "app", "--app-id", HONSEN_APP_ID, "--wait-pid", &pid,
        "--installer", &installer, "--sha256", &update.sha256,
        "--target-dir", &target_dir, "--expected-version", &update.version, "--restart", "true",
    ]).spawn().map_err(|error| format!("UPDATE_RUNNER_START_FAILED: {error}"))?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
async fn check_for_update() -> Result<UpdateStatus, String> {
    let _ = installed_update_paths()?;
    Ok(UpdateStatus { available: false, current_version: env!("CARGO_PKG_VERSION").into(), version: None, release_notes: Some("更新服务正常。启动应用时将由 HonsenUpdateRunner 检查更新。".into()) })
}

#[tauri::command]
fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    let (_, runner) = installed_update_paths()?;
    background_command(runner).arg("launch").spawn().map_err(|error| format!("UPDATE_RUNNER_START_FAILED: {error}"))?;
    app.exit(0);
    Ok(())
}

fn installed_update_paths() -> Result<(PathBuf, PathBuf), String> {
    let executable = std::env::current_exe().map_err(|error| format!("UPDATE_MANIFEST_FAILED: {error}"))?;
    let directory = executable.parent().ok_or("UPDATE_MANIFEST_FAILED: Application directory is unavailable.")?.to_path_buf();
    let manifest = fs::read_to_string(directory.join("honsen.app.json")).map_err(|_| "UPDATE_MANIFEST_FAILED: honsen.app.json is missing or not UTF-8.")?;
    let manifest: HonsenAppManifest = serde_json::from_str(&manifest).map_err(|_| "UPDATE_MANIFEST_FAILED: honsen.app.json is invalid.")?;
    if manifest.app_id != HONSEN_APP_ID || manifest.executable != HONSEN_MAIN_EXE || manifest.update_runner != HONSEN_UPDATE_RUNNER || manifest.update_manifest_url.is_empty() || executable.file_name().and_then(|value| value.to_str()) != Some(manifest.executable.as_str()) {
        return Err("UPDATE_MANIFEST_FAILED: honsen.app.json does not identify this installed application.".into());
    }
    let runner = directory.join(&manifest.update_runner);
    if !runner.is_file() { return Err("UPDATE_RUNNER_UNAVAILABLE: HonsenUpdateRunner.exe is missing from the application directory.".into()); }
    verify_honsen_registry(&directory, &executable, &runner, &manifest.update_manifest_url)?;
    Ok((directory, runner))
}

fn verify_honsen_registry(directory: &std::path::Path, executable: &std::path::Path, runner: &std::path::Path, update_manifest_url: &str) -> Result<(), String> {
    const KEY: &str = "Software\\Honsen Program\\Apps\\honsen.document-translator";
    let directory = directory.canonicalize().map_err(|_| "UPDATE_REGISTRY_FAILED: Application directory is unavailable.")?;
    for (hive, view) in [(HKEY_LOCAL_MACHINE, KEY_WOW64_64KEY), (HKEY_LOCAL_MACHINE, KEY_WOW64_32KEY), (HKEY_CURRENT_USER, KEY_WOW64_64KEY), (HKEY_CURRENT_USER, KEY_WOW64_32KEY)] {
        let root = RegKey::predef(hive);
        if let Ok(key) = root.open_subkey_with_flags(KEY, KEY_READ | view) {
            let same = |name: &str, expected: &std::path::Path| key.get_value::<String, _>(name).ok().and_then(|value| PathBuf::from(value).canonicalize().ok()).as_deref() == Some(expected);
            if key.get_value::<String, _>("AppId").ok().as_deref() == Some(HONSEN_APP_ID)
                && same("InstallLocation", &directory) && same("ExecutablePath", executable) && same("UpdateRunnerPath", runner) && same("LauncherPath", runner)
                && key.get_value::<String, _>("UpdateManifestUrl").ok().as_deref() == Some(update_manifest_url) {
                return Ok(());
            }
            return Err("UPDATE_REGISTRY_FAILED: Honsen Program registry record does not match this installation.".into());
        }
    }
    Err("UPDATE_REGISTRY_FAILED: Honsen Program registry record was not found.".into())
}

async fn latest_update() -> Result<Option<AvailableUpdate>, String> {
    if cfg!(debug_assertions) { return Ok(None); }
    let release = update_client()?.get(format!("https://api.github.com/repos/{UPDATE_REPOSITORY}/releases/latest")).send().await
        .map_err(|_| "UPDATE_CHECK_FAILED: Could not contact GitHub Releases.")?
        .error_for_status().map_err(|_| "UPDATE_CHECK_FAILED: GitHub Releases returned an error.")?
        .json::<GithubRelease>().await.map_err(|_| "UPDATE_CHECK_FAILED: GitHub Releases returned invalid metadata.")?;
    if release.draft || release.prerelease || !is_newer_version(&release.tag_name, env!("CARGO_PKG_VERSION")) { return Ok(None); }
    let installer = release.assets.iter().find(|asset| asset.name == UPDATE_INSTALLER).ok_or("UPDATE_CHECK_FAILED: Release installer asset is missing.")?;
    let checksums = release.assets.iter().find(|asset| asset.name == UPDATE_CHECKSUMS).ok_or("UPDATE_CHECK_FAILED: Release checksum asset is missing.")?;
    let checksums = update_client()?.get(&checksums.browser_download_url).send().await
        .map_err(|_| "UPDATE_CHECK_FAILED: Could not download release checksums.")?
        .error_for_status().map_err(|_| "UPDATE_CHECK_FAILED: Release checksum download failed.")?
        .json::<ReleaseChecksums>().await.map_err(|_| "UPDATE_CHECK_FAILED: Release checksums are invalid.")?;
    let sha256 = checksums.assets.into_iter().find(|entry| entry.name == UPDATE_INSTALLER)
        .map(|entry| entry.sha256).filter(|value| value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .ok_or("UPDATE_CHECK_FAILED: Installer SHA-256 is missing or invalid.")?;
    Ok(Some(AvailableUpdate {
        version: release.tag_name.trim_start_matches('v').to_owned(),
        release_notes: release.body.unwrap_or_default().chars().take(12_000).collect(),
        installer_url: installer.browser_download_url.clone(), sha256,
    }))
}

fn update_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().user_agent("Honsen-Document-Translator-Updater").timeout(Duration::from_secs(30)).build()
        .map_err(|_| "UPDATE_CHECK_FAILED: Could not initialize updater client.".into())
}

fn is_newer_version(candidate: &str, current: &str) -> bool {
    let parse = |value: &str| value.trim_start_matches('v').split('.').map(|part| part.parse::<u32>().ok()).collect::<Option<Vec<_>>>();
    match (parse(candidate), parse(current)) { (Some(candidate), Some(current)) => candidate > current, _ => false }
}

#[tauri::command]
fn save_deepl_api_key(request: SaveDeepLKeyRequest) -> Result<DeepLKeyStatus, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|_| "DEEPL_SECURE_STORAGE_FAILED: Windows Credential Manager is unavailable.".to_owned())?;
    if request.remember {
        let key = request.api_key.trim();
        if key.is_empty() { return Err("DEEPL_INVALID_KEY: Enter a DeepL API key before saving.".into()); }
        entry.set_password(key).map_err(|_| "DEEPL_SECURE_STORAGE_FAILED: Could not save the API key securely.".to_owned())?;
        return Ok(DeepLKeyStatus { configured: true, source: Some("Windows Credential Manager".into()) });
    }
    let _ = entry.delete_credential();
    Ok(DeepLKeyStatus { configured: false, source: None })
}

#[tauri::command]
fn deepl_key_status() -> DeepLKeyStatus {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT) {
        if entry.get_password().is_ok() { return DeepLKeyStatus { configured: true, source: Some("Windows Credential Manager".into()) }; }
    }
    load_local_dotenv();
    let configured = ["DEEPL_API_KEY", "DEEPL_AUTH_KEY", "DEEPL_API_TOKEN"].iter().any(|name| std::env::var(name).is_ok_and(|value| !value.trim().is_empty()));
    DeepLKeyStatus { configured, source: configured.then(|| ".env".into()) }
}

fn load_local_dotenv() {
    let Ok(current) = std::env::current_dir() else { return };
    for directory in [Some(current.as_path()), current.parent()].into_iter().flatten() {
        let candidate = directory.join(".env");
        if candidate.is_file() {
            let _ = dotenvy::from_path(candidate);
            return;
        }
    }
}

#[tauri::command]
fn ocr_pdf_page(request: OcrPdfRequest) -> Result<OcrPdfResponse, String> {
    if request.page_number == 0 || request.page_width <= 0.0 || request.page_height <= 0.0 { return Err("OCR_INVALID_REQUEST: Invalid page dimensions.".into()); }
    let source = PathBuf::from(&request.source_path);
    if !source.is_file() { return Err("OCR_INVALID_REQUEST: Source PDF does not exist.".into()); }
    let nonce = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|error| error.to_string())?.as_millis();
    let prefix = std::env::temp_dir().join(format!("honsen-ocr-{nonce}"));
    let image = prefix.with_extension("png");
    let render = background_command(pdftoppm_path()).args(["-f", &request.page_number.to_string(), "-l", &request.page_number.to_string(), "-r", "300", "-png", "-singlefile", source.to_string_lossy().as_ref(), prefix.to_string_lossy().as_ref()]).output()
        .map_err(|_| "OCR_ENGINE_UNAVAILABLE: Poppler pdftoppm was not found.".to_owned())?;
    if !render.status.success() || !image.is_file() { return Err("OCR_RENDER_FAILED: Could not render the PDF page for OCR.".into()); }
    let language = tesseract_language(request.language.as_deref())?;
    let mut command = background_command(tesseract_path());
    command.args([image.to_string_lossy().as_ref(), "stdout", "--psm", "3"]);
    if let Some(directory) = tessdata_dir() { command.args(["--tessdata-dir", directory.to_string_lossy().as_ref()]); }
    let result = command.args(["-l", &language, "-c", "tessedit_create_tsv=1"]).output()
        .map_err(|_| "OCR_ENGINE_UNAVAILABLE: Tesseract was not found.".to_owned());
    let _ = fs::remove_file(&image);
    let result = result?;
    if !result.status.success() { return Err("OCR_FAILED: Tesseract could not recognize this page. Ensure the language pack is installed.".into()); }
    parse_tsv(&String::from_utf8_lossy(&result.stdout), request.page_number, request.page_width, request.page_height)
}

fn tesseract_path() -> PathBuf {
    bundled_resource("bin/tesseract/tesseract.exe").unwrap_or_else(|| PathBuf::from(r"C:\Program Files\Tesseract-OCR\tesseract.exe"))
}

fn pdftoppm_path() -> PathBuf {
    bundled_resource("bin/poppler/pdftoppm.exe").unwrap_or_else(|| PathBuf::from("pdftoppm"))
}

fn libreoffice_path() -> PathBuf {
    bundled_resource("libreoffice/program/soffice.exe").unwrap_or_else(|| PathBuf::from("soffice"))
}

fn libreoffice_command() -> Command {
    let path = libreoffice_path();
    let mut command = background_command(&path);
    if let Some(directory) = path.parent() { command.current_dir(directory); }
    command
}

fn python_path() -> PathBuf {
    bundled_resource("python/python.exe").unwrap_or_else(|| PathBuf::from("python"))
}

fn libreoffice_profile_dir(nonce: u128) -> Result<PathBuf, String> {
    let system_drive = std::env::var_os("SystemDrive").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("C:"));
    let profile = system_drive.join("Temp").join(format!("honsen-libreoffice-{nonce}"));
    fs::create_dir_all(&profile).map_err(|_| "PDF_EXPORT_FAILED: could not create the LibreOffice temporary profile".to_owned())?;
    Ok(profile)
}

fn bundled_resource(relative: &str) -> Option<PathBuf> {
    let current = std::env::current_dir().ok();
    let executable = std::env::current_exe().ok().and_then(|path| path.parent().map(|parent| parent.to_path_buf()));
    [
        current.as_ref().map(|path| path.join("resources").join(relative)),
        current.as_ref().map(|path| path.join("src-tauri/resources").join(relative)),
        current.as_ref().and_then(|path| path.parent().map(|parent| parent.join("src-tauri/resources").join(relative))),
        executable.as_ref().map(|path| path.join("resources").join(relative)),
        executable.as_ref().map(|path| path.join("resources/resources").join(relative)),
    ].into_iter().flatten().find(|path| path.is_file())
}

fn convert_legacy_office_document(source: &std::path::Path, output_directory: &std::path::Path, extension: &str) -> Result<PathBuf, String> {
    let nonce = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|error| error.to_string())?.as_millis();
    let profile = libreoffice_profile_dir(nonce)?;
    let profile_arg = format!("-env:UserInstallation=file:///{}", profile.to_string_lossy().replace('\\', "/"));
    let source_text = source.to_str().ok_or("DOCUMENT_INVALID_INPUT: invalid source path")?;
    let directory_text = output_directory.to_str().ok_or("DOCUMENT_INVALID_INPUT: invalid temporary directory")?;
    let status = libreoffice_command().args(["--headless", &profile_arg, "--convert-to", extension, "--outdir", directory_text, source_text]).status();
    let _ = fs::remove_dir_all(profile);
    let output = output_directory.join(source.file_stem().ok_or("DOCUMENT_INVALID_INPUT: source has no file name")?).with_extension(extension);
    if status.is_ok_and(|result| result.success()) && output.is_file() { Ok(output) } else { Err("DOCUMENT_CONVERSION_FAILED: LibreOffice could not convert the legacy Office document.".into()) }
}

fn tessdata_dir() -> Option<PathBuf> {
    let current = std::env::current_dir().ok();
    let executable = std::env::current_exe().ok().and_then(|path| path.parent().map(|parent| parent.to_path_buf()));
    [
        current.as_ref().map(|path| path.join("resources/tessdata")),
        current.as_ref().and_then(|path| path.parent().map(|parent| parent.join("src-tauri/resources/tessdata"))),
        executable.as_ref().map(|path| path.join("resources/tessdata")),
        executable.as_ref().map(|path| path.join("resources/resources/tessdata")),
    ].into_iter().flatten().find(|path| path.is_dir())
}

fn tesseract_language(language: Option<&str>) -> Result<String, String> {
    let mapped = match language.unwrap_or("EN") { "AUTO" | "EN" | "eng" => "eng", "ZH" | "chi_sim" => "chi_sim", "ZT" | "chi_tra" => "chi_tra", "JA" | "jpn" => "jpn", "KO" | "kor" => "kor", "DE" | "deu" => "deu", "FR" | "fra" => "fra", "ES" | "spa" => "spa", "PT" | "por" => "por", "NL" | "nld" => "nld", "TR" | "tur" => "tur", "PL" | "pol" => "pol", "NO" | "nor" => "nor", "SV" | "swe" => "swe", "FI" | "fin" => "fin", "RU" | "rus" => "rus", "UK" | "ukr" => "ukr", "HU" | "hun" => "hun", "KK" | "kaz" => "kaz", "AR" | "ara" => "ara", "FA" | "fas" => "fas", _ => return Err("OCR_LANGUAGE_UNAVAILABLE: The selected OCR language is not supported.".into()) };
    Ok(mapped.into())
}

fn parse_tsv(tsv: &str, page_number: u32, page_width: f32, page_height: f32) -> Result<OcrPdfResponse, String> {
    let mut image_size = None;
    let mut words = Vec::new();
    for line in tsv.lines().skip(1) {
        let fields: Vec<_> = line.split('\t').collect();
        if fields.len() != 12 { continue; }
        if fields[0] == "1" { image_size = Some((fields[8].parse::<f32>().ok(), fields[9].parse::<f32>().ok())); }
        if fields[0] != "5" || fields[11].trim().is_empty() { continue; }
        let (left, top, width, height, confidence) = (fields[6].parse::<f32>().ok(), fields[7].parse::<f32>().ok(), fields[8].parse::<f32>().ok(), fields[9].parse::<f32>().ok(), fields[10].parse::<f32>().ok());
        if let (Some(left), Some(top), Some(width), Some(height), Some(confidence)) = (left, top, width, height, confidence) { words.push((fields[11].trim().to_owned(), left, top, width, height, confidence)); }
    }
    let Some((Some(image_width), Some(image_height))) = image_size else { return Err("OCR_FAILED: Tesseract returned no page geometry.".into()); };
    let text = words.into_iter().map(|(text, left, top, width, height, confidence)| OcrText { text, confidence, bbox: OcrBox { x: left * page_width / image_width, y: page_height - (top + height) * page_height / image_height, width: width * page_width / image_width, height: height * page_height / image_height } }).collect();
    Ok(OcrPdfResponse { page_number, text })
}

#[tauri::command]
async fn translate_deepl(request: DeepLRequest) -> Result<DeepLResponse, String> {
    if request.segments.is_empty() { return Ok(DeepLResponse { translations: vec![] }); }
    if request.segments.len() > 50 { return Err("DEEPL_INVALID_REQUEST: A request may contain at most 50 segments.".into()); }
    if request.segments.iter().any(|segment| segment.is_empty()) { return Err("DEEPL_INVALID_REQUEST: Empty text segments are not supported.".into()); }
    let key = deepl_key(request.api_key.as_deref())?;
    let endpoint = if key.ends_with(":fx") { DEEPL_FREE_ENDPOINT } else { DEEPL_PRO_ENDPOINT };
    let mut payload = serde_json::json!({ "text": request.segments, "target_lang": request.target_language });
    if let Some(source_language) = request.source_language.filter(|value| !value.trim().is_empty()) {
        payload["source_lang"] = serde_json::Value::String(source_language);
    }
    let client = reqwest::Client::builder().timeout(Duration::from_secs(30)).build()
        .map_err(|_| "DEEPL_UNAVAILABLE: Could not initialize secure network client.".to_owned())?;
    let mut last_error = "DEEPL_UNAVAILABLE: Translation service did not respond.".to_owned();
    for attempt in 0..3 {
        let result = client.post(endpoint).header("Authorization", format!("DeepL-Auth-Key {key}"))
            .json(&payload).send().await;
        match result {
            Ok(response) if response.status().is_success() => {
                let data = response.json::<DeepLApiResponse>().await.map_err(|_| "DEEPL_INVALID_RESPONSE: Translation service returned an unreadable response.".to_owned())?;
                if data.translations.len() != payload["text"].as_array().map_or(0, Vec::len) { return Err("DEEPL_INVALID_RESPONSE: Translation count did not match input.".into()); }
                return Ok(DeepLResponse { translations: data.translations.into_iter().map(|translation| translation.text).collect() });
            }
            Ok(response) if response.status().as_u16() == 403 => return Err("DEEPL_AUTH_FAILED: The DeepL API key was rejected.".into()),
            Ok(response) if response.status().as_u16() == 456 => return Err("DEEPL_QUOTA_EXCEEDED: The DeepL account has no remaining translation quota.".into()),
            Ok(response) if response.status().is_client_error() => return Err(format!("DEEPL_REQUEST_FAILED: DeepL returned HTTP {}.", response.status())),
            Ok(response) => last_error = format!("DEEPL_UNAVAILABLE: DeepL returned HTTP {}.", response.status()),
            Err(_) => last_error = "DEEPL_UNAVAILABLE: Could not contact DeepL. Check the network and try again.".into(),
        }
        if attempt < 2 { tokio::time::sleep(Duration::from_millis(300 * (attempt + 1))).await; }
    }
    Err(last_error)
}

#[tauri::command]
fn export_docx_to_pdf(docx_bytes: Vec<u8>, output_path: String) -> Result<(), String> {
    let nonce = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|error| error.to_string())?.as_millis();
    let temporary_docx = std::env::temp_dir().join(format!("pdf-translator-{nonce}.docx"));
    let temporary_pdf = temporary_docx.with_extension("pdf");
    fs::write(&temporary_docx, docx_bytes).map_err(|error| format!("DOCX_GENERATION_FAILED: {error}"))?;
    let temporary_dir = temporary_docx.parent().ok_or("PDF_EXPORT_FAILED: temporary directory missing")?;
    let profile = libreoffice_profile_dir(nonce)?;
    let profile_arg = format!("-env:UserInstallation=file:///{}", profile.to_string_lossy().replace('\\', "/"));
    let libreoffice_result = libreoffice_command()
        .args(["--headless", &profile_arg, "--convert-to", "pdf", "--outdir", temporary_dir.to_str().ok_or("PDF_EXPORT_FAILED: invalid temporary path")?, temporary_docx.to_str().ok_or("PDF_EXPORT_FAILED: invalid temporary path")?])
        .status();
    let converted = libreoffice_result.is_ok_and(|status| status.success() && temporary_pdf.exists());
    if !converted { export_with_word(&temporary_docx, &temporary_pdf)?; }
    fs::copy(&temporary_pdf, output_path).map_err(|error| format!("PDF_EXPORT_FAILED: {error}"))?;
    let _ = fs::remove_file(temporary_docx);
    let _ = fs::remove_file(temporary_pdf);
    let _ = fs::remove_dir_all(profile);
    Ok(())
}

#[tauri::command]
fn convert_source_pdf_to_docx(source_path: String, output_path: String) -> Result<(), String> {
    let source = PathBuf::from(&source_path);
    let output = PathBuf::from(&output_path);
    if !has_extension(&source, "pdf") || !source.is_file() { return Err("PDF2DOCX_INVALID_INPUT: Source must be an existing PDF file.".into()); }
    if !has_extension(&output, "docx") { return Err("PDF2DOCX_INVALID_OUTPUT: Output must use the .docx extension.".into()); }
    let result = background_command(python_path())
        .args(["-c", "from pdf2docx import Converter; import sys; converter = Converter(sys.argv[1]); converter.convert(sys.argv[2]); converter.close()", &source_path, &output_path])
        .output()
        .map_err(|_| "PDF2DOCX_UNAVAILABLE: Python or pdf2docx is unavailable.".to_owned())?;
    if !result.status.success() || !output.is_file() || fs::metadata(&output).map_or(true, |metadata| metadata.len() == 0) {
        return Err("PDF2DOCX_FAILED: pdf2docx conversion did not produce a DOCX file.".into());
    }
    Ok(())
}

#[tauri::command]
fn translate_pdf_via_docx(request: WordTranslationRequest) -> Result<(), String> {
    let source = PathBuf::from(&request.source_path);
    let output = PathBuf::from(&request.output_path);
    if !has_extension(&source, "pdf") || !source.is_file() { return Err("DOCX_ROUTE_INVALID_INPUT: Source must be an existing PDF file.".into()); }
    if request.format != "docx" && request.format != "pdf" { return Err("DOCX_ROUTE_INVALID_OUTPUT: Unsupported export format.".into()); }
    if !has_extension(&output, &request.format) { return Err("DOCX_ROUTE_INVALID_OUTPUT: Output extension does not match the selected format.".into()); }
    let temporary_docx = std::env::temp_dir().join(format!("honsen-word-{}.docx", SystemTime::now().duration_since(UNIX_EPOCH).map_err(|error| error.to_string())?.as_millis()));
    let docx_output = if request.format == "docx" { output.clone() } else { temporary_docx.clone() };
    let key = deepl_key(request.api_key.as_deref())?;
    let result = background_command(python_path())
        .env("DEEPL_API_KEY", key)
        .args(["-c", DOCX_TRANSLATION_SCRIPT, &request.source_path, docx_output.to_string_lossy().as_ref(), &request.target_language, request.source_language.as_deref().unwrap_or("")])
        .output()
        .map_err(|_| "DOCX_ROUTE_UNAVAILABLE: Python, pdf2docx, or python-docx is unavailable.".to_owned())?;
    if !result.status.success() || !docx_output.is_file() || fs::metadata(&docx_output).map_or(true, |metadata| metadata.len() == 0) {
        return Err("DOCX_ROUTE_FAILED: Word reconstruction or translation did not produce a DOCX file.".into());
    }
    if request.format == "pdf" {
        let converted = export_docx_to_pdf(fs::read(&temporary_docx).map_err(|error| format!("DOCX_ROUTE_FAILED: {error}"))?, request.output_path);
        let _ = fs::remove_file(&temporary_docx);
        converted?;
    }
    Ok(())
}

#[tauri::command]
async fn translate_document_file(app: tauri::AppHandle, request: DocumentTranslationRequest) -> Result<String, String> {
    tokio::task::spawn_blocking(move || translate_document_file_sync(&app, request))
        .await
        .map_err(|error| format!("DOCUMENT_TRANSLATION_FAILED: Translation task stopped unexpectedly: {error}"))?
}

fn translate_document_file_sync(app: &tauri::AppHandle, request: DocumentTranslationRequest) -> Result<String, String> {
    let source = PathBuf::from(&request.source_path);
    if !source.is_file() { return Err("DOCUMENT_INVALID_INPUT: Source document does not exist.".into()); }
    let (legacy_extension, output_extension, worker_type) = match request.source_type.as_str() {
        "word" => ("doc", "docx", "word"),
        "presentation" => ("ppt", "pptx", "presentation"),
        "spreadsheet" => ("xls", "xlsx", "spreadsheet"),
        "text" => ("", "txt", if has_extension(&source, "md") || has_extension(&source, "markdown") { "markdown" } else { "text" }),
        _ => return Err("DOCUMENT_UNSUPPORTED_TYPE: Unsupported source document type.".into()),
    };
    let valid_input = if legacy_extension.is_empty() {
        ["txt", "md", "markdown"].iter().any(|extension| has_extension(&source, extension))
    } else {
        [legacy_extension, output_extension].iter().any(|extension| has_extension(&source, extension))
    };
    if !valid_input { return Err("DOCUMENT_INVALID_INPUT: The selected file does not match its document type page.".into()); }
    let nonce = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|error| error.to_string())?.as_millis();
    let output_extension = if worker_type == "markdown" { "md" } else { output_extension };
    let output = if request.output_path.is_empty() {
        let directory = std::env::temp_dir().join(format!("honsen-translated-{nonce}"));
        fs::create_dir_all(&directory).map_err(|error| format!("DOCUMENT_TEMPORARY_DIRECTORY_FAILED: {error}"))?;
        directory.join(source.file_stem().ok_or("DOCUMENT_INVALID_INPUT: source has no file name")?).with_extension(output_extension)
    } else { PathBuf::from(&request.output_path) };
    if !has_extension(&output, output_extension) && !(worker_type == "markdown" && has_extension(&output, "md")) {
        return Err("DOCUMENT_INVALID_OUTPUT: The output file extension does not match the selected document type.".into());
    }
    let temporary_directory = std::env::temp_dir().join(format!("honsen-document-{nonce}"));
    fs::create_dir_all(&temporary_directory).map_err(|error| format!("DOCUMENT_TEMPORARY_DIRECTORY_FAILED: {error}"))?;
    let prepared_source = if !legacy_extension.is_empty() && has_extension(&source, legacy_extension) {
        convert_legacy_office_document(&source, &temporary_directory, output_extension)?
    } else { source.clone() };
    let script = bundled_resource("scripts/translate_document.py").ok_or("DOCUMENT_TRANSLATOR_UNAVAILABLE: Translation worker was not found.")?;
    let glossary = serde_json::to_string(&request.glossary).map_err(|_| "DOCUMENT_INVALID_REQUEST: Invalid glossary.".to_owned())?;
    let key = deepl_key(request.api_key.as_deref())?;
    let mut child = background_command(python_path()).env("DEEPL_API_KEY", key)
        .args([script.to_string_lossy().as_ref(), prepared_source.to_string_lossy().as_ref(), output.to_string_lossy().as_ref(), worker_type, request.target_language.as_str(), request.source_language.as_deref().unwrap_or(""), glossary.as_str()])
        .stdout(Stdio::piped()).stderr(Stdio::null()).spawn()
        .map_err(|_| "DOCUMENT_TRANSLATOR_UNAVAILABLE: Python is unavailable.".to_owned())?;
    if let Some(stdout) = child.stdout.take() {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Ok(progress) = serde_json::from_str::<DocumentTranslationProgress>(&line) {
                let _ = app.emit("document-translation-progress", progress);
            }
        }
    }
    let result = child.wait();
    let _ = fs::remove_dir_all(&temporary_directory);
    let result = result.map_err(|_| "DOCUMENT_TRANSLATION_FAILED: Translation worker stopped unexpectedly.".to_owned())?;
    if !result.success() || !output.is_file() || fs::metadata(&output).map_or(true, |metadata| metadata.len() == 0) {
        return Err("DOCUMENT_TRANSLATION_FAILED: Document translation did not produce an output file.".into());
    }
    Ok(output.to_string_lossy().into_owned())
}

#[tauri::command]
async fn render_document_preview(request: DocumentPreviewRequest) -> Result<String, String> {
    tokio::task::spawn_blocking(move || render_document_preview_sync(request))
        .await
        .map_err(|error| format!("DOCUMENT_PREVIEW_FAILED: Preview task stopped unexpectedly: {error}"))?
}

fn render_document_preview_sync(request: DocumentPreviewRequest) -> Result<String, String> {
    let source = PathBuf::from(&request.source_path);
    if !source.is_file() { return Err("DOCUMENT_INVALID_INPUT: Source document does not exist.".into()); }
    if !["doc", "docx", "ppt", "pptx", "xls", "xlsx"].iter().any(|extension| has_extension(&source, extension)) {
        return Err("DOCUMENT_PREVIEW_UNSUPPORTED: This document type has no PDF preview.".into());
    }
    let nonce = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|error| error.to_string())?.as_millis();
    let directory = std::env::temp_dir().join(format!("honsen-preview-{nonce}"));
    fs::create_dir_all(&directory).map_err(|error| format!("DOCUMENT_PREVIEW_FAILED: {error}"))?;
    let extension = source.extension().and_then(|value| value.to_str()).ok_or("DOCUMENT_PREVIEW_FAILED: source has no extension")?;
    let staged_source = directory.join(format!("source.{extension}"));
    let preview = directory.join("preview.pdf");
    fs::copy(&source, &staged_source).map_err(|error| format!("DOCUMENT_PREVIEW_FAILED: {error}"))?;
    match export_office_to_pdf(&staged_source, &preview) {
        Ok(()) => Ok(preview.to_string_lossy().into_owned()),
        Err(error) => { let _ = fs::remove_dir_all(directory); Err(error) }
    }
}

#[tauri::command]
async fn export_document_to_pdf(source_path: String, output_path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let source = PathBuf::from(source_path);
        let output = PathBuf::from(output_path);
        if !source.is_file() { return Err("DOCUMENT_INVALID_INPUT: Source document does not exist.".into()); }
        if !has_extension(&output, "pdf") { return Err("DOCUMENT_INVALID_OUTPUT: Output must be a PDF file.".into()); }
        if !["doc", "docx", "ppt", "pptx", "xls", "xlsx", "txt", "md", "markdown"].iter().any(|extension| has_extension(&source, extension)) {
            return Err("DOCUMENT_UNSUPPORTED_TYPE: This document type cannot be exported as PDF.".into());
        }
        if let Some(parent) = output.parent() { fs::create_dir_all(parent).map_err(|error| format!("PDF_EXPORT_FAILED: {error}"))?; }
        export_office_to_pdf(&source, &output).map_err(|error| format!("PDF_EXPORT_FAILED: {error}"))
    }).await.map_err(|error| format!("PDF_EXPORT_FAILED: Export task stopped unexpectedly: {error}"))?
}

#[tauri::command]
async fn export_document_file(source_path: String, output_path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let source = PathBuf::from(source_path);
        let output = PathBuf::from(output_path);
        if !source.is_file() { return Err("DOCUMENT_INVALID_INPUT: Translated document is unavailable.".into()); }
        if source == output { return Ok(()); }
        if let Some(parent) = output.parent() { fs::create_dir_all(parent).map_err(|error| format!("DOCUMENT_EXPORT_FAILED: {error}"))?; }
        let expected_size = fs::metadata(&source).map_err(|error| format!("DOCUMENT_EXPORT_FAILED: {error}"))?.len();
        fs::copy(&source, &output).map_err(|error| format!("DOCUMENT_EXPORT_FAILED: {error}"))?;
        if fs::metadata(&output).map_or(true, |metadata| metadata.len() != expected_size || metadata.len() == 0) {
            return Err("DOCUMENT_EXPORT_FAILED: The exported file could not be verified.".into());
        }
        Ok(())
    }).await.map_err(|error| format!("DOCUMENT_EXPORT_FAILED: Export task stopped unexpectedly: {error}"))?
}

#[tauri::command]
fn save_translated_text_file(source_path: String, content: String) -> Result<String, String> {
    let source = PathBuf::from(source_path);
    if !source.is_file() { return Err("DOCUMENT_INVALID_INPUT: Source document does not exist.".into()); }
    let extension = source.extension().and_then(|value| value.to_str()).filter(|value| !value.is_empty()).ok_or("DOCUMENT_INVALID_INPUT: Source file has no extension.")?;
    let nonce = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|error| error.to_string())?.as_millis();
    let directory = std::env::temp_dir().join(format!("honsen-translated-{nonce}"));
    fs::create_dir_all(&directory).map_err(|error| format!("DOCUMENT_TEMPORARY_DIRECTORY_FAILED: {error}"))?;
    let output = directory.join(source.file_stem().ok_or("DOCUMENT_INVALID_INPUT: Source file has no name.")?).with_extension(extension);
    fs::write(&output, content).map_err(|error| format!("DOCUMENT_EXPORT_FAILED: {error}"))?;
    Ok(output.to_string_lossy().into_owned())
}

#[tauri::command]
fn validate_code_file(source_path: String) -> Result<(), String> {
    let source = PathBuf::from(source_path);
    if !source.is_file() { return Err("CODE_VALIDATION_FAILED: Source code file does not exist.".into()); }
    if !has_extension(&source, "py") { return Ok(()); }
    let script = "import ast, os, pathlib; ast.parse(pathlib.Path(os.environ['HONSEN_CODE_PATH']).read_text(encoding='utf-8-sig'))";
    let result = background_command(python_path()).env("HONSEN_CODE_PATH", &source).args(["-c", script]).output()
        .map_err(|_| "CODE_VALIDATION_FAILED: Python validation runtime is unavailable.".to_owned())?;
    if result.status.success() { return Ok(()); }
    let detail = String::from_utf8_lossy(&result.stderr).trim().chars().take(300).collect::<String>();
    Err(format!("CODE_VALIDATION_FAILED: Python 语法或缩进错误。{}", if detail.is_empty() { String::new() } else { format!(" {detail}") }))
}

#[tauri::command]
fn release_document_preview(preview_path: String) -> Result<(), String> {
    let preview = PathBuf::from(preview_path);
    let Some(directory) = preview.parent() else { return Err("DOCUMENT_PREVIEW_INVALID: Invalid preview path.".into()); };
    if !has_extension(&preview, "pdf") || !directory.file_name().is_some_and(|name| name.to_string_lossy().starts_with("honsen-preview-")) {
        return Err("DOCUMENT_PREVIEW_INVALID: Invalid preview path.".into());
    }
    let _ = fs::remove_dir_all(directory);
    Ok(())
}

fn has_extension(path: &std::path::Path, expected: &str) -> bool {
    path.extension().is_some_and(|extension| extension.eq_ignore_ascii_case(expected))
}

fn export_with_word(docx_path: &std::path::Path, pdf_path: &std::path::Path) -> Result<(), String> {
    let escape = |path: &std::path::Path| path.to_string_lossy().replace('\'', "''");
    let command = format!("$word = New-Object -ComObject Word.Application; $word.Visible = $false; try {{ $doc = $word.Documents.Open('{}', $false, $true); $doc.ExportAsFixedFormat('{}', 17); $doc.Close() }} finally {{ $word.Quit() }}", escape(docx_path), escape(pdf_path));
    let status = background_command("powershell.exe").args(["-NoProfile", "-Command", &command]).status().map_err(|error| format!("LIBREOFFICE_NOT_FOUND: {error}"))?;
    if status.success() && pdf_path.exists() { Ok(()) } else { Err("PDF_EXPORT_FAILED: LibreOffice and Word conversion both failed".into()) }
}

fn export_office_to_pdf(source: &std::path::Path, pdf_path: &std::path::Path) -> Result<(), String> {
    let escape = |path: &std::path::Path| path.to_string_lossy().replace('\'', "''");
    let source_extension = source.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
    let source = escape(source);
    let output = escape(pdf_path);
    let extension = pdf_path.extension().and_then(|value| value.to_str());
    if extension != Some("pdf") { return Err("DOCUMENT_PREVIEW_FAILED: preview output must be PDF".into()); }
    let command = match source_extension.as_str() {
        "doc" | "docx" | "txt" | "md" | "markdown" => format!("$app=New-Object -ComObject Word.Application; $app.Visible=$false; $temporary=$null; $document=$null; try {{$document=$app.Documents.Open('{source}',$false,$true); $fit=$false; for($i=1;$i -le $document.Tables.Count;$i++){{$table=$document.Tables.Item($i); if(-not $table.AllowAutoFit -and $table.PreferredWidthType -eq 1 -and $table.PreferredWidth -ge 999999){{$fit=$true}}}} if($fit){{$temporary=Join-Path $env:TEMP ('honsen-pdf-'+[guid]::NewGuid().ToString()+'.{source_extension}'); $document.Close($false); Copy-Item -LiteralPath '{source}' -Destination $temporary; $document=$app.Documents.Open($temporary,$false,$false); for($i=1;$i -le $document.Tables.Count;$i++){{$table=$document.Tables.Item($i); if(-not $table.AllowAutoFit -and $table.PreferredWidthType -eq 1 -and $table.PreferredWidth -ge 999999){{$table.Rows.LeftIndent=20}}}} $document.Save()}} $document.ExportAsFixedFormat('{output}',17)}} finally {{if($document){{$document.Close($false)}} if($temporary){{Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue}} $app.Quit()}}"),
        "ppt" | "pptx" => format!("$app=New-Object -ComObject PowerPoint.Application; try {{$presentation=$app.Presentations.Open('{source}',$true,$false,$false); $presentation.SaveAs('{output}',32); $presentation.Close()}} finally {{$app.Quit()}}"),
        "xls" | "xlsx" => format!("$app=New-Object -ComObject Excel.Application; $app.Visible=$false; try {{$book=$app.Workbooks.Open('{source}',$false,$true); $book.ExportAsFixedFormat(0,'{output}'); $book.Close($false)}} finally {{$app.Quit()}}"),
        _ => return Err("DOCUMENT_PREVIEW_UNSUPPORTED: This document type has no PDF preview.".into()),
    };
    let result = background_command("powershell.exe").args(["-NoProfile", "-Command", &command]).output()
        .map_err(|error| format!("DOCUMENT_PREVIEW_OFFICE_FAILED: {error}"))?;
    if result.status.success() && pdf_path.is_file() { Ok(()) }
    else {
        let detail = String::from_utf8_lossy(&result.stderr).trim().chars().take(300).collect::<String>();
        Err(format!("DOCUMENT_PREVIEW_OFFICE_FAILED: {}", if detail.is_empty() { "The installed Office application could not create a PDF preview." } else { &detail }))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![export_docx_to_pdf, convert_source_pdf_to_docx, translate_pdf_via_docx, translate_document_file, render_document_preview, export_document_to_pdf, export_document_file, save_translated_text_file, validate_code_file, release_document_preview, translate_deepl, save_deepl_api_key, deepl_key_status, ocr_pdf_page, check_for_update, install_update, record_diagnostic])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn accepts_an_empty_translation_batch_without_network_or_key() {
        let result = translate_deepl(DeepLRequest { segments: vec![], target_language: "FR".into(), source_language: None, api_key: None }).await.unwrap();
        assert!(result.translations.is_empty());
    }

    #[tokio::test]
    async fn rejects_batches_above_deepl_limit_before_network_access() {
        let result = translate_deepl(DeepLRequest { segments: vec!["text".into(); 51], target_language: "FR".into(), source_language: None, api_key: None }).await;
        assert!(result.unwrap_err().starts_with("DEEPL_INVALID_REQUEST"));
    }

    #[tokio::test]
    #[ignore = "requires a configured local DeepL key and network access"]
    async fn translates_a_minimal_real_deepl_request() {
        let result = translate_deepl(DeepLRequest { segments: vec!["Hello".into()], target_language: "ZH".into(), source_language: Some("EN".into()), api_key: None }).await.expect("DeepL request should succeed");
        assert_eq!(result.translations.len(), 1);
        assert!(!result.translations[0].trim().is_empty());
    }

    #[test]
    fn maps_tesseract_word_coordinates_to_pdf_points() {
        let tsv = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n1\t1\t0\t0\t0\t0\t0\t0\t1200\t1800\t-1\t\n5\t1\t1\t1\t1\t1\t120\t180\t240\t60\t96.5\tHello";
        let result = parse_tsv(tsv, 1, 600.0, 900.0).unwrap();
        assert_eq!(result.text.len(), 1);
        assert_eq!(result.text[0].text, "Hello");
        assert_eq!(result.text[0].bbox.x, 60.0);
        assert_eq!(result.text[0].bbox.y, 780.0);
    }

    #[test]
    fn accepts_only_pdf_to_docx_paths_for_source_conversion() {
        assert!(has_extension(std::path::Path::new("input.PDF"), "pdf"));
        assert!(has_extension(std::path::Path::new("output.docx"), "docx"));
        assert!(!has_extension(std::path::Path::new("output.pdf"), "docx"));
    }

    #[test]
    fn catches_python_indentation_errors() {
        let path = std::env::temp_dir().join(format!("honsen-code-validation-{}.py", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        fs::write(&path, "if True:\nprint('missing indent')\n").unwrap();
        assert!(validate_code_file(path.to_string_lossy().into_owned()).is_err());
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn accepts_only_redacted_diagnostic_fields() {
        assert!(valid_diagnostic_event(&DiagnosticEvent { stage: "translation".into(), code: "DEEPL_AUTH_FAILED".into(), page_number: Some(3) }));
        assert!(!valid_diagnostic_event(&DiagnosticEvent { stage: "translation".into(), code: "C:\\secret.pdf".into(), page_number: None }));
        assert!(!valid_diagnostic_event(&DiagnosticEvent { stage: "unknown".into(), code: "OCR_FAILED".into(), page_number: None }));
    }

    #[test]
    fn writes_only_structured_diagnostic_fields() {
        let directory = std::env::temp_dir().join(format!("honsen-diagnostic-test-{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        let event = DiagnosticEvent { stage: "ocr".into(), code: "OCR_FAILED".into(), page_number: Some(2) };
        append_diagnostic(&directory, &event, 123).unwrap();
        let line = fs::read_to_string(directory.join("diagnostics.jsonl")).unwrap();
        assert_eq!(line.trim(), r#"{"code":"OCR_FAILED","pageNumber":2,"stage":"ocr","timestamp":123}"#);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn compares_release_versions_without_accepting_invalid_tags() {
        assert!(is_newer_version("v0.1.1", "0.1.0"));
        assert!(!is_newer_version("0.1.0", "0.1.0"));
        assert!(!is_newer_version("latest", "0.1.0"));
    }

    #[test]
    fn exposes_verified_release_notes_without_auto_installing() {
        let status = update_status(Some(AvailableUpdate { version: "0.1.1".into(), release_notes: "修复表格定位".into(), installer_url: "https://example.invalid/setup.exe".into(), sha256: "0".repeat(64) }));
        assert!(status.available);
        assert_eq!(status.version.as_deref(), Some("0.1.1"));
        assert_eq!(status.release_notes.as_deref(), Some("修复表格定位"));
    }

    #[test]
    fn prefers_bundled_ocr_executables() {
        assert!(tesseract_path().is_file());
        assert!(pdftoppm_path().is_file());
    }

    #[test]
    fn locates_a_libreoffice_executable() {
        assert!(libreoffice_path().is_file());
    }

    #[test]
    fn runs_the_local_ocr_engine_for_an_image_pdf() {
        let source = std::env::current_dir().unwrap().join("../tests/fixtures/04-image.pdf").canonicalize().unwrap();
        let result = ocr_pdf_page(OcrPdfRequest { source_path: source.to_string_lossy().into_owned(), page_number: 1, page_width: 612.0, page_height: 792.0, language: Some("EN".into()) }).unwrap();
        assert_eq!(result.page_number, 1);
    }

    #[test]
    #[ignore = "requires Microsoft Word or LibreOffice"]
    fn exports_a_fixture_docx_to_pdf() {
        let source = std::env::current_dir().unwrap().join("../output/docx/01-simple-paragraph.docx");
        let output = std::env::temp_dir().join("honsen-export-check.pdf");
        let _ = fs::remove_file(&output);
        export_docx_to_pdf(fs::read(source).unwrap(), output.to_string_lossy().into_owned()).unwrap();
        assert!(output.is_file());
        assert!(fs::metadata(&output).unwrap().len() > 0);
        let _ = fs::remove_file(output);
    }
}
