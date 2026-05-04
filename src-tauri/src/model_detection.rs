use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeSet, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const SHORT_COMMAND_TIMEOUT_MS: u64 = 2_500;
const CLAUDE_COMMAND_TIMEOUT_MS: u64 = 1_000;
const MAX_PREVIEW_CHARS: usize = 700;
const MAX_FILE_BYTES: u64 = 2_000_000;
const MAX_RECURSIVE_FILES: usize = 60;
const MAX_RECURSIVE_DEPTH: usize = 5;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliModel {
    cli: String,
    id: String,
    label: String,
    provider: Option<String>,
    source: String,
    raw: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryAttempt {
    method: String,
    command: Option<String>,
    args: Option<Vec<String>>,
    file_path: Option<String>,
    exit_code: Option<i32>,
    stdout_preview: Option<String>,
    stderr_preview: Option<String>,
    models_parsed: usize,
    error: Option<String>,
    parser_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDiscoveryResult {
    cli: String,
    models: Vec<CliModel>,
    attempts: Vec<DiscoveryAttempt>,
    warnings: Vec<String>,
    errors: Vec<String>,
    fetched_at: String,
    from_cache: bool,
    cache_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelDiscoveryCache {
    schema_version: u32,
    entries: Vec<ModelDiscoveryCacheEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelDiscoveryCacheEntry {
    cli: String,
    models: Vec<CliModel>,
    attempts: Vec<DiscoveryAttempt>,
    warnings: Vec<String>,
    errors: Vec<String>,
    fetched_at: String,
}

#[tauri::command]
pub async fn detect_models(cli: String) -> Result<Vec<String>, String> {
    let result = discover_cli_models(cli, None, Some(false)).await?;
    Ok(result.models.into_iter().map(|model| model.id).collect())
}

#[tauri::command]
pub async fn discover_models(
    cli: String,
    workspace_dir: Option<String>,
    refresh: Option<bool>,
) -> Result<ModelDiscoveryResult, String> {
    discover_cli_models(cli, workspace_dir, refresh).await
}

#[tauri::command]
pub async fn discover_cli_models(
    cli: String,
    project_path: Option<String>,
    refresh: Option<bool>,
) -> Result<ModelDiscoveryResult, String> {
    let normalized = cli.trim().to_lowercase();
    let refresh = refresh.unwrap_or(false);
    let cache_path = cache_path(project_path.as_deref());

    if !refresh {
        if let Some(mut cached) = read_cache_entry(&cache_path, &normalized) {
            cached.from_cache = true;
            cached.cache_path = Some(cache_path.to_string_lossy().to_string());
            cached.warnings.insert(
                0,
                format!(
                    "Loaded from cache, last refreshed at {}.",
                    cached.fetched_at
                ),
            );
            for attempt in &cached.attempts {
                log_attempt(&cached.cli, attempt);
            }
            return Ok(cached);
        }
    }

    let mut result = ModelDiscoveryResult {
        cli: normalized.clone(),
        models: Vec::new(),
        attempts: Vec::new(),
        warnings: Vec::new(),
        errors: Vec::new(),
        fetched_at: iso_now(),
        from_cache: false,
        cache_path: Some(cache_path.to_string_lossy().to_string()),
    };

    match normalized.as_str() {
        "opencode" => discover_opencode_models(&mut result, refresh),
        "codex" => discover_codex_models(&mut result, project_path.as_deref()),
        "claude" => discover_claude_models(&mut result, project_path.as_deref()),
        "gemini" => discover_gemini_models(&mut result, project_path.as_deref()),
        _ => result.warnings.push(format!(
            "Model discovery is not configured for CLI \"{}\".",
            cli
        )),
    }

    dedupe_models(&mut result.models);
    if result.models.is_empty() {
        result.warnings.push(format!(
            "No models discovered for {} after {} attempt(s). See discovery attempts for details.",
            result.cli,
            result.attempts.len()
        ));
    }
    write_cache_entry(&cache_path, &result);
    Ok(result)
}

fn iso_now() -> String {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => format!("{}", duration.as_millis()),
        Err(_) => "0".to_string(),
    }
}

fn home_dir() -> Option<PathBuf> {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()
        .map(PathBuf::from)
}

fn cache_path(project_path: Option<&str>) -> PathBuf {
    let base = project_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(|| PathBuf::from("."));
    base.join(".terminal-docks")
        .join("model-discovery-cache.json")
}

fn read_cache_entry(path: &Path, cli: &str) -> Option<ModelDiscoveryResult> {
    let text = fs::read_to_string(path).ok()?;
    let cache = serde_json::from_str::<ModelDiscoveryCache>(&text).ok()?;
    if cache.schema_version != 3 {
        return None;
    }
    let entry = cache.entries.into_iter().find(|entry| entry.cli == cli)?;
    Some(ModelDiscoveryResult {
        cli: entry.cli,
        models: entry.models,
        attempts: entry.attempts,
        warnings: entry.warnings,
        errors: entry.errors,
        fetched_at: entry.fetched_at,
        from_cache: true,
        cache_path: Some(path.to_string_lossy().to_string()),
    })
}

fn write_cache_entry(path: &Path, result: &ModelDiscoveryResult) {
    let mut entries = fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<ModelDiscoveryCache>(&text).ok())
        .map(|cache| cache.entries)
        .unwrap_or_default();
    entries.retain(|entry| entry.cli != result.cli);
    entries.push(ModelDiscoveryCacheEntry {
        cli: result.cli.clone(),
        models: result.models.clone(),
        attempts: result.attempts.clone(),
        warnings: result.warnings.clone(),
        errors: result.errors.clone(),
        fetched_at: result.fetched_at.clone(),
    });
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(text) = serde_json::to_string_pretty(&ModelDiscoveryCache {
        schema_version: 3,
        entries,
    }) {
        let _ = fs::write(path, text);
    }
}

fn workspace_path(project_path: Option<&str>, suffix: &[&str]) -> Option<PathBuf> {
    let raw = project_path?.trim();
    if raw.is_empty() {
        return None;
    }
    let mut path = PathBuf::from(raw);
    for part in suffix {
        path.push(part);
    }
    Some(path)
}

fn push_model(
    result: &mut ModelDiscoveryResult,
    id: String,
    label: Option<String>,
    provider: Option<String>,
    source: &str,
    raw: Option<String>,
) {
    let id = id.trim().trim_matches('"').trim_matches('\'').to_string();
    if id.is_empty() || looks_secret(&id) {
        return;
    }
    let label = label.unwrap_or_else(|| default_model_label(&result.cli, &id));
    result.models.push(CliModel {
        cli: result.cli.clone(),
        label,
        id,
        provider,
        source: source.to_string(),
        raw,
    });
}

fn default_model_label(cli: &str, id: &str) -> String {
    match cli {
        "claude" => normalize_claude_model_id(id).unwrap_or_else(|| id.to_string()),
        _ => id.to_string(),
    }
}

fn dedupe_models(models: &mut Vec<CliModel>) {
    let mut seen = HashSet::new();
    models.retain(|model| seen.insert(model.id.to_lowercase()));
}

fn strip_ansi(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for next in chars.by_ref() {
                    if next.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
            continue;
        }
        out.push(ch);
    }
    out
}

fn preview(text: &str) -> String {
    let safe = redact_secrets(&strip_ansi(text)).replace('\r', "");
    let single = safe.lines().take(20).collect::<Vec<_>>().join("\n");
    if single.chars().count() <= MAX_PREVIEW_CHARS {
        single
    } else {
        format!(
            "{}...",
            single.chars().take(MAX_PREVIEW_CHARS).collect::<String>()
        )
    }
}

fn redact_secrets(text: &str) -> String {
    text.lines()
        .map(|line| {
            let lower = line.to_lowercase();
            if lower.contains("token")
                || lower.contains("api_key")
                || lower.contains("apikey")
                || lower.contains("auth")
                || lower.contains("secret")
                || lower.contains("password")
            {
                "[redacted secret-like line]".to_string()
            } else {
                line.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn looks_secret(value: &str) -> bool {
    let lower = value.to_lowercase();
    lower.contains("sk-")
        || lower.contains("api_key")
        || lower.contains("apikey")
        || lower.contains("token")
        || lower.contains("secret")
        || lower.contains("password")
}

fn add_attempt(result: &mut ModelDiscoveryResult, attempt: DiscoveryAttempt) {
    log_attempt(&result.cli, &attempt);
    result.attempts.push(attempt);
}

fn log_attempt(cli: &str, attempt: &DiscoveryAttempt) {
    let detail = if let Some(command) = &attempt.command {
        format!(
            "command=\"{}\" exit={} parsed={} stderr=\"{}\"",
            command,
            attempt
                .exit_code
                .map(|code| code.to_string())
                .unwrap_or_else(|| "null".to_string()),
            attempt.models_parsed,
            attempt.stderr_preview.clone().unwrap_or_default()
        )
    } else if let Some(file_path) = &attempt.file_path {
        format!("file=\"{}\" parsed={}", file_path, attempt.models_parsed)
    } else {
        format!("parsed={}", attempt.models_parsed)
    };
    println!(
        "[model-discovery] cli={} method={} {}",
        cli, attempt.method, detail
    );
}

fn run_command_with_timeout(
    command: &str,
    args: &[&str],
    timeout_ms: u64,
) -> (Option<i32>, String, String, Option<String>) {
    let mut child = match Command::new(command)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(error) => return (None, String::new(), String::new(), Some(error.to_string())),
    };

    let started = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => match child.wait_with_output() {
                Ok(output) => {
                    return (
                        output.status.code(),
                        String::from_utf8_lossy(&output.stdout).to_string(),
                        String::from_utf8_lossy(&output.stderr).to_string(),
                        None,
                    );
                }
                Err(error) => return (None, String::new(), String::new(), Some(error.to_string())),
            },
            Ok(None) => {
                if started.elapsed() > Duration::from_millis(timeout_ms) {
                    let _ = child.kill();
                    match child.wait_with_output() {
                        Ok(output) => {
                            return (
                                output.status.code(),
                                String::from_utf8_lossy(&output.stdout).to_string(),
                                String::from_utf8_lossy(&output.stderr).to_string(),
                                Some(format!("Timed out after {}ms.", timeout_ms)),
                            );
                        }
                        Err(error) => {
                            return (None, String::new(), String::new(), Some(error.to_string()))
                        }
                    }
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(error) => return (None, String::new(), String::new(), Some(error.to_string())),
        }
    }
}

fn command_attempt_with_timeout<F>(
    result: &mut ModelDiscoveryResult,
    method: &str,
    command: &str,
    args: &[&str],
    source: &str,
    timeout_ms: u64,
    parser: F,
) -> usize
where
    F: Fn(&str) -> Vec<String>,
{
    let (exit_code, stdout, stderr, error) = run_command_with_timeout(command, args, timeout_ms);
    let combined = format!("{}\n{}", stdout, stderr);
    let ids = if error.is_none() {
        parser(&combined)
    } else {
        Vec::new()
    };
    let parsed = ids.len();
    for id in ids {
        push_model(
            result,
            id.clone(),
            None,
            provider_from_id(&id),
            source,
            Some(id),
        );
    }
    let parser_reason = if parsed == 0 && error.is_none() {
        Some(format!(
            "No model IDs matched parser for `{}`.",
            format_command(command, args)
        ))
    } else {
        None
    };
    add_attempt(
        result,
        DiscoveryAttempt {
            method: method.to_string(),
            command: Some(format_command(command, args)),
            args: Some(args.iter().map(|arg| arg.to_string()).collect()),
            file_path: None,
            exit_code,
            stdout_preview: Some(preview(&stdout)),
            stderr_preview: Some(preview(&stderr)),
            models_parsed: parsed,
            error,
            parser_reason,
        },
    );
    parsed
}

fn format_command(command: &str, args: &[&str]) -> String {
    std::iter::once(command)
        .chain(args.iter().copied())
        .collect::<Vec<_>>()
        .join(" ")
}

fn file_attempt<F>(
    result: &mut ModelDiscoveryResult,
    method: &str,
    path: &Path,
    source: &str,
    parser: F,
) -> usize
where
    F: Fn(&str) -> Vec<String>,
{
    let path_string = path.to_string_lossy().to_string();
    let mut error = None;
    let mut parser_reason = None;
    let ids = match fs::metadata(path) {
        Ok(metadata) if metadata.len() > MAX_FILE_BYTES => {
            parser_reason = Some(format!("File is larger than {} bytes.", MAX_FILE_BYTES));
            Vec::new()
        }
        Ok(_) => match fs::read_to_string(path) {
            Ok(content) => parser(&content),
            Err(read_error) => {
                error = Some(read_error.to_string());
                Vec::new()
            }
        },
        Err(_) => {
            parser_reason = Some("File not found.".to_string());
            Vec::new()
        }
    };
    let parsed = ids.len();
    if parsed == 0 && parser_reason.is_none() && error.is_none() {
        parser_reason = Some("No model IDs matched parser.".to_string());
    }
    for id in ids {
        push_model(
            result,
            id.clone(),
            None,
            provider_from_id(&id),
            source,
            Some(path_string.clone()),
        );
    }
    add_attempt(
        result,
        DiscoveryAttempt {
            method: method.to_string(),
            command: None,
            args: None,
            file_path: Some(path_string),
            exit_code: None,
            stdout_preview: None,
            stderr_preview: None,
            models_parsed: parsed,
            error,
            parser_reason,
        },
    );
    parsed
}

fn discover_opencode_models(result: &mut ModelDiscoveryResult, refresh: bool) {
    let args = if refresh {
        vec!["models", "--refresh"]
    } else {
        vec!["models"]
    };
    let parsed = command_attempt_with_timeout(
        result,
        "command",
        "opencode",
        &args,
        "cli-command",
        SHORT_COMMAND_TIMEOUT_MS,
        parse_provider_model_tokens,
    );
    if parsed == 0 {
        let verbose_args = if refresh {
            vec!["models", "--refresh", "--verbose"]
        } else {
            vec!["models", "--verbose"]
        };
        command_attempt_with_timeout(
            result,
            "command",
            "opencode",
            &verbose_args,
            "cli-command",
            SHORT_COMMAND_TIMEOUT_MS,
            parse_provider_model_tokens,
        );
    }
    if let Some(home) = home_dir() {
        file_attempt(
            result,
            "file",
            &home.join(".config").join("opencode").join("opencode.json"),
            "config-file",
            parse_opencode_config_models,
        );
        parse_opencode_db_models(
            result,
            &home
                .join(".local")
                .join("share")
                .join("opencode")
                .join("opencode.db"),
        );
        let mut providers = BTreeSet::new();
        for model in &result.models {
            if model.cli == "opencode" {
                if let Some(provider) = &model.provider {
                    if !provider.trim().is_empty() {
                        providers.insert(provider.to_string());
                    }
                } else if let Some((provider, _)) = model.id.split_once('/') {
                    if !provider.trim().is_empty() {
                        providers.insert(provider.to_string());
                    }
                }
            }
        }
        for provider in providers.into_iter().take(24) {
            let args = vec!["models", provider.as_str()];
            let parsed = command_attempt_with_timeout(
                result,
                "command",
                "opencode",
                &args,
                "cli-command",
                SHORT_COMMAND_TIMEOUT_MS,
                parse_provider_model_tokens,
            );
            if parsed == 0 && refresh {
                command_attempt_with_timeout(
                    result,
                    "command",
                    "opencode",
                    &["models", provider.as_str(), "--verbose"],
                    "cli-command",
                    SHORT_COMMAND_TIMEOUT_MS,
                    parse_provider_model_tokens,
                );
            }
        }
    }
}

fn discover_codex_models(result: &mut ModelDiscoveryResult, project_path: Option<&str>) {
    if let Some(home) = home_dir() {
        let user_codex = home.join(".codex");
        file_attempt(
            result,
            "file",
            &user_codex.join("config.toml"),
            "config-file",
            parse_toml_model_fields,
        );
        file_attempt(
            result,
            "file",
            &user_codex.join("models_cache.json"),
            "cache-file",
            |text| parse_json_model_strings(text, "codex"),
        );
        for path in find_matching_files(
            &user_codex,
            MAX_RECURSIVE_DEPTH,
            MAX_RECURSIVE_FILES,
            |path| {
                let name = path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                name != "auth.json"
                    && path.extension().and_then(|value| value.to_str()) == Some("json")
                    && (name.contains("model") || name.contains("models"))
            },
        ) {
            file_attempt(result, "file", &path, "cache-file", |text| {
                parse_json_model_strings(text, "codex")
            });
        }
    } else {
        result
            .warnings
            .push("Cannot find user home directory for Codex config.".to_string());
    }

    if let Some(path) = workspace_path(project_path, &[".codex", "config.toml"]) {
        file_attempt(
            result,
            "file",
            &path,
            "config-file",
            parse_toml_model_fields,
        );
    }

    let help_text = run_help_probe_with_timeout(
        result,
        "codex",
        &["--help"],
        SHORT_COMMAND_TIMEOUT_MS,
        parse_codex_help_models,
    );
    let exec_help_text = run_help_probe_with_timeout(
        result,
        "codex",
        &["exec", "--help"],
        SHORT_COMMAND_TIMEOUT_MS,
        parse_codex_help_models,
    );
    let combined_help = format!("{}\n{}", help_text, exec_help_text).to_lowercase();
    if command_list_mentions(&combined_help, "models") {
        let models_help = run_help_probe_with_timeout(
            result,
            "codex",
            &["models", "--help"],
            SHORT_COMMAND_TIMEOUT_MS,
            parse_codex_help_models,
        );
        if !models_help.trim().is_empty() {
            command_attempt_with_timeout(
                result,
                "command",
                "codex",
                &["models"],
                "cli-command",
                SHORT_COMMAND_TIMEOUT_MS,
                parse_codex_help_models,
            );
        }
    }
}

fn discover_claude_models(result: &mut ModelDiscoveryResult, project_path: Option<&str>) {
    if let Some(home) = home_dir() {
        file_attempt(
            result,
            "file",
            &home.join(".claude").join("settings.json"),
            "config-file",
            parse_claude_settings_models,
        );
        file_attempt(
            result,
            "file",
            &home.join(".claude.json"),
            "config-file",
            parse_claude_settings_models,
        );
    } else {
        result
            .warnings
            .push("Cannot find user home directory for Claude settings.".to_string());
    }
    for suffix in [
        [".claude", "settings.json"],
        [".claude", "settings.local.json"],
    ] {
        if let Some(path) = workspace_path(project_path, &suffix) {
            file_attempt(
                result,
                "file",
                &path,
                "config-file",
                parse_claude_settings_models,
            );
        }
    }

    run_help_probe_with_timeout(
        result,
        "claude",
        &["--help"],
        CLAUDE_COMMAND_TIMEOUT_MS,
        parse_claude_text_models,
    );
}

fn discover_gemini_models(result: &mut ModelDiscoveryResult, project_path: Option<&str>) {
    if let Some(home) = home_dir() {
        let gemini = home.join(".gemini");
        file_attempt(
            result,
            "file",
            &gemini.join("settings.json"),
            "config-file",
            parse_gemini_model_tokens,
        );
        for path in find_matching_files(&gemini, MAX_RECURSIVE_DEPTH, MAX_RECURSIVE_FILES, |path| {
            let name = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_lowercase();
            path.extension().and_then(|value| value.to_str()) == Some("json")
                && (name.contains("model")
                    || name.contains("models")
                    || name == "logs.json"
                    || name.contains("session"))
        }) {
            let source = if path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .eq_ignore_ascii_case("settings.json")
            {
                "config-file"
            } else {
                "cache-file"
            };
            file_attempt(result, "file", &path, source, parse_gemini_model_tokens);
        }
    } else {
        result
            .warnings
            .push("Cannot find user home directory for Gemini settings.".to_string());
    }
    if let Some(path) = workspace_path(project_path, &[".gemini", "settings.json"]) {
        file_attempt(
            result,
            "file",
            &path,
            "config-file",
            parse_gemini_model_tokens,
        );
    }
    run_help_probe_with_timeout(
        result,
        "gemini",
        &["--help"],
        SHORT_COMMAND_TIMEOUT_MS,
        parse_gemini_model_tokens,
    );
}

fn run_help_probe_with_timeout<F>(
    result: &mut ModelDiscoveryResult,
    command: &str,
    args: &[&str],
    timeout_ms: u64,
    parser: F,
) -> String
where
    F: Fn(&str) -> Vec<String>,
{
    let (exit_code, stdout, stderr, error) = run_command_with_timeout(command, args, timeout_ms);
    let combined = format!("{}\n{}", stdout, stderr);
    let ids = if error.is_none() {
        parser(&combined)
    } else {
        Vec::new()
    };
    let parsed = ids.len();
    for id in ids {
        push_model(
            result,
            id.clone(),
            None,
            provider_from_id(&id),
            "cli-command",
            Some(id),
        );
    }
    let parser_reason = if parsed == 0 && error.is_none() {
        Some(format!(
            "No model IDs matched parser for `{}`.",
            format_command(command, args)
        ))
    } else {
        None
    };
    add_attempt(
        result,
        DiscoveryAttempt {
            method: "command".to_string(),
            command: Some(format_command(command, args)),
            args: Some(args.iter().map(|arg| arg.to_string()).collect()),
            file_path: None,
            exit_code,
            stdout_preview: Some(preview(&stdout)),
            stderr_preview: Some(preview(&stderr)),
            models_parsed: parsed,
            error,
            parser_reason,
        },
    );
    combined
}

fn parse_provider_model_tokens(text: &str) -> Vec<String> {
    let clean = strip_ansi(text);
    let mut out = Vec::new();
    for token in clean.split(|ch: char| {
        !(ch.is_ascii_alphanumeric()
            || ch == '/'
            || ch == '.'
            || ch == '_'
            || ch == '-'
            || ch == ':'
            || ch == '+')
    }) {
        let token = token.trim_matches(|ch: char| ch == '`' || ch == '"' || ch == '\'');
        if !is_provider_model_id(token) {
            continue;
        }
        out.push(token.to_string());
    }
    dedupe_strings(out)
}

fn is_provider_model_id(token: &str) -> bool {
    let token = token
        .trim()
        .trim_matches('`')
        .trim_matches('"')
        .trim_matches('\'')
        .trim_end_matches('.');
    let segments: Vec<&str> = token
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect();
    if !(2..=3).contains(&segments.len()) {
        return false;
    }
    if segments.iter().any(|segment| is_doc_like_token(segment)) {
        return false;
    }
    if segments.iter().any(|segment| {
        !segment.chars().all(|c| {
            c.is_ascii_alphanumeric() || c == '_' || c == '.' || c == ':' || c == '+' || c == '-'
        })
    }) {
        return false;
    }
    if segments[0].chars().all(|c| c.is_ascii_digit()) {
        return false;
    }
    let last = segments[segments.len() - 1];
    if last.ends_with(".md")
        || last.ends_with(".markdown")
        || last.ends_with(".json")
        || last.ends_with(".toml")
        || last.ends_with(".yaml")
        || last.ends_with(".yml")
        || last.ends_with(".txt")
        || last.ends_with(".rst")
    {
        return false;
    }
    if last.chars().all(|c| c.is_ascii_digit()) {
        return false;
    }
    if last.len() < 2 {
        return false;
    }
    last.chars()
        .any(|c| c.is_ascii_digit() || c == ':' || c == '+' || c == '-')
}

fn is_doc_like_token(value: &str) -> bool {
    let lower = value.trim().to_lowercase();
    matches!(
        lower.as_str(),
        "doc" | "docs" | "documentation" | "readme" | "markdown" | "notes"
    ) || lower.ends_with(".md")
        || lower.ends_with(".markdown")
        || lower.ends_with(".txt")
        || lower.ends_with(".rst")
        || lower.ends_with(".json")
        || lower.ends_with(".toml")
        || lower.ends_with(".yaml")
        || lower.ends_with(".yml")
}

fn parse_gemini_model_tokens(text: &str) -> Vec<String> {
    let clean = strip_ansi(text);
    let mut out = Vec::new();
    for token in
        clean.split(|ch: char| !(ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.'))
    {
        let token = token
            .trim_matches(|ch: char| ch == '`' || ch == '"' || ch == '\'')
            .trim_end_matches('.');
        if is_gemini_model_id(token) {
            out.push(token.to_string());
        }
    }
    dedupe_strings(out)
}

fn is_gemini_model_id(value: &str) -> bool {
    let lower = value.to_lowercase();
    let Some(rest) = lower.strip_prefix("gemini-") else {
        return false;
    };
    if !rest.chars().next().is_some_and(|ch| ch.is_ascii_digit()) {
        return false;
    }
    if !lower
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
    {
        return false;
    }
    !lower.ends_with(".md")
        && !lower.ends_with(".json")
        && !lower.contains("ignore")
        && !lower.contains("sandbox")
        && !lower.contains("robot")
        && !lower.contains("code-assist")
        && !lower.contains("customtools")
        && !lower.contains("-is-")
        && !lower.contains("available")
        && !lower.ends_with("-cli")
}

fn parse_codex_help_models(text: &str) -> Vec<String> {
    parse_provider_model_tokens(text)
        .into_iter()
        .chain(parse_model_like_tokens(text).into_iter())
        .filter(|id| is_plausible_model_id(id, "codex"))
        .collect::<Vec<_>>()
        .pipe(dedupe_strings)
}

fn parse_claude_text_models(text: &str) -> Vec<String> {
    parse_provider_model_tokens(text)
        .into_iter()
        .chain(parse_model_like_tokens(text).into_iter())
        .filter(|id| is_plausible_model_id(id, "claude"))
        .collect::<Vec<_>>()
        .pipe(dedupe_strings)
}

fn parse_model_like_tokens(text: &str) -> Vec<String> {
    let clean = strip_ansi(text);
    let mut out = Vec::new();
    for token in clean.split(|ch: char| {
        !(ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.' || ch == '/')
    }) {
        let token = token.trim_matches(|ch: char| ch == '`' || ch == '"' || ch == '\'');
        if token.len() >= 2 && token.len() <= 120 {
            out.push(token.to_string());
        }
    }
    out
}

fn parse_toml_model_fields(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') || !trimmed.contains('=') {
            continue;
        }
        let Some((key, value)) = trimmed.split_once('=') else {
            continue;
        };
        let key = key
            .trim()
            .trim_matches('"')
            .trim_matches('\'')
            .to_lowercase();
        if key != "model" && !key.ends_with(".model") {
            continue;
        }
        let value = value.split('#').next().unwrap_or("").trim();
        if let Some(model) = unquote(value) {
            if is_plausible_model_id(&model, "codex") {
                out.push(model);
            }
        }
    }
    dedupe_strings(out)
}

fn parse_json_model_strings(text: &str, cli: &str) -> Vec<String> {
    match serde_json::from_str::<Value>(text) {
        Ok(value) => {
            let mut out = Vec::new();
            collect_json_models(&value, cli, false, &mut out);
            dedupe_strings(out)
        }
        Err(_) => {
            let mut out = parse_provider_model_tokens(text);
            out.extend(parse_gemini_model_tokens(text));
            out.extend(
                parse_model_like_tokens(text)
                    .into_iter()
                    .filter(|id| is_plausible_model_id(id, cli)),
            );
            dedupe_strings(out)
        }
    }
}

fn parse_claude_settings_models(text: &str) -> Vec<String> {
    let Ok(value) = serde_json::from_str::<Value>(text) else {
        return parse_claude_text_models(text);
    };
    let mut out = Vec::new();
    collect_claude_settings_models(&value, false, &mut out);
    dedupe_strings(out)
}

fn collect_claude_settings_models(value: &Value, targeted: bool, out: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                let lower = key.to_lowercase();
                if lower.ends_with("lastmodelusage") || lower.ends_with("last_model_usage") {
                    if let Value::Object(usage) = child {
                        for model_id in usage.keys() {
                            if let Some(model_id) = normalize_claude_model_id(model_id) {
                                if is_claude_model_id(&model_id) {
                                    out.push(model_id);
                                }
                            }
                        }
                    }
                    continue;
                }

                let next_targeted = targeted
                    || is_claude_model_key(&lower)
                    || lower.ends_with("_model")
                    || lower.starts_with("anthropic_default_");
                collect_claude_settings_models(child, next_targeted, out);
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_claude_settings_models(item, targeted, out);
            }
        }
        Value::String(value) => {
            if targeted {
                if let Some(model_id) = normalize_claude_model_id(value) {
                    if is_claude_model_id(&model_id) {
                        out.push(model_id);
                    }
                }
            }
        }
        _ => {}
    }
}

fn is_claude_model_key(lower: &str) -> bool {
    lower == "model"
        || lower == "modelid"
        || lower == "model_id"
        || lower == "availablemodels"
        || lower == "available_models"
        || lower == "defaultmodel"
        || lower == "default_model"
        || lower == "selectedmodel"
        || lower == "selected_model"
        || lower == "small_model"
        || lower == "smallmodel"
}

fn is_claude_model_id(value: &str) -> bool {
    let lower = value.trim().to_lowercase();
    if lower.is_empty() || lower.len() > 120 {
        return false;
    }
    if !(lower.starts_with("anthropic/claude-") || lower.starts_with("claude-")) {
        return false;
    }
    lower.contains("sonnet") || lower.contains("opus") || lower.contains("haiku")
}

fn normalize_claude_model_id(value: &str) -> Option<String> {
    let trimmed = value
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .to_lowercase();
    if trimmed.is_empty() {
        return None;
    }
    let candidate = if let Some(rest) = trimmed.strip_prefix("anthropic/") {
        rest.to_string()
    } else {
        trimmed
    };
    let segments: Vec<&str> = candidate.split('-').collect();
    if segments.len() >= 5 {
        let last = segments.last().copied().unwrap_or("");
        if last.len() == 8 && last.chars().all(|c| c.is_ascii_digit()) {
            return Some(segments[..segments.len() - 1].join("-"));
        }
    }
    Some(candidate)
}

fn parse_opencode_config_models(text: &str) -> Vec<String> {
    let Ok(value) = serde_json::from_str::<Value>(text) else {
        return parse_provider_model_tokens(text);
    };
    let mut out = Vec::new();
    collect_opencode_config_models(&value, &mut out);
    dedupe_strings(out)
}

fn collect_opencode_config_models(value: &Value, out: &mut Vec<String>) {
    let Value::Object(map) = value else {
        return;
    };
    for key in ["model", "small_model", "smallModel"] {
        if let Some(Value::String(id)) = map.get(key) {
            if is_provider_model_id(id) {
                out.push(id.to_string());
            }
        }
    }
    let Some(Value::Object(providers)) = map.get("provider") else {
        return;
    };
    for (provider_id, provider_value) in providers {
        let Value::Object(provider_map) = provider_value else {
            continue;
        };
        let Some(Value::Object(models)) = provider_map.get("models") else {
            continue;
        };
        for (model_id, model_value) in models {
            let disabled = model_value
                .as_object()
                .and_then(|model| model.get("disabled"))
                .and_then(Value::as_bool)
                .unwrap_or(false);
            if disabled {
                continue;
            }
            let id = format!("{provider_id}/{model_id}");
            if is_provider_model_id(&id) {
                out.push(id);
            }
        }
    }
}

fn parse_opencode_db_models(result: &mut ModelDiscoveryResult, path: &Path) -> usize {
    let path_string = path.to_string_lossy().to_string();
    let mut error = None;
    let mut parser_reason = None;
    let mut ids = Vec::new();

    match fs::metadata(path) {
        Ok(_) => {
            let flags = rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY
                | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX;
            match rusqlite::Connection::open_with_flags(path, flags) {
                Ok(connection) => {
                    for table in [
                        "project",
                        "message",
                        "part",
                        "session",
                        "permission",
                        "todo",
                        "session_entry",
                        "event",
                    ] {
                        collect_opencode_db_table(&connection, table, &mut ids);
                    }
                }
                Err(db_error) => error = Some(db_error.to_string()),
            }
        }
        Err(_) => parser_reason = Some("File not found.".to_string()),
    }

    ids = dedupe_strings(ids);
    let parsed = ids.len();
    if parsed == 0 && parser_reason.is_none() && error.is_none() {
        parser_reason = Some("No providerID/modelID pairs found in OpenCode database.".to_string());
    }
    for id in ids {
        push_model(
            result,
            id.clone(),
            None,
            provider_from_id(&id),
            "cache-file",
            Some(path_string.clone()),
        );
    }
    add_attempt(
        result,
        DiscoveryAttempt {
            method: "file".to_string(),
            command: None,
            args: None,
            file_path: Some(path_string),
            exit_code: None,
            stdout_preview: None,
            stderr_preview: None,
            models_parsed: parsed,
            error,
            parser_reason,
        },
    );
    parsed
}

fn collect_opencode_db_table(
    connection: &rusqlite::Connection,
    table: &str,
    out: &mut Vec<String>,
) {
    let text_columns = sqlite_text_columns(connection, table);
    if text_columns.is_empty() {
        return;
    };
    for column in text_columns {
        let sql = format!(
            "select \"{}\" from \"{}\" order by rowid desc limit 5000",
            column, table
        );
        let Ok(mut statement) = connection.prepare(&sql) else {
            continue;
        };
        let Ok(rows) = statement.query_map([], |row| row.get::<_, String>(0)) else {
            continue;
        };
        for row in rows.flatten() {
            if let Ok(value) = serde_json::from_str::<Value>(&row) {
                collect_opencode_provider_model_pairs(&value, out);
            } else {
                for id in parse_provider_model_tokens(&row) {
                    if is_provider_model_id(&id) {
                        out.push(id);
                    }
                }
            }
        }
    }
}

fn sqlite_text_columns(connection: &rusqlite::Connection, table: &str) -> Vec<String> {
    let sql = format!("pragma table_info({table})");
    let Ok(mut statement) = connection.prepare(&sql) else {
        return Vec::new();
    };
    let Ok(rows) = statement.query_map([], |row| {
        Ok((row.get::<_, String>(1)?, row.get::<_, String>(2)?))
    }) else {
        return Vec::new();
    };
    rows.flatten()
        .filter_map(|(name, ty)| {
            let lower = ty.to_lowercase();
            if lower.contains("text") || lower.is_empty() {
                Some(name)
            } else {
                None
            }
        })
        .collect()
}

fn collect_opencode_provider_model_pairs(value: &Value, out: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            let provider = map
                .get("providerID")
                .or_else(|| map.get("providerId"))
                .or_else(|| map.get("provider_id"))
                .or_else(|| map.get("provider"))
                .and_then(Value::as_str);
            let model = map
                .get("modelID")
                .or_else(|| map.get("modelId"))
                .or_else(|| map.get("model_id"))
                .or_else(|| map.get("model"))
                .and_then(Value::as_str);
            if let (Some(provider), Some(model)) = (provider, model) {
                let id = format!("{provider}/{model}");
                if is_provider_model_id(&id) {
                    out.push(id);
                }
            }
            for child in map.values() {
                collect_opencode_provider_model_pairs(child, out);
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_opencode_provider_model_pairs(item, out);
            }
        }
        _ => {}
    }
}

fn collect_json_models(value: &Value, cli: &str, key_targeted: bool, out: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                let lower = key.to_lowercase();
                let targeted = key_targeted || is_model_key(&lower);
                collect_json_models(child, cli, targeted, out);
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_json_models(item, cli, key_targeted, out);
            }
        }
        Value::String(value) => {
            if key_targeted {
                collect_string_model_ids(value, cli, out);
            }
        }
        _ => {}
    }
}

fn is_model_key(lower: &str) -> bool {
    lower == "availablemodels"
        || lower == "available_models"
        || lower == "model"
        || lower == "models"
        || lower == "defaultmodel"
        || lower == "default_model"
        || lower == "selectedmodel"
        || lower == "selected_model"
        || lower == "modelid"
        || lower == "model_id"
        || lower == "small_model"
        || lower == "smallmodel"
}

fn collect_string_model_ids(value: &str, cli: &str, out: &mut Vec<String>) {
    let mut matched = false;
    for id in parse_provider_model_tokens(value) {
        if is_plausible_model_id(&id, cli) {
            out.push(id);
            matched = true;
        }
    }
    for id in parse_gemini_model_tokens(value) {
        if is_plausible_model_id(&id, cli) {
            out.push(id);
            matched = true;
        }
    }
    let trimmed = value.trim();
    if !matched && is_plausible_model_id(trimmed, cli) {
        out.push(trimmed.to_string());
    }
}

fn is_plausible_model_id(value: &str, cli: &str) -> bool {
    let value = value.trim();
    if value.is_empty() || value.len() > 120 || looks_secret(value) {
        return false;
    }
    if value.contains(char::is_whitespace) {
        return false;
    }
    let lower = value.to_lowercase();
    match cli {
        "gemini" => {
            is_gemini_model_id(&lower)
                || lower
                    .strip_prefix("google/")
                    .is_some_and(is_gemini_model_id)
        }
        "claude" => {
            (lower.starts_with("anthropic/claude-") || lower.starts_with("claude-"))
                && (lower.contains("sonnet") || lower.contains("opus") || lower.contains("haiku"))
        }
        "codex" => {
            lower.contains("gpt")
                || lower == "o1"
                || lower == "o3"
                || lower == "o4"
                || lower.starts_with("o1-")
                || lower.starts_with("o3-")
                || lower.starts_with("o4-")
                || lower.contains("-codex")
                || lower.starts_with("openai/")
        }
        _ => is_provider_model_id(value),
    }
}

fn unquote(value: &str) -> Option<String> {
    let trimmed = value.trim().trim_end_matches(',');
    if trimmed.len() >= 2 {
        let bytes = trimmed.as_bytes();
        if (bytes[0] == b'"' && bytes[trimmed.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[trimmed.len() - 1] == b'\'')
        {
            return Some(trimmed[1..trimmed.len() - 1].trim().to_string());
        }
    }
    None
}

fn provider_from_id(id: &str) -> Option<String> {
    id.split_once('/').map(|(provider, _)| provider.to_string())
}

fn dedupe_strings(values: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for value in values {
        let key = value.to_lowercase();
        if seen.insert(key) {
            out.push(value);
        }
    }
    out
}

fn command_list_mentions(help_text: &str, command_name: &str) -> bool {
    help_text.lines().any(|line| {
        let line = line.trim().to_lowercase();
        line.starts_with(command_name)
            || line.contains(&format!(" {}", command_name))
            || line.contains(&format!("\t{}", command_name))
    })
}

fn find_matching_files<F>(
    root: &Path,
    max_depth: usize,
    max_count: usize,
    predicate: F,
) -> Vec<PathBuf>
where
    F: Fn(&Path) -> bool,
{
    let mut out = Vec::new();
    find_matching_files_inner(root, 0, max_depth, max_count, &predicate, &mut out);
    out
}

fn find_matching_files_inner<F>(
    dir: &Path,
    depth: usize,
    max_depth: usize,
    max_count: usize,
    predicate: &F,
    out: &mut Vec<PathBuf>,
) where
    F: Fn(&Path) -> bool,
{
    if depth > max_depth || out.len() >= max_count {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if out.len() >= max_count {
            return;
        }
        let path = entry.path();
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("");
        if name.eq_ignore_ascii_case("auth.json") {
            continue;
        }
        if path.is_dir() {
            find_matching_files_inner(&path, depth + 1, max_depth, max_count, predicate, out);
        } else if predicate(&path) {
            out.push(path);
        }
    }
}

trait Pipe: Sized {
    fn pipe<T>(self, f: impl FnOnce(Self) -> T) -> T {
        f(self)
    }
}

impl<T> Pipe for T {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_opencode_provider_model_lines() {
        let output = "anthropic/claude-sonnet-4-5\nopenai/gpt-5.1\ngoogle/gemini-2.5-pro\nnvidia/stepfun-ai/step-3.5-flash";
        assert_eq!(
            parse_provider_model_tokens(output),
            vec![
                "anthropic/claude-sonnet-4-5",
                "openai/gpt-5.1",
                "google/gemini-2.5-pro",
                "nvidia/stepfun-ai/step-3.5-flash"
            ]
        );
    }

    #[test]
    fn parses_opencode_ansi_table_and_dedupes() {
        let output = "\u{1b}[32m| anthropic/claude-sonnet-4-5 | Claude |\u{1b}[0m\n- anthropic/claude-sonnet-4-5\n* openai/gpt-5.1\n24/7\ndocs/readme.md";
        assert_eq!(
            parse_provider_model_tokens(output),
            vec!["anthropic/claude-sonnet-4-5", "openai/gpt-5.1"]
        );
    }

    #[test]
    fn parses_codex_toml_model_fields() {
        let toml = r#"
model = "gpt-5.1-codex"
[profiles.fast]
model = "o4-mini"
"#;
        assert_eq!(
            parse_toml_model_fields(toml),
            vec!["gpt-5.1-codex", "o4-mini"]
        );
    }

    #[test]
    fn parses_codex_json_recursively() {
        let json = r#"{"models":[{"id":"gpt-5.1"},{"model":"openai/o4-mini"}],"nested":{"default_model":"codex-max"}}"#;
        assert_eq!(
            parse_json_model_strings(json, "codex"),
            vec!["gpt-5.1", "openai/o4-mini"]
        );
    }

    #[test]
    fn parses_gemini_ids_from_log_text() {
        let text = r#"{"history":["using gemini-2.5-pro", "fallback gemini-2.0-flash", "open gemini-cli and gemini-ignore.md", "gemini-3-flash-is-now-available-in-gemini-cli", "gemini-3.md"]}"#;
        assert_eq!(
            parse_gemini_model_tokens(text),
            vec!["gemini-2.5-pro", "gemini-2.0-flash"]
        );
    }

    #[test]
    fn parses_claude_available_models() {
        let json = r#"{"availableModels":["claude-sonnet-4-5","claude-opus-4-1","claude-code-setup","claude_pro","CLAUDE.md"],"model":"claude-haiku-4-5","projects":{"C:/repo":{".lastModelUsage":{"claude-haiku-4-5-20251001":{"inputTokens":1},"claude-opus-4-7":{"inputTokens":2}}}}}"#;
        assert_eq!(
            parse_claude_settings_models(json),
            vec![
                "claude-sonnet-4-5",
                "claude-opus-4-1",
                "claude-haiku-4-5",
                "claude-opus-4-7"
            ]
        );
    }

    #[test]
    fn parses_opencode_config_models() {
        let json = r#"{"model":"anthropic/claude-sonnet-4-5","small_model":"openai/gpt-5.1","provider":{"opencode":{"models":{"qwen3.6-plus-free":{},"disabled-model":{"disabled":true}}},"docs":{"models":{"readme.md":{},"24/7":{}}}}}"#;
        assert_eq!(
            parse_opencode_config_models(json),
            vec![
                "anthropic/claude-sonnet-4-5",
                "openai/gpt-5.1",
                "opencode/qwen3.6-plus-free"
            ]
        );
    }
}
