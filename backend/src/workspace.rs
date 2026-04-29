use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;


#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub is_directory: bool,
    pub is_file: bool,
}


pub fn workspace_read_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let entries = fs::read_dir(&path).map_err(|e| format!("Failed to read directory {}: {}", path, e))?;
    let mut result = Vec::new();
    for entry in entries {
        if let Ok(entry) = entry {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            
            result.push(DirEntry {
                name,
                is_directory: path.is_dir(),
                is_file: path.is_file(),
            });
        }
    }
    
    // Sort: directories first, then files, then alphabetically
    result.sort_by(|a, b| {
        if a.is_directory != b.is_directory {
            b.is_directory.cmp(&a.is_directory)
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });
    
    Ok(result)
}


pub fn workspace_read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Failed to read file {}: {}", path, e))
}


pub fn workspace_write_text_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| format!("Failed to write file {}: {}", path, e))
}


pub fn workspace_create_file(parent_path: String, name: String) -> Result<(), String> {
    let path = Path::new(&parent_path).join(name);
    if path.exists() {
        return Err("File already exists".to_string());
    }
    fs::File::create(&path).map_err(|e| format!("Failed to create file: {}", e))?;
    Ok(())
}


pub fn workspace_create_dir(parent_path: String, name: String) -> Result<(), String> {
    let path = Path::new(&parent_path).join(name);
    if path.exists() {
        return Err("Directory already exists".to_string());
    }
    fs::create_dir_all(&path).map_err(|e| format!("Failed to create directory: {}", e))
}


pub fn workspace_delete(target_path: String) -> Result<(), String> {
    let path = Path::new(&target_path);
    if !path.exists() {
        return Err("Path does not exist".to_string());
    }
    
    if path.is_dir() {
        fs::remove_dir_all(path).map_err(|e| format!("Failed to delete directory: {}", e))
    } else {
        fs::remove_file(path).map_err(|e| format!("Failed to delete file: {}", e))
    }
}


pub fn workspace_rename(target_path: String, new_name: String) -> Result<(), String> {
    let old_path = Path::new(&target_path);
    if !old_path.exists() {
        return Err("Path does not exist".to_string());
    }
    
    let parent = old_path.parent().ok_or("Invalid path")?;
    let new_path = parent.join(new_name);
    
    if new_path.exists() {
        return Err("Target name already exists".to_string());
    }
    
    fs::rename(old_path, new_path).map_err(|e| format!("Failed to rename: {}", e))
}


pub fn workspace_copy(src: String, dest: String) -> Result<(), String> {
    let src_path = Path::new(&src);
    if !src_path.exists() {
        return Err("Source path does not exist".to_string());
    }
    
    if src_path.is_dir() {
        copy_dir_recursive(src_path, Path::new(&dest))
    } else {
        fs::copy(src, dest).map_err(|e| format!("Failed to copy: {}", e))?;
        Ok(())
    }
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    if !dst.exists() {
        fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    }
    
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        if file_type.is_dir() {
            copy_dir_recursive(&entry.path(), &dst.join(entry.file_name()))?;
        } else {
            fs::copy(&entry.path(), &dst.join(entry.file_name())).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}


pub fn workspace_move(src: String, dest: String) -> Result<(), String> {
    fs::rename(src, dest).map_err(|e| format!("Failed to move: {}", e))
}


pub fn workspace_search(dir_path: String, query: String) -> Result<String, String> {
    let mut results = Vec::new();
    let root = Path::new(&dir_path);
    
    if !root.exists() {
        return Err("Search directory does not exist".to_string());
    }

    let query_lower = query.to_lowercase();
    
    fn search_recursive(path: &Path, query_lower: &str, results: &mut Vec<String>) {
        if let Ok(entries) = fs::read_dir(path) {
            for entry in entries.flatten() {
                let p = entry.path();
                let name = p.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
                
                if name.contains(query_lower) {
                    results.push(p.to_string_lossy().to_string());
                }
                
                if p.is_dir() {
                    let name_str = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
                    if name_str != "node_modules" && name_str != "target" && name_str != ".git" {
                        search_recursive(&p, query_lower, results);
                    }
                }
            }
        }
    }
    
    search_recursive(root, &query_lower, &mut results);
    
    if results.is_empty() {
        Ok("No results found".to_string())
    } else {
        Ok(results.join("\n"))
    }
}
