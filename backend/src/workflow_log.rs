use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;



use crate::db::DbState;
use crate::pty::{PermissionAuditEntry, PtyState};

#[derive(Serialize, Deserialize, Debug)]
pub struct AgentExport {
    pub title: String,
    pub role_name: String,
    pub status: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ResultExport {
    pub agent_id: String,
    pub content: String,
    pub result_type: String,
    pub timestamp: u64,
}

fn format_millis_utc(ms: u64) -> String {
    let secs = ms / 1000;
    let h = (secs % 86400) / 3600;
    let m = (secs % 3600) / 60;
    let s = secs % 60;
    format!("{:02}:{:02}:{:02} UTC", h, m, s)
}

fn build_markdown(
    task_description: &str,
    generated_at: &str,
    agents: &[AgentExport],
    pipeline_names: &[String],
    results: &[ResultExport],
    events: &[(String, String, Option<String>, String)],
    tasks: &[(i64, String, Option<String>, String, Option<String>, Option<i64>)],
    permission_audit: &[PermissionAuditEntry],
) -> String {
    let mut md = String::with_capacity(8192);

    // ── Header ────────────────────────────────────────────────────────────────
    md.push_str("# Terminal Docks — Workflow Analysis Report\n\n");
    md.push_str(&format!("*Generated: {}*\n\n", generated_at));
    md.push_str("---\n\n");

    // ── How to use ────────────────────────────────────────────────────────────
    md.push_str("## HOW TO USE THIS FILE\n\n");
    md.push_str("This is a self-contained workflow log from a Terminal Docks multi-agent session.\n");
    md.push_str("Attach this file + your codebase to any AI (Claude Code, Claude.ai, ChatGPT, Gemini…).\n");
    md.push_str("No extra prompt needed — the analysis instructions are at the bottom of this file.\n\n");
    md.push_str("**Quick start:**\n");
    md.push_str("```\n");
    md.push_str("# Claude Code CLI\n");
    md.push_str("claude \"$(cat workflow_log_*.md)\" --add-dir /path/to/codebase\n\n");
    md.push_str("# Or just drag this file into Claude.ai / ChatGPT and add:\n");
    md.push_str("# \"Here is the codebase: [paste or attach]\"\n");
    md.push_str("```\n\n");
    md.push_str("---\n\n");

    // ── Workflow context ──────────────────────────────────────────────────────
    md.push_str("## WORKFLOW CONTEXT\n\n");
    md.push_str(&format!("**Task:** {}\n\n", task_description));
    md.push_str(&format!("**Exported:** {}\n\n", generated_at));

    if !agents.is_empty() {
        md.push_str("### Agent Roster\n\n");
        md.push_str("| Agent | Role | Final Status |\n");
        md.push_str("|-------|------|--------------|\n");
        for a in agents {
            md.push_str(&format!("| {} | {} | {} |\n", a.title, a.role_name, a.status));
        }
        md.push('\n');
    }

    if !pipeline_names.is_empty() {
        md.push_str("### Execution Pipeline\n\n");
        md.push_str(&pipeline_names.join(" → "));
        md.push_str("\n\n");
    }

    md.push_str("---\n\n");

    // ── Session timeline ──────────────────────────────────────────────────────
    if !events.is_empty() {
        md.push_str("## SESSION TIMELINE\n\n");
        for (sid, event_type, content, created_at) in events {
            let short_sid = if sid.len() >= 8 { &sid[..8] } else { sid.as_str() };
            let content_str = content.as_deref().unwrap_or("");
            md.push_str(&format!(
                "- `{}` **{}** (session `{}…`)",
                created_at, event_type, short_sid
            ));
            if !content_str.is_empty() {
                md.push_str(&format!(": {}", content_str));
            }
            md.push('\n');
        }
        md.push('\n');
        md.push_str("---\n\n");
    }

    // ── Delegated task tree ───────────────────────────────────────────────────
    if !tasks.is_empty() {
        md.push_str("## DELEGATED TASK TREE\n\n");
        let mut task_map: HashMap<i64, (&str, Option<&str>, &str, Option<&str>)> = HashMap::new();
        let mut children: HashMap<i64, Vec<i64>> = HashMap::new();
        let mut roots: Vec<i64> = Vec::new();
        for (id, title, desc, status, agent_id, parent_id) in tasks {
            task_map.insert(
                *id,
                (title.as_str(), desc.as_deref(), status.as_str(), agent_id.as_deref()),
            );
            match parent_id {
                Some(pid) => children.entry(*pid).or_default().push(*id),
                None => roots.push(*id),
            }
        }
        fn render(
            id: i64,
            depth: usize,
            task_map: &HashMap<i64, (&str, Option<&str>, &str, Option<&str>)>,
            children: &HashMap<i64, Vec<i64>>,
            md: &mut String,
        ) {
            if let Some((title, desc, status, agent_id)) = task_map.get(&id) {
                let indent = "  ".repeat(depth);
                let agent_str = agent_id.map(|a| format!(" `{}`", a)).unwrap_or_default();
                md.push_str(&format!("{}- **{}** — _{}_{}",
                    indent, title, status, agent_str));
                if let Some(d) = desc {
                    if !d.is_empty() {
                        md.push_str(&format!("\n{}  > {}", indent, d));
                    }
                }
                md.push('\n');
                if let Some(kids) = children.get(&id) {
                    for kid in kids {
                        render(*kid, depth + 1, task_map, children, md);
                    }
                }
            }
        }
        for root_id in &roots {
            render(*root_id, 0, &task_map, &children, &mut md);
        }
        md.push('\n');
        md.push_str("---\n\n");
    }

    if !permission_audit.is_empty() {
        md.push_str("## PERMISSION AUDIT TRAIL\n\n");
        md.push_str("| Time | Request | CLI | Type | State | Decision | Node | Excerpt |\n");
        md.push_str("|------|---------|-----|------|-------|----------|------|---------|\n");
        for entry in permission_audit {
            let request_short = if entry.request_id.len() > 12 {
                &entry.request_id[..12]
            } else {
                entry.request_id.as_str()
            };
            let node = entry.node_id.as_deref().unwrap_or("runtime-only");
            let decision = entry.decision.as_deref().unwrap_or("");
            let excerpt = entry
                .prompt_excerpt
                .replace('|', "\\|")
                .replace('\n', " ");
            md.push_str(&format!(
                "| {} | `{}` | {} | {} | {:?} | {} | {} | {} |\n",
                format_millis_utc(entry.timestamp),
                request_short,
                entry.cli,
                entry.permission_type,
                entry.state,
                decision,
                node,
                excerpt
            ));
        }
        md.push('\n');
        md.push_str("---\n\n");
    }

    // ── Published outputs ─────────────────────────────────────────────────────
    let markdown_results: Vec<&ResultExport> = results
        .iter()
        .filter(|r| r.result_type == "markdown")
        .collect();
    if !markdown_results.is_empty() {
        md.push_str("## AGENT PUBLISHED OUTPUTS\n\n");
        for r in &markdown_results {
            let ts = format_millis_utc(r.timestamp);
            md.push_str(&format!("### {} — {}\n\n", r.agent_id, ts));
            md.push_str(&r.content);
            md.push_str("\n\n");
        }
        md.push_str("---\n\n");
    }

    // ── Analysis request ──────────────────────────────────────────────────────
    md.push_str("## ANALYSIS REQUEST\n\n");
    md.push_str("You are an AI assistant reading this Terminal Docks workflow log.\n");
    md.push_str("The codebase produced by this workflow is at the path provided by the user.\n\n");
    md.push_str("Please deliver a structured report covering all of the following:\n\n");

    md.push_str("### 1. Workflow Effectiveness Rating (1–10)\n");
    md.push_str("Rate the multi-agent collaboration. Justify the score with specific evidence from the session timeline and task tree.\n\n");

    md.push_str("### 2. What Worked Well\n");
    md.push_str("Highlight effective patterns: delegation quality, pipeline efficiency, communication clarity, parallelism use.\n\n");

    md.push_str("### 3. Inefficiencies & Issues\n");
    md.push_str("Identify wasted steps, coordination failures, blocked agents, redundant work, or missed handoffs.\n\n");

    md.push_str("### 4. Specific Improvement Suggestions\n");
    md.push_str("Concrete changes: agent prompt adjustments, pipeline reordering, role additions/removals, task granularity tweaks.\n\n");

    md.push_str("### 5. Codebase vs. Task Alignment\n");
    md.push_str("Does the produced codebase satisfy the original task? List gaps, overreach, or quality concerns.\n\n");

    md.push_str("### 6. Comparison to Previous Runs (if available)\n");
    md.push_str("If other `workflow_log_*.md` files exist in the same directory, compare trends across runs and note regressions or improvements.\n");

    md
}

pub fn export_workflow_log(
    app: crate::AppState,
    task_description: String,
    generated_at: String,
    file_ts: String,
    agents: Vec<AgentExport>,
    pipeline_names: Vec<String>,
    results: Vec<ResultExport>,
    state: &DbState,
    pty_state: &PtyState,
) -> Result<String, String> {
    let events = {
        let db_lock = state.db.lock().map_err(|_| "DB lock failed")?;
        let conn = db_lock.as_ref().ok_or("DB not initialized")?;
        let mut stmt = conn
            .prepare(
                "SELECT session_id, event_type, content, \
                 datetime(created_at, 'localtime') \
                 FROM session_log ORDER BY id ASC LIMIT 1000",
            )
            .map_err(|e| e.to_string())?;
        let iter = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        let mut rows = Vec::new();
        for r in iter {
            if let Ok(v) = r { rows.push(v); }
        }
        rows
    };

    let tasks = {
        let db_lock = state.db.lock().map_err(|_| "DB lock failed")?;
        let conn = db_lock.as_ref().ok_or("DB not initialized")?;
        let mut stmt = conn
            .prepare(
                "SELECT id, title, description, status, agent_id, parent_id \
                 FROM tasks ORDER BY id ASC",
            )
            .map_err(|e| e.to_string())?;
        let iter = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<i64>>(5)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        let mut rows = Vec::new();
        for r in iter {
            if let Ok(v) = r { rows.push(v); }
        }
        rows
    };

    let md = build_markdown(
        &task_description,
        &generated_at,
        &agents,
        &pipeline_names,
        &results,
        &events,
        &tasks,
        &pty_state.permission_audit.lock().unwrap().clone(),
    );

    let slug: String = task_description
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == ' ')
        .take(40)
        .collect::<String>()
        .trim()
        .replace(' ', "_")
        .to_lowercase();

    let filename = format!("workflow_log_{}_{}.md", file_ts, slug);

    let file_path = std::env::current_dir().unwrap().join(".mcp").join(filename);

    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&file_path, md).map_err(|e| e.to_string())?;

    Ok(file_path.to_string_lossy().to_string())
}
