# Prompt 05 Mixed-CLI Quality Report - 2026-05-08

## Scope

Prompt 05 was run through the live Tauri app harness with mixed interactive PTY CLIs (`codex`, `claude`, `gemini`, `opencode`) and screenwatch enabled. The full run was followed by targeted reruns after fixing two harness/runtime issues found during analysis.

## Evidence

- Full run report: `.tmp-tests/prompt05-full-mixed-cli-20260508-003723.json`
- Full run logs: `.tmp-tests/prompt05-full-mixed-cli-20260508-003723.out.log`, `.tmp-tests/prompt05-full-mixed-cli-20260508-003723.err.log`
- Full run screenwatch: `.tmp-tests/ui-screenwatch-prompt05-full-20260508-003723`
- Affected rerun report: `.tmp-tests/prompt05-affected-rerun-20260508-020500.json`
- Final Workflow 10 validation: `.tmp-tests/prompt05-workflow10-claude-ack-20260508-024000.json`
- Runtime screenshot: `.tmp-tests/debug-screenshots/prompt05-wf10-screenshot-20260508-020000-window.png`

## Results

The initial full 10-workflow pass completed at the process level with `7 passed / 3 rate_limited`. Investigation showed all three `rate_limited` results were false positives from the harness detector, not provider throttling:

- Workflow 05 matched deliverable text: `rate limiting, CORS`.
- Workflow 09 matched `429` inside a Claude tool-result path/UUID.
- Workflow 10 matched deliverable/API copy: `rate limits, security`.

After tightening that detector:

- Workflow 05 rerun passed.
- Workflow 09 rerun passed.
- Workflow 10 rerun initially reached the Gemini tester but failed the 60s ACK window.
- After adding longer per-CLI ACK windows for Gemini and Claude, Workflow 10 passed.

Composite validated result after fixes: `10 / 10` Prompt 05 workflows passed.

## UI And PTY Findings

- Full run screenwatch captured 782 snapshots across 10 missions with `0` screenwatch issues.
- The largest full-run PTY view had 8 terminal cards, not the previous 48-node stale accumulation.
- The explicit app-window screenshot showed current-mission runtime cards only, validating the Runtime view pruning/layout fix.
- The final Workflow 10 validation screenwatch captured 86 snapshots with `0` screenwatch issues and 6 current runtime nodes.

## Comparison To Previous Full Run

Previous full run (`.tmp-tests/prompt05-full-mixed-cli-20260507-224158.json`):

- `7 passed / 2 failed / 1 rate_limited`
- Failed Workflow 04: Claude readiness gate misread a visible prompt as `processing`.
- Failed Workflow 06: Gemini planner missed the 60s task ACK.
- Passed Workflows 02 and 05 still carried `post_ack_no_mcp_completion` failure categories.
- Final Runtime view accumulated many stale completed PTY cards.

Current validated state:

- Claude visible-prompt readiness failure did not recur.
- Gemini/Claude slow ACK behavior is mitigated with per-CLI ACK windows.
- `post_ack_no_mcp_completion` no longer appears on completed workflows.
- Runtime view no longer retains unrelated prior-workflow PTY cards.
- False provider-rate-limit detection in the live harness is fixed.

## Verification

- `npm run preflight:live-workflow` passed before live runs.
- `npm run build` passed after the final code changes.
- `npm run test:headless` passed.
- `node ./tests/debugMcpObservability.test.mjs` passed.

## Remaining Risk

The 10/10 result is composite: the first full run plus targeted reruns after fixes, not a single uninterrupted full-suite rerun after the final patch. A final full Prompt 05 rerun would be the cleanest acceptance proof, but the targeted reruns covered every workflow that failed or was misclassified in the full run.
