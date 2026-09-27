use std::{fs, path::PathBuf, process::Command, time::{Duration, SystemTime, UNIX_EPOCH}};
use serde::{Deserialize, Serialize};

const DEEPL_FREE_ENDPOINT: &str = "https://api-free.deepl.com/v2/translate";
const DEEPL_PRO_ENDPOINT: &str = "https://api.deepl.com/v2/translate";
const KEYRING_SERVICE: &str = "Honsen PDF Translator";
const KEYRING_ACCOUNT: &str = "deepl-api-key";

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

#[derive(Serialize)]
struct OcrText {
    text: String,
    bbox: OcrBox,
    confidence: f32,
}

#[derive(Serialize)]
struct OcrBox { x: f32, y: f32, width: f32, height: f32 }

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
    let render = Command::new(pdftoppm_path()).args(["-f", &request.page_number.to_string(), "-l", &request.page_number.to_string(), "-r", "300", "-png", "-singlefile", source.to_string_lossy().as_ref(), prefix.to_string_lossy().as_ref()]).output()
        .map_err(|_| "OCR_ENGINE_UNAVAILABLE: Poppler pdftoppm was not found.".to_owned())?;
    if !render.status.success() || !image.is_file() { return Err("OCR_RENDER_FAILED: Could not render the PDF page for OCR.".into()); }
    let language = tesseract_language(request.language.as_deref())?;
    let mut command = Command::new(tesseract_path());
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

fn bundled_resource(relative: &str) -> Option<PathBuf> {
    let current = std::env::current_dir().ok();
    let executable = std::env::current_exe().ok().and_then(|path| path.parent().map(|parent| parent.to_path_buf()));
    [
        current.as_ref().map(|path| path.join("resources").join(relative)),
        current.as_ref().and_then(|path| path.parent().map(|parent| parent.join("src-tauri/resources").join(relative))),
        executable.as_ref().map(|path| path.join("resources").join(relative)),
        executable.as_ref().map(|path| path.join("resources/resources").join(relative)),
    ].into_iter().flatten().find(|path| path.is_file())
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
    let profile = temporary_dir.join(format!("honsen-libreoffice-{nonce}"));
    let profile_arg = format!("-env:UserInstallation=file:///{}", profile.to_string_lossy().replace('\\', "/"));
    let libreoffice_result = Command::new(libreoffice_path())
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

fn export_with_word(docx_path: &std::path::Path, pdf_path: &std::path::Path) -> Result<(), String> {
    let escape = |path: &std::path::Path| path.to_string_lossy().replace('\'', "''");
    let command = format!("$word = New-Object -ComObject Word.Application; $word.Visible = $false; try {{ $doc = $word.Documents.Open('{}', $false, $true); $doc.ExportAsFixedFormat('{}', 17); $doc.Close() }} finally {{ $word.Quit() }}", escape(docx_path), escape(pdf_path));
    let status = Command::new("powershell.exe").args(["-NoProfile", "-Command", &command]).status().map_err(|error| format!("LIBREOFFICE_NOT_FOUND: {error}"))?;
    if status.success() && pdf_path.exists() { Ok(()) } else { Err("PDF_EXPORT_FAILED: LibreOffice and Word conversion both failed".into()) }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![export_docx_to_pdf, translate_deepl, save_deepl_api_key, deepl_key_status, ocr_pdf_page])
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
    fn prefers_bundled_ocr_executables() {
        assert!(tesseract_path().is_file());
        assert!(pdftoppm_path().is_file());
    }

    #[test]
    fn locates_a_libreoffice_executable() {
        assert!(libreoffice_path().is_file());
    }

    #[test]
    #[ignore = "requires local Poppler and Tesseract installation"]
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
