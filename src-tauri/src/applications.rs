//! On-demand, read-only discovery. Never launch applications or traverse their contents.
use crate::model::*;
use std::collections::HashSet;
#[cfg(any(target_os = "macos", target_os = "linux"))]
use std::path::{Path, PathBuf};

pub fn list() -> Result<Vec<InstalledApplication>> {
    let mut apps = discover()?;
    apps.retain(crate::config::valid_app);
    // Stable IDs survive display-name changes, reinstalls and different UI languages.
    apps.sort_by_key(|a| (a.name.to_lowercase(), a.id.to_lowercase()));
    let mut seen = HashSet::new();
    apps.retain(|a| seen.insert(a.id.to_lowercase()));
    Ok(apps)
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn walk(root: &Path, depth: usize, extension: &str, files: &mut Vec<PathBuf>, budget: &mut usize) {
    if depth == 0 || *budget == 0 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        if *budget == 0 {
            break;
        }
        *budget -= 1;
        let path = entry.path();
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case(extension))
        {
            files.push(path);
        } else if kind.is_dir() {
            // Do not follow directory symlinks or recurse into .app bundles.
            walk(&path, depth - 1, extension, files, budget);
        }
    }
}

#[cfg(target_os = "macos")]
fn discover() -> Result<Vec<InstalledApplication>> {
    let mut roots = vec![
        PathBuf::from("/Applications"),
        PathBuf::from("/System/Applications"),
    ];
    if let Some(home) = std::env::var_os("HOME") {
        roots.push(PathBuf::from(home).join("Applications"));
    }
    let mut files = vec![];
    let mut budget = 20000;
    for root in roots {
        walk(&root, 5, "app", &mut files, &mut budget);
    }
    Ok(files.iter().filter_map(|p| mac_bundle(p)).collect())
}

#[cfg(target_os = "macos")]
fn mac_bundle(path: &Path) -> Option<InstalledApplication> {
    let info = path.join("Contents/Info.plist");
    if std::fs::metadata(&info).ok()?.len() > 1_048_576 {
        return None;
    }
    let value = plist::Value::from_file(info).ok()?;
    let info = value.as_dictionary()?;
    let text = |key: &str| info.get(key).and_then(plist::Value::as_string);
    if text("CFBundlePackageType") != Some("APPL")
        || info
            .get("LSBackgroundOnly")
            .and_then(plist::Value::as_boolean)
            == Some(true)
    {
        return None;
    }
    let name = path
        .file_stem()
        .and_then(|v| v.to_str())
        .or_else(|| text("CFBundleDisplayName"))
        .or_else(|| text("CFBundleName"))?;
    Some(InstalledApplication {
        id: text("CFBundleIdentifier")?.into(),
        name: name.into(),
        aliases: vec![],
    })
}

#[cfg(target_os = "windows")]
fn discover() -> Result<Vec<InstalledApplication>> {
    // Resolve Start Menu shortcuts to executable IDs used by GetForegroundWindow sensing.
    // Shortcut arguments are never executed; no administrator privileges are required.
    let script = r#"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject WScript.Shell
$apps = @()
$roots = @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('CommonPrograms'))
foreach ($root in $roots) {
  foreach ($file in (Get-ChildItem -LiteralPath $root -Filter *.lnk -Recurse -ErrorAction SilentlyContinue | Select-Object -First 500)) {
    try {
      $target = $shell.CreateShortcut($file.FullName).TargetPath
      if ($target -and [IO.Path]::GetExtension($target) -ieq '.exe' -and (Test-Path -LiteralPath $target)) {
        $apps += @{ id=$target; name=$file.BaseName; aliases=@() }
      }
    } catch {}
  }
}
foreach ($root in @('HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths', 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths')) {
  foreach ($key in (Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue)) {
    $target = $key.GetValue('')
    if ($target) {
      $target = [Environment]::ExpandEnvironmentVariables($target).Trim('"')
      if (Test-Path -LiteralPath $target) { $apps += @{ id=$target; name=[IO.Path]::GetFileNameWithoutExtension($target); aliases=@() } }
    }
  }
}
ConvertTo-Json -InputObject @($apps | Sort-Object id -Unique | Select-Object -First 250) -Depth 3 -Compress
"#;
    let output = crate::process::run(
        "powershell.exe",
        &["-NoProfile", "-NonInteractive", "-Command", script],
        std::time::Duration::from_secs(15),
    )?;
    Ok(serde_json::from_str(&output)?)
}

#[cfg(target_os = "linux")]
fn discover() -> Result<Vec<InstalledApplication>> {
    let mut roots = vec![];
    if let Some(home) = std::env::var_os("XDG_DATA_HOME") {
        roots.push(PathBuf::from(home).join("applications"));
    } else if let Some(home) = std::env::var_os("HOME") {
        roots.push(PathBuf::from(home).join(".local/share/applications"));
    }
    for root in std::env::var("XDG_DATA_DIRS")
        .unwrap_or_else(|_| "/usr/local/share:/usr/share".into())
        .split(':')
    {
        if Path::new(root).is_absolute() {
            roots.push(PathBuf::from(root).join("applications"));
        }
    }
    let mut seen = HashSet::new();
    let mut apps = vec![];
    let mut budget = 20000;
    for root in roots {
        let mut files = vec![];
        walk(&root, 5, "desktop", &mut files, &mut budget);
        for file in files {
            let id = file
                .strip_prefix(&root)
                .unwrap_or(&file)
                .to_string_lossy()
                .replace('/', "-");
            if !seen.insert(id.clone()) {
                continue;
            } // User Hidden entries mask system entries.
            if std::fs::metadata(&file).is_ok_and(|m| m.len() <= 65536) {
                if let Ok(text) = std::fs::read_to_string(&file) {
                    if let Some(app) = desktop_entry(&id, &text) {
                        apps.push(app);
                    }
                }
            }
        }
    }
    Ok(apps)
}

#[cfg(any(target_os = "linux", test))]
fn desktop_entry(id: &str, text: &str) -> Option<InstalledApplication> {
    let mut fields = std::collections::HashMap::new();
    let mut entry = false;
    for line in text.lines().map(str::trim) {
        if line.starts_with('[') {
            entry = line == "[Desktop Entry]";
        } else if entry && !line.starts_with('#') {
            if let Some((k, v)) = line.split_once('=') {
                fields.insert(k, v);
            }
        }
    }
    if fields.get("Type") != Some(&"Application")
        || fields.get("Hidden") == Some(&"true")
        || fields.get("NoDisplay") == Some(&"true")
    {
        return None;
    }
    let name = fields.get("Name")?.to_string();
    let id = id.strip_suffix(".desktop").unwrap_or(id).to_string();
    let aliases = fields
        .get("StartupWMClass")
        .filter(|v| !v.is_empty())
        .map(|v| vec![v.to_string()])
        .unwrap_or_default();
    Some(InstalledApplication { id, name, aliases })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn desktop_entries_do_not_execute_commands_or_read_action_names() {
        let app = desktop_entry("code.desktop", "[Desktop Entry]\nType=Application\nName=Visual Studio Code\nExec=code --new-window %F\nStartupWMClass=Code\n[Desktop Action new-window]\nName=Other").unwrap();
        assert_eq!(app.id, "code");
        assert_eq!(app.name, "Visual Studio Code");
        assert_eq!(app.aliases, ["Code"]);
        assert!(desktop_entry(
            "code.desktop",
            "[Desktop Entry]\nType=Application\nName=Code\nHidden=true"
        )
        .is_none());
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn reads_binary_bundles_and_keeps_identifier_separate_from_name() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("Editor.app");
        std::fs::create_dir_all(path.join("Contents")).unwrap();
        let mut info = plist::Dictionary::new();
        for (k, v) in [
            ("CFBundleIdentifier", "com.example.editor"),
            ("CFBundleName", "Editor"),
            ("CFBundlePackageType", "APPL"),
        ] {
            info.insert(k.into(), plist::Value::String(v.into()));
        }
        plist::Value::Dictionary(info)
            .to_file_binary(path.join("Contents/Info.plist"))
            .unwrap();
        let app = mac_bundle(&path).unwrap();
        assert_eq!(app.id, "com.example.editor");
        assert_eq!(app.name, "Editor");
    }
}
