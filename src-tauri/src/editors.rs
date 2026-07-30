use crate::models::{DetectedEditor, EditorLaunch, ExternalEditorKind};
use std::{env, fs, path::{Path, PathBuf}, process::Command};
use walkdir::WalkDir;

fn editor(
    id: &str,
    name: &str,
    kind: ExternalEditorKind,
    launch: EditorLaunch,
    installed: bool,
) -> DetectedEditor {
    DetectedEditor {
        id: id.to_string(),
        name: name.to_string(),
        kind,
        installed,
        system_default: None,
        launch,
    }
}

fn system_default(kind: ExternalEditorKind, name: &str) -> DetectedEditor {
    DetectedEditor {
        id: match kind {
            ExternalEditorKind::VideoEditor => "system-video",
            ExternalEditorKind::AudioEditor => "system-audio",
            ExternalEditorKind::ImageEditor => "system-image",
            ExternalEditorKind::SystemDefault => "system-default",
        }.to_string(),
        name: name.to_string(),
        kind,
        installed: true,
        system_default: Some(true),
        launch: EditorLaunch::SystemDefault,
    }
}

fn existing_first(paths: impl IntoIterator<Item = PathBuf>) -> Option<PathBuf> {
    paths.into_iter().find(|p| p.exists())
}

fn find_file_limited(root: &Path, names: &[&str], max_depth: usize) -> Option<PathBuf> {
    if !root.exists() { return None; }
    let targets: Vec<String> = names.iter().map(|n| n.to_ascii_lowercase()).collect();
    WalkDir::new(root)
        .max_depth(max_depth)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .find_map(|entry| {
            if !entry.file_type().is_file() { return None; }
            let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
            targets.iter().any(|target| target == &name).then(|| entry.path().to_path_buf())
        })
}

#[cfg(target_os = "windows")]
fn detect_platform_editors() -> Vec<DetectedEditor> {
    let program_files = env::var_os("ProgramFiles").map(PathBuf::from);
    let program_files_x86 = env::var_os("ProgramFiles(x86)").map(PathBuf::from);
    let local_app = env::var_os("LOCALAPPDATA").map(PathBuf::from);

    let search_roots: Vec<PathBuf> = [program_files.clone(), program_files_x86.clone(), local_app.clone()]
        .into_iter().flatten().collect();
    let find = |names: &[&str]| search_roots.iter().find_map(|root| find_file_limited(root, names, 5));

    let premiere = find(&["Adobe Premiere Pro.exe"]);
    let resolve = existing_first([
        program_files.clone().map(|p| p.join("Blackmagic Design/DaVinci Resolve/Resolve.exe")),
        program_files_x86.clone().map(|p| p.join("Blackmagic Design/DaVinci Resolve/Resolve.exe")),
    ].into_iter().flatten()).or_else(|| find(&["Resolve.exe"]));
    let capcut = existing_first([
        local_app.clone().map(|p| p.join("CapCut/Apps/CapCut.exe")),
        local_app.clone().map(|p| p.join("CapCut/CapCut.exe")),
    ].into_iter().flatten()).or_else(|| find(&["CapCut.exe"]));
    let audition = find(&["Adobe Audition.exe"]);
    let photoshop = find(&["Photoshop.exe", "Adobe Photoshop.exe"]);

    vec![
        editor("premiere-pro", "Adobe Premiere Pro", ExternalEditorKind::VideoEditor, premiere.clone().map(EditorLaunch::Executable).unwrap_or(EditorLaunch::Command("Adobe Premiere Pro.exe".into())), premiere.is_some()),
        editor("davinci-resolve", "DaVinci Resolve", ExternalEditorKind::VideoEditor, resolve.clone().map(EditorLaunch::Executable).unwrap_or(EditorLaunch::Command("Resolve.exe".into())), resolve.is_some()),
        editor("capcut-desktop", "CapCut", ExternalEditorKind::VideoEditor, capcut.clone().map(EditorLaunch::Executable).unwrap_or(EditorLaunch::Command("CapCut.exe".into())), capcut.is_some()),
        editor("adobe-audition", "Adobe Audition", ExternalEditorKind::AudioEditor, audition.clone().map(EditorLaunch::Executable).unwrap_or(EditorLaunch::Command("Adobe Audition.exe".into())), audition.is_some()),
        editor("adobe-photoshop", "Adobe Photoshop", ExternalEditorKind::ImageEditor, photoshop.clone().map(EditorLaunch::Executable).unwrap_or(EditorLaunch::Command("Photoshop.exe".into())), photoshop.is_some()),
    ]
}

#[cfg(target_os = "macos")]
fn scan_macos_apps(prefixes: &[&str]) -> Option<PathBuf> {
    let mut roots = vec![PathBuf::from("/Applications")];
    if let Some(home) = env::var_os("HOME") { roots.push(PathBuf::from(home).join("Applications")); }
    for root in roots {
        let Ok(entries) = fs::read_dir(root) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
            if path.extension().and_then(|e| e.to_str()) == Some("app")
                && prefixes.iter().any(|p| name.starts_with(&p.to_ascii_lowercase())) {
                return Some(path);
            }
        }
    }
    None
}

#[cfg(target_os = "macos")]
fn detect_platform_editors() -> Vec<DetectedEditor> {
    let premiere = scan_macos_apps(&["adobe premiere pro"]);
    let resolve = existing_first([PathBuf::from("/Applications/DaVinci Resolve/DaVinci Resolve.app"), PathBuf::from("/Applications/DaVinci Resolve.app")]);
    let final_cut = existing_first([PathBuf::from("/Applications/Final Cut Pro.app")]);
    let capcut = scan_macos_apps(&["capcut"]);
    let audition = scan_macos_apps(&["adobe audition"]);
    let photoshop = scan_macos_apps(&["adobe photoshop"]);

    vec![
        editor("premiere-pro", "Adobe Premiere Pro", ExternalEditorKind::VideoEditor, premiere.clone().map(EditorLaunch::MacApplication).unwrap_or(EditorLaunch::Command("Adobe Premiere Pro".into())), premiere.is_some()),
        editor("davinci-resolve", "DaVinci Resolve", ExternalEditorKind::VideoEditor, resolve.clone().map(EditorLaunch::MacApplication).unwrap_or(EditorLaunch::Command("DaVinci Resolve".into())), resolve.is_some()),
        editor("final-cut-pro", "Final Cut Pro", ExternalEditorKind::VideoEditor, final_cut.clone().map(EditorLaunch::MacApplication).unwrap_or(EditorLaunch::Command("Final Cut Pro".into())), final_cut.is_some()),
        editor("capcut-desktop", "CapCut", ExternalEditorKind::VideoEditor, capcut.clone().map(EditorLaunch::MacApplication).unwrap_or(EditorLaunch::Command("CapCut".into())), capcut.is_some()),
        editor("adobe-audition", "Adobe Audition", ExternalEditorKind::AudioEditor, audition.clone().map(EditorLaunch::MacApplication).unwrap_or(EditorLaunch::Command("Adobe Audition".into())), audition.is_some()),
        editor("adobe-photoshop", "Adobe Photoshop", ExternalEditorKind::ImageEditor, photoshop.clone().map(EditorLaunch::MacApplication).unwrap_or(EditorLaunch::Command("Adobe Photoshop".into())), photoshop.is_some()),
    ]
}

#[cfg(target_os = "linux")]
fn detect_platform_editors() -> Vec<DetectedEditor> {
    let find_command = |name: &str| {
        env::var_os("PATH").and_then(|paths| env::split_paths(&paths).map(|p| p.join(name)).find(|p| p.exists()))
    };
    let specs = [
        ("davinci-resolve", "DaVinci Resolve", ExternalEditorKind::VideoEditor, "resolve"),
        ("kdenlive", "Kdenlive", ExternalEditorKind::VideoEditor, "kdenlive"),
        ("shotcut", "Shotcut", ExternalEditorKind::VideoEditor, "shotcut"),
        ("audacity", "Audacity", ExternalEditorKind::AudioEditor, "audacity"),
        ("gimp", "GIMP", ExternalEditorKind::ImageEditor, "gimp"),
    ];
    specs.into_iter().map(|(id, name, kind, cmd)| {
        let found = find_command(cmd);
        editor(id, name, kind, found.clone().map(EditorLaunch::Executable).unwrap_or(EditorLaunch::Command(cmd.into())), found.is_some())
    }).collect()
}

pub fn detect_editors() -> Vec<DetectedEditor> {
    let mut editors = vec![
        system_default(ExternalEditorKind::VideoEditor, "系統預設影片程式"),
        system_default(ExternalEditorKind::AudioEditor, "系統預設音訊程式"),
        system_default(ExternalEditorKind::ImageEditor, "系統預設圖片程式"),
        system_default(ExternalEditorKind::SystemDefault, "系統預設程式"),
    ];
    editors.extend(detect_platform_editors());
    editors
}

pub fn select_editor(editor_id: Option<&str>, kind: &ExternalEditorKind) -> Option<DetectedEditor> {
    let editors = detect_editors();
    if let Some(id) = editor_id {
        return editors.into_iter().find(|e| e.id == id && e.installed);
    }
    editors.into_iter().find(|e| &e.kind == kind && e.installed)
}

pub fn launch_editor(editor: &DetectedEditor, file: &Path) -> Result<(), String> {
    if !editor.installed { return Err(format!("找不到已安裝的 {}", editor.name)); }
    let mut command = match &editor.launch {
        EditorLaunch::SystemDefault => {
            #[cfg(target_os = "windows")]
            {
                let mut cmd = Command::new("cmd");
                cmd.args(["/C", "start", "", &file.to_string_lossy()]);
                cmd
            }
            #[cfg(target_os = "macos")]
            {
                let mut cmd = Command::new("/usr/bin/open");
                cmd.arg(file);
                cmd
            }
            #[cfg(target_os = "linux")]
            {
                let mut cmd = Command::new("xdg-open");
                cmd.arg(file);
                cmd
            }
        }
        EditorLaunch::Executable(path) => {
            let mut cmd = Command::new(path);
            cmd.arg(file);
            cmd
        }
        EditorLaunch::MacApplication(path) => {
            let mut cmd = Command::new("/usr/bin/open");
            cmd.arg("-a").arg(path).arg(file);
            cmd
        }
        EditorLaunch::Command(name) => {
            let mut cmd = Command::new(name);
            cmd.arg(file);
            cmd
        }
    };
    command.spawn().map(|_| ()).map_err(|err| format!("啟動 {} 失敗：{err}", editor.name))
}

pub fn reveal_in_folder(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let result = Command::new("explorer").arg(format!("/select,{}", path.display())).spawn();
    #[cfg(target_os = "macos")]
    let result = Command::new("/usr/bin/open").arg("-R").arg(path).spawn();
    #[cfg(target_os = "linux")]
    let result = Command::new("xdg-open").arg(path.parent().unwrap_or(path)).spawn();
    result.map(|_| ()).map_err(|err| format!("無法在檔案管理器顯示：{err}"))
}
