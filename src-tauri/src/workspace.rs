use base64::Engine as _;
use serde::Serialize;
use std::fs;
use std::path::Path;
use tauri::command;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    name: String,
    is_directory: bool,
    is_file: bool,
}

fn is_safe_name(name: &str) -> bool {
    !name.is_empty()
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains("..")
        && name != "."
        && name != ".."
}

fn is_safe_path(path: &str) -> bool {
    // Basic check to prevent directory traversal
    !path.contains("..")
}

#[command]
pub async fn workspace_read_dir(path: String) -> Result<Vec<DirEntry>, String> {
    if !is_safe_path(&path) {
        return Err("Invalid path".to_string());
    }
    let path = Path::new(&path);
    if !path.exists() {
        return Err("Path does not exist".to_string());
    }

    let entries = fs::read_dir(path).map_err(|e| e.to_string())?;
    let mut result = Vec::new();

    for entry in entries {
        if let Ok(entry) = entry {
            let file_name = entry.file_name().to_string_lossy().to_string();
            let file_type = entry.file_type().map_err(|e| e.to_string())?;
            result.push(DirEntry {
                name: file_name,
                is_directory: file_type.is_dir(),
                is_file: file_type.is_file(),
            });
        }
    }

    // Sort: directories first, then files, then alphabetically
    result.sort_by(|a, b| {
        if a.is_directory != b.is_directory {
            if a.is_directory {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            }
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });

    Ok(result)
}

#[command]
pub async fn workspace_create_file(parent_path: String, name: String) -> Result<(), String> {
    if !is_safe_path(&parent_path) || !is_safe_name(&name) {
        return Err("Invalid path or name".to_string());
    }

    let parent = Path::new(&parent_path);
    if !parent.is_dir() {
        return Err("Parent path is not a directory".to_string());
    }

    let file_path = parent.join(name);
    if file_path.exists() {
        return Err("File already exists".to_string());
    }

    fs::write(file_path, "").map_err(|e| e.to_string())?;
    Ok(())
}

#[command]
pub async fn workspace_create_dir(parent_path: String, name: String) -> Result<(), String> {
    if !is_safe_path(&parent_path) || !is_safe_name(&name) {
        return Err("Invalid path or name".to_string());
    }

    let parent = Path::new(&parent_path);
    if !parent.is_dir() {
        return Err("Parent path is not a directory".to_string());
    }

    let dir_path = parent.join(name);
    if dir_path.exists() {
        return Err("Directory already exists".to_string());
    }

    fs::create_dir(dir_path).map_err(|e| e.to_string())?;
    Ok(())
}

fn create_dir_all_checked(path: &str) -> Result<(), String> {
    if !is_safe_path(path) {
        return Err("Invalid path".to_string());
    }

    let dir_path = Path::new(path);
    if dir_path.exists() && !dir_path.is_dir() {
        return Err("Path already exists and is not a directory".to_string());
    }

    fs::create_dir_all(dir_path).map_err(|e| e.to_string())
}

#[command]
pub async fn workspace_create_dir_all(path: String) -> Result<(), String> {
    create_dir_all_checked(&path)
}

#[command]
pub async fn workspace_rename(target_path: String, new_name: String) -> Result<(), String> {
    if !is_safe_path(&target_path) || !is_safe_name(&new_name) {
        return Err("Invalid path or name".to_string());
    }

    let target = Path::new(&target_path);
    if !target.exists() {
        return Err("Target path does not exist".to_string());
    }

    let parent = target.parent().ok_or("Cannot rename root directory")?;
    let new_path = parent.join(new_name);

    if new_path.exists() {
        return Err("Destination already exists".to_string());
    }

    fs::rename(target, new_path).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::create_dir_all_checked;

    #[test]
    fn create_dir_all_checked_creates_nested_directories() {
        let root =
            std::env::temp_dir().join(format!("comet-ai-workspace-test-{}", uuid::Uuid::new_v4()));
        let nested = root.join("a").join("b").join("c");

        create_dir_all_checked(nested.to_string_lossy().as_ref()).expect("create nested directory");

        assert!(nested.is_dir());
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn create_dir_all_checked_rejects_traversal() {
        let error = create_dir_all_checked("../outside").expect_err("reject traversal");
        assert_eq!(error, "Invalid path");
    }
}

#[command]
pub async fn workspace_read_text_file(path: String) -> Result<String, String> {
    if !is_safe_path(&path) {
        return Err("Invalid path".to_string());
    }
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[command]
pub async fn workspace_read_binary_file_base64(path: String) -> Result<String, String> {
    if !is_safe_path(&path) {
        return Err("Invalid path".to_string());
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[command]
pub async fn workspace_write_text_file(path: String, content: String) -> Result<(), String> {
    if !is_safe_path(&path) {
        return Err("Invalid path".to_string());
    }
    fs::write(path, content).map_err(|e| e.to_string())
}

#[command]
pub async fn workspace_move(src: String, dest: String) -> Result<(), String> {
    if !is_safe_path(&src) || !is_safe_path(&dest) {
        return Err("Invalid path".to_string());
    }
    let src_path = Path::new(&src);
    let dest_path = Path::new(&dest);

    if !src_path.exists() {
        return Err("Source path does not exist".to_string());
    }

    if dest_path.exists() {
        return Err("Destination already exists".to_string());
    }

    fs::rename(src_path, dest_path).map_err(|e| e.to_string())?;
    Ok(())
}

#[command]
pub async fn workspace_copy(src: String, dest: String) -> Result<(), String> {
    if !is_safe_path(&src) || !is_safe_path(&dest) {
        return Err("Invalid path".to_string());
    }
    let src_path = Path::new(&src);
    let dest_path = Path::new(&dest);

    if !src_path.exists() {
        return Err("Source path does not exist".to_string());
    }

    if dest_path.exists() {
        return Err("Destination already exists".to_string());
    }

    if src_path.is_dir() {
        let src_canonical = src_path.canonicalize().map_err(|e| e.to_string())?;
        let dest_parent = dest_path
            .parent()
            .ok_or_else(|| "Destination parent path does not exist".to_string())?;
        let dest_parent_canonical = dest_parent.canonicalize().map_err(|e| e.to_string())?;
        if dest_parent_canonical.starts_with(&src_canonical) {
            return Err("Cannot copy a directory into itself".to_string());
        }
        copy_dir_recursive(src_path, dest_path)?;
        Ok(())
    } else {
        fs::copy(src_path, dest_path)
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}

fn copy_dir_recursive(src: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir(dest).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let entry_src = entry.path();
        let entry_dest = dest.join(entry.file_name());
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        if file_type.is_dir() {
            copy_dir_recursive(&entry_src, &entry_dest)?;
        } else if file_type.is_file() {
            fs::copy(&entry_src, &entry_dest).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[command]
pub async fn workspace_search(dir_path: String, query: String) -> Result<String, String> {
    if !is_safe_path(&dir_path) {
        return Err("Invalid path".to_string());
    }

    fn search_recursive(dir: &Path, query: &str, results: &mut String) -> Result<(), String> {
        let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;
        for entry in entries {
            if let Ok(entry) = entry {
                let path = entry.path();
                if path.is_dir() {
                    search_recursive(&path, query, results)?;
                } else if path.is_file() {
                    if let Ok(content) = fs::read_to_string(&path) {
                        if content.contains(query) {
                            results.push_str(&format!("{}: match found\n", path.display()));
                        }
                    }
                }
            }
        }
        Ok(())
    }

    let mut results = String::new();
    search_recursive(Path::new(&dir_path), &query, &mut results)?;

    if results.is_empty() {
        Ok("No matches found".to_string())
    } else {
        Ok(results)
    }
}

#[command]
pub async fn workspace_delete(target_path: String) -> Result<(), String> {
    if !is_safe_path(&target_path) {
        return Err("Invalid path".to_string());
    }
    let target = Path::new(&target_path);
    if !target.exists() {
        return Err("Target path does not exist".to_string());
    }

    if target.is_dir() {
        fs::remove_dir_all(target).map_err(|e| e.to_string())?;
    } else {
        fs::remove_file(target).map_err(|e| e.to_string())?;
    }
    Ok(())
}
