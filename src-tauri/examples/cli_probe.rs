use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use std::{
    env,
    io::{Read, Write},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Cli {
    Echo,
    Claude,
    Gemini,
    Codex,
    OpenCode,
}

impl Cli {
    fn id(self) -> &'static str {
        match self {
            Cli::Claude => "claude",
            Cli::Echo => "echo",
            Cli::Gemini => "gemini",
            Cli::Codex => "codex",
            Cli::OpenCode => "opencode",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value.to_ascii_lowercase().as_str() {
            "claude" => Some(Self::Claude),
            "echo" => Some(Self::Echo),
            "gemini" => Some(Self::Gemini),
            "codex" => Some(Self::Codex),
            "opencode" => Some(Self::OpenCode),
            _ => None,
        }
    }

    fn launch_command(self, prompt: &str) -> String {
        match self {
            Cli::Codex => format!("codex --no-alt-screen {}", quote_cmd_arg(prompt)),
            Cli::Echo => "echo TD_ECHO_PROBE".to_string(),
            _ => self.id().to_string(),
        }
    }

    fn injection(self, prompt: &str, mode: &str) -> Option<Vec<String>> {
        let flat = flatten_prompt(prompt);
        if self == Cli::Codex || self == Cli::Echo {
            return None;
        }
        match mode {
            "plain" => return Some(vec![flat, "\r".to_string()]),
            "clear_plain" => return Some(vec!["\x15".to_string(), flat, "\r".to_string()]),
            "bracketed" => {
                return Some(vec![format!("\x1b[200~{}\x1b[201~", flat), "\r".to_string()]);
            }
            "clear_bracketed" => {
                return Some(vec![
                    "\x15".to_string(),
                    format!("\x1b[200~{}\x1b[201~", flat),
                    "\r".to_string(),
                ]);
            }
            "adapter" => {}
            _ => {}
        }
        match self {
            Cli::Gemini => Some(vec![
                "\x15".to_string(),
                format!("\x1b[200~{}\x1b[201~", flat),
                "\r".to_string(),
            ]),
            Cli::Claude => Some(vec!["\x15".to_string(), flat, "\r".to_string()]),
            Cli::OpenCode => Some(vec![format!("\x15\x1b[200~{}\x1b[201~", flat), "\r".to_string()]),
            Cli::Codex | Cli::Echo => None,
        }
    }

    fn ready(self, output: &str) -> bool {
        let lower = strip_ansi(output).to_ascii_lowercase();
        match self {
            Cli::Claude => lower.contains("claude"),
            Cli::Echo => lower.contains("td_echo_probe"),
            Cli::Gemini => {
                let has_ui = lower.contains("gemini cli")
                    || lower.contains("to resume this session")
                    || lower.contains("loaded cached credentials")
                    || lower.contains("tips for getting started")
                    || lower.contains("╭")
                    || lower.contains("✦")
                    || lower.contains("✧");
                has_ui
                    && lower.contains("gemini")
                    && (lower.contains("type")
                        || lower.contains("prompt")
                        || lower.contains("input")
                        || lower.contains(">"))
            }
            Cli::Codex => lower.contains("codex") || lower.contains("tokens"),
            Cli::OpenCode => lower.contains("opencode") || lower.contains("open code"),
        }
    }

    fn default_settle_delay(self) -> Duration {
        match self {
            Cli::Codex => Duration::from_millis(1200),
            Cli::Claude => Duration::from_millis(1000),
            Cli::Gemini => Duration::from_millis(3000),
            Cli::OpenCode => Duration::from_millis(3000),
            Cli::Echo => Duration::ZERO,
        }
    }

    fn prompt_was_visible(self, output: &str, token: &str) -> bool {
        let normalized = strip_ansi(output);
        normalized.contains(token)
            || match self {
                Cli::Codex => {
                    normalized.to_ascii_lowercase().contains("thinking")
                        || normalized.to_ascii_lowercase().contains("tokens")
                }
                Cli::Echo => normalized.contains("TD_ECHO_PROBE"),
                _ => false,
            }
    }
}

fn main() -> Result<(), String> {
    let mut args = env::args().skip(1);
    let mut clis = Vec::new();
    let mut timeout = Duration::from_secs(18);
    let mut inject_mode = "adapter".to_string();
    let mut post_ready_delay = Duration::from_millis(0);

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--cli" => {
                let value = args.next().ok_or("--cli requires a value")?;
                if value == "all" {
                    clis.extend([Cli::Claude, Cli::Gemini, Cli::Codex, Cli::OpenCode]);
                } else {
                    clis.push(Cli::parse(&value).ok_or_else(|| format!("unknown cli: {value}"))?);
                }
            }
            "--timeout-secs" => {
                let value = args.next().ok_or("--timeout-secs requires a value")?;
                let secs = value
                    .parse::<u64>()
                    .map_err(|_| format!("invalid timeout seconds: {value}"))?;
                timeout = Duration::from_secs(secs);
            }
            "--inject-mode" => {
                inject_mode = args.next().ok_or("--inject-mode requires a value")?;
            }
            "--post-ready-ms" => {
                let value = args.next().ok_or("--post-ready-ms requires a value")?;
                let millis = value
                    .parse::<u64>()
                    .map_err(|_| format!("invalid post-ready millis: {value}"))?;
                post_ready_delay = Duration::from_millis(millis);
            }
            other => return Err(format!("unknown argument: {other}")),
        }
    }

    if clis.is_empty() {
        clis.extend([Cli::Claude, Cli::Gemini, Cli::Codex, Cli::OpenCode]);
    }

    let mut failed = false;
    for cli in clis {
        let result = probe_cli(
            cli,
            timeout,
            &inject_mode,
            if post_ready_delay == Duration::ZERO {
                cli.default_settle_delay()
            } else {
                post_ready_delay
            },
        );
        println!("{}", result.summary_line());
        if !result.ok {
            failed = true;
        }
    }

    if failed {
        Err("one or more CLI probes failed".to_string())
    } else {
        Ok(())
    }
}

struct ProbeResult {
    cli: Cli,
    ok: bool,
    ready: bool,
    prompt_visible: bool,
    launched: bool,
    cancelled: bool,
    duration_ms: u128,
    evidence: String,
    output_bytes: usize,
}

impl ProbeResult {
    fn summary_line(&self) -> String {
        format!(
            "CLI_PROBE cli={} ok={} launched={} ready={} prompt_injected={} cancelled={} duration_ms={} output_bytes={} evidence={}",
            self.cli.id(),
            self.ok,
            self.launched,
            self.ready,
            self.prompt_visible,
            self.cancelled,
            self.duration_ms,
            self.output_bytes,
            self.evidence.replace('\n', " ")
        )
    }
}

fn probe_cli(cli: Cli, timeout: Duration, inject_mode: &str, post_ready_delay: Duration) -> ProbeResult {
    let started = Instant::now();
    let token = format!("TD_PROMPT_PROBE_{}_{}", cli.id(), epoch_millis());
    let prompt = format!("{}. Do not run tools. Reply with this token only.", token);

    let pty_system = NativePtySystem::default();
    let pair = match pty_system.openpty(PtySize {
        rows: 32,
        cols: 140,
        pixel_width: 0,
        pixel_height: 0,
    }) {
        Ok(pair) => pair,
        Err(err) => {
            return ProbeResult {
                cli,
                ok: false,
                ready: false,
                prompt_visible: false,
                launched: false,
                cancelled: false,
                duration_ms: started.elapsed().as_millis(),
                evidence: format!("openpty failed: {err}"),
                output_bytes: 0,
            }
        }
    };

    let shell = env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string());
    let mut cmd = if cli == Cli::Echo {
        let mut direct = CommandBuilder::new("powershell.exe");
        direct.args(["-NoLogo", "-NoProfile", "-Command", "Write-Host TD_ECHO_PROBE"]);
        direct
    } else {
        CommandBuilder::new(shell)
    };
    cmd.env("TERM", "xterm-256color");
    cmd.env("TD_KIND", cli.id());
    cmd.env("TD_SESSION_ID", format!("probe-{}", cli.id()));
    cmd.cwd(env::current_dir().unwrap_or_else(|_| ".".into()));

    let mut child = match pair.slave.spawn_command(cmd) {
        Ok(child) => child,
        Err(err) => {
            return ProbeResult {
                cli,
                ok: false,
                ready: false,
                prompt_visible: false,
                launched: false,
                cancelled: false,
                duration_ms: started.elapsed().as_millis(),
                evidence: format!("shell spawn failed: {err}"),
                output_bytes: 0,
            }
        }
    };

    let mut writer = match pair.master.take_writer() {
        Ok(writer) => writer,
        Err(err) => {
            let _ = child.kill();
            return ProbeResult {
                cli,
                ok: false,
                ready: false,
                prompt_visible: false,
                launched: false,
                cancelled: false,
                duration_ms: started.elapsed().as_millis(),
                evidence: format!("take_writer failed: {err}"),
                output_bytes: 0,
            };
        }
    };

    let mut reader = match pair.master.try_clone_reader() {
        Ok(reader) => reader,
        Err(err) => {
            let _ = child.kill();
            return ProbeResult {
                cli,
                ok: false,
                ready: false,
                prompt_visible: false,
                launched: false,
                cancelled: false,
                duration_ms: started.elapsed().as_millis(),
                evidence: format!("clone_reader failed: {err}"),
                output_bytes: 0,
            };
        }
    };

    let output = Arc::new(Mutex::new(String::new()));
    let output_for_thread = Arc::clone(&output);
    thread::spawn(move || {
        let mut buf = [0_u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buf[..n]);
                    if let Ok(mut out) = output_for_thread.lock() {
                        out.push_str(&chunk);
                        if out.len() > 48_000 {
                            let char_count = out.chars().count();
                            *out = out
                                .chars()
                                .skip(char_count.saturating_sub(24_000))
                                .collect::<String>();
                        }
                    }
                }
                Err(_) => break,
            }
        }
    });

    thread::sleep(Duration::from_millis(700));
    answer_terminal_query_if_needed(&output, &mut writer);
    let launch_command = cli.launch_command(&prompt);
    let launched = if cli == Cli::Echo {
        true
    } else {
        writer
            .write_all(format!("{launch_command}\r").as_bytes())
            .and_then(|_| writer.flush())
            .is_ok()
    };

    let ready_deadline = Instant::now() + timeout.min(Duration::from_secs(20));
    let mut ready = cli == Cli::Codex;
    while !ready && Instant::now() < ready_deadline {
        answer_terminal_query_if_needed(&output, &mut writer);
        let snapshot = output.lock().map(|out| out.clone()).unwrap_or_default();
        ready = cli.ready(&snapshot);
        thread::sleep(Duration::from_millis(200));
    }

    let mut prompt_visible = false;
    if post_ready_delay > Duration::ZERO {
        thread::sleep(post_ready_delay);
    }

    if let Some(chunks) = cli.injection(&prompt, inject_mode) {
        if ready {
            for chunk in chunks {
                let _ = writer.write_all(chunk.as_bytes());
                let _ = writer.flush();
                thread::sleep(Duration::from_millis(180));
            }
        }
    }

    let inject_deadline = Instant::now() + Duration::from_secs(4);
    while Instant::now() < inject_deadline {
        answer_terminal_query_if_needed(&output, &mut writer);
        let snapshot = output.lock().map(|out| out.clone()).unwrap_or_default();
        if cli.prompt_was_visible(&snapshot, &token) {
            prompt_visible = true;
            break;
        }
        thread::sleep(Duration::from_millis(150));
    }

    let _ = writer.write_all(b"\x03");
    let _ = writer.flush();
    thread::sleep(Duration::from_millis(250));
    let _ = writer.write_all(b"\x03");
    let _ = writer.flush();
    thread::sleep(Duration::from_millis(300));
    let cancelled = child.kill().is_ok();
    let _ = child.wait();

    let snapshot = output.lock().map(|out| out.clone()).unwrap_or_default();
    let output_bytes = snapshot.len();
    let evidence = {
        let text = tail(&strip_ansi(&snapshot), 360);
        if text.is_empty() {
            format!("hex={}", hex_preview(snapshot.as_bytes()))
        } else {
            text
        }
    };
    let ok = launched && ready && prompt_visible && cancelled;

    ProbeResult {
        cli,
        ok,
        ready,
        prompt_visible,
        launched,
        cancelled,
        duration_ms: started.elapsed().as_millis(),
        evidence,
        output_bytes,
    }
}

fn flatten_prompt(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn quote_cmd_arg(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\\\""))
}

fn epoch_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn strip_ansi(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                let _ = chars.next();
                for next in chars.by_ref() {
                    if ('@'..='~').contains(&next) {
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

fn tail(value: &str, limit: usize) -> String {
    let chars: Vec<char> = value.chars().collect();
    let start = chars.len().saturating_sub(limit);
    chars[start..].iter().collect::<String>().split_whitespace().collect::<Vec<_>>().join(" ")
}

fn hex_preview(bytes: &[u8]) -> String {
    bytes
        .iter()
        .take(64)
        .map(|byte| format!("{byte:02x}"))
        .collect::<Vec<_>>()
        .join("")
}

fn answer_terminal_query_if_needed(
    output: &Arc<Mutex<String>>,
    writer: &mut Box<dyn Write + Send>,
) {
    let needs_answer = output
        .lock()
        .map(|out| out.contains("\x1b[6n"))
        .unwrap_or(false);
    if needs_answer {
        let _ = writer.write_all(b"\x1b[1;1R");
        let _ = writer.flush();
    }
}
