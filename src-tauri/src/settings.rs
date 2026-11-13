//! API key 的保管、数据文件夹、读取拖入的文本文件。
//! key 单独存放在 config/secrets.json，仅当前用户可读，与学习数据分开。

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

const MAX_TEXT_FILE_BYTES: u64 = 2 * 1024 * 1024;

pub fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn secrets_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = data_dir(app)?.join("config");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("secrets.json"))
}

fn read_key_file(path: &Path) -> Result<Option<String>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let value: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    Ok(value["api_key"]
        .as_str()
        .map(str::trim)
        .filter(|k| !k.is_empty())
        .map(str::to_string))
}

fn write_key_file(path: &Path, key: &str) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() {
        if path.exists() {
            fs::remove_file(path).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    let body = serde_json::to_string_pretty(&json!({ "api_key": key })).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(path)
            .map_err(|e| e.to_string())?;
        // 文件已存在时 mode() 不生效，这里再收紧一次
        file.set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|e| e.to_string())?;
        file.write_all(body.as_bytes()).map_err(|e| e.to_string())?;
    }
    #[cfg(not(unix))]
    {
        // Windows 下应用数据目录位于用户配置文件夹内，默认只有当前用户可访问
        fs::write(path, body).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// `sk-1234567890abcd` → `sk-****abcd`
fn mask(key: &str) -> String {
    let chars: Vec<char> = key.chars().collect();
    if chars.len() <= 8 {
        return "****".to_string();
    }
    let head: String = chars[..3].iter().collect();
    let tail: String = chars[chars.len() - 4..].iter().collect();
    format!("{head}****{tail}")
}

pub fn read_api_key(app: &tauri::AppHandle) -> Result<Option<String>, String> {
    read_key_file(&secrets_path(app)?)
}

#[tauri::command]
pub fn get_api_key_masked(app: tauri::AppHandle) -> Result<Option<String>, String> {
    Ok(read_api_key(&app)?.map(|k| mask(&k)))
}

#[tauri::command]
pub fn set_api_key(app: tauri::AppHandle, key: String) -> Result<(), String> {
    write_key_file(&secrets_path(&app)?, &key)
}

#[tauri::command]
pub fn open_data_dir(app: tauri::AppHandle) -> Result<(), String> {
    let dir = data_dir(&app)?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct TextFile {
    pub name: String,
    pub content: String,
}

fn read_text(path: &Path) -> Result<TextFile, String> {
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    if !matches!(extension.as_str(), "txt" | "md" | "markdown") {
        return Err("只支持 txt 和 md 文件".to_string());
    }
    let size = fs::metadata(path).map_err(|e| e.to_string())?.len();
    if size > MAX_TEXT_FILE_BYTES {
        return Err("文件过大（上限 2MB）".to_string());
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let (content, _, _) = encoding_rs::UTF_8.decode(&bytes);
    Ok(TextFile {
        name: path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("未命名")
            .to_string(),
        content: content.into_owned(),
    })
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<TextFile, String> {
    read_text(Path::new(&path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_key() {
        assert_eq!(mask("sk-1234567890abcd"), "sk-****abcd");
        assert_eq!(mask("short"), "****");
    }

    #[test]
    fn key_file_round_trip_and_removal() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("secrets.json");
        assert_eq!(read_key_file(&path).unwrap(), None);
        write_key_file(&path, "  sk-abcdefghijkl  ").unwrap();
        assert_eq!(
            read_key_file(&path).unwrap(),
            Some("sk-abcdefghijkl".to_string())
        );
        write_key_file(&path, "sk-second-key-0000").unwrap();
        assert_eq!(
            read_key_file(&path).unwrap(),
            Some("sk-second-key-0000".to_string())
        );
        write_key_file(&path, "").unwrap();
        assert!(!path.exists());
    }

    #[cfg(unix)]
    #[test]
    fn key_file_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("secrets.json");
        fs::write(&path, "{}").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        write_key_file(&path, "sk-abcdefghijkl").unwrap();
        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }

    #[test]
    fn reads_only_text_files() {
        let dir = tempfile::tempdir().unwrap();
        let ok = dir.path().join("a.MD");
        fs::write(&ok, "# Title\n\nBody").unwrap();
        let file = read_text(&ok).unwrap();
        assert_eq!(file.name, "a.MD");
        assert!(file.content.contains("Body"));
        let bad = dir.path().join("a.pdf");
        fs::write(&bad, "x").unwrap();
        assert!(read_text(&bad).is_err());
    }
}
