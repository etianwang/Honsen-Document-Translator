fn main() {
    if cfg!(target_os = "windows") {
        let mut resource = winres::WindowsResource::new();
        resource.set_icon("../logo.ico");
        resource.compile().expect("embed Windows application icon");
    }
    tauri_build::build()
}
