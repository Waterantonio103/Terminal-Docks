param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  [string]$QaDir = (Join-Path $env:USERPROFILE 'comet-editor-qa'),
  [string]$ReportPath = '',
  [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = 'Stop'

if (-not $ReportPath) {
  $ReportPath = Join-Path $RepoRoot '.tmp-tests\workspace-qa-report.json'
}

New-Item -ItemType Directory -Force -Path $QaDir | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ReportPath) | Out-Null

$tsx = Join-Path $QaDir 'comet-editor-large.tsx'
$json = Join-Path $QaDir 'comet-editor-config.json'
$md = Join-Path $QaDir 'comet-editor-notes.md'

$lines = for ($i = 0; $i -lt 2500; $i += 1) {
  "export const item$i = { label: 'item-$i', values: [1, 2, 3, 4] };"
}
Set-Content -LiteralPath $tsx -Value $lines -Encoding UTF8
Set-Content -LiteralPath $json -Value '{"qa":true,"items":[1,2,3,4]}' -Encoding UTF8
Set-Content -LiteralPath $md -Value "# Editor QA`n`n- Markdown mode`n- Search and line numbers" -Encoding UTF8
Remove-Item -LiteralPath $ReportPath -Force -ErrorAction SilentlyContinue

$command = @"
`$env:VITE_WORKSPACE_QA_DEBUG='1';
`$env:VITE_WORKSPACE_QA_REPO_ROOT='$RepoRoot';
`$env:VITE_WORKSPACE_QA_DIR='$QaDir';
`$env:VITE_WORKSPACE_QA_REPORT='$ReportPath';
`$env:VITE_WORKSPACE_QA_CLOSE='1';
npm run tauri -- dev
"@

$process = Start-Process -FilePath 'pwsh.exe' -ArgumentList @('-NoProfile', '-Command', $command) -WorkingDirectory $RepoRoot -PassThru -WindowStyle Hidden
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$report = $null

try {
  while ((Get-Date) -lt $deadline) {
    if (Test-Path -LiteralPath $ReportPath) {
      $report = Get-Content -Raw -LiteralPath $ReportPath | ConvertFrom-Json
      if ($report.status -eq 'passed' -or $report.status -eq 'failed') {
        break
      }
    }
    Start-Sleep -Milliseconds 500
  }

  if (-not (Test-Path -LiteralPath $ReportPath)) {
    throw "Workspace QA report was not created at $ReportPath"
  }

  $raw = Get-Content -Raw -LiteralPath $ReportPath
  Write-Output $raw
  $report = $raw | ConvertFrom-Json
  if ($report.status -ne 'passed') {
    throw "Workspace QA failed with status '$($report.status)'"
  }
} finally {
  if ($process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  }
}
