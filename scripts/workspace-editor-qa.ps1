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

function Stop-ProcessTree {
  param([int]$ProcessId)

  $children = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ParentProcessId -eq $ProcessId }
  foreach ($child in $children) {
    Stop-ProcessTree -ProcessId $child.ProcessId
  }
  Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

function Write-LogTail {
  param(
    [string]$Path,
    [string]$Label
  )

  if (Test-Path -LiteralPath $Path) {
    Write-Output "--- $Label ---"
    Get-Content -Tail 80 -LiteralPath $Path
  }
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

$logDir = Split-Path -Parent $ReportPath
$stdoutPath = Join-Path $logDir 'workspace-qa-dev.out.log'
$stderrPath = Join-Path $logDir 'workspace-qa-dev.err.log'
Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue

$envNames = @(
  'VITE_WORKSPACE_QA_DEBUG',
  'VITE_WORKSPACE_QA_REPO_ROOT',
  'VITE_WORKSPACE_QA_DIR',
  'VITE_WORKSPACE_QA_REPORT',
  'VITE_WORKSPACE_QA_CLOSE'
)
$oldEnv = @{}
foreach ($name in $envNames) {
  $oldEnv[$name] = (Get-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue).Value
}

$env:VITE_WORKSPACE_QA_DEBUG = '1'
$env:VITE_WORKSPACE_QA_REPO_ROOT = $RepoRoot
$env:VITE_WORKSPACE_QA_DIR = $QaDir
$env:VITE_WORKSPACE_QA_REPORT = $ReportPath
$env:VITE_WORKSPACE_QA_CLOSE = '1'

$process = Start-Process -FilePath 'cmd.exe' `
  -ArgumentList @('/d', '/s', '/c', 'npm run tauri -- dev') `
  -WorkingDirectory $RepoRoot `
  -PassThru `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutPath `
  -RedirectStandardError $stderrPath
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
    Write-LogTail -Path $stdoutPath -Label 'workspace QA stdout'
    Write-LogTail -Path $stderrPath -Label 'workspace QA stderr'
    throw "Workspace QA report was not created at $ReportPath"
  }

  $raw = Get-Content -Raw -LiteralPath $ReportPath
  Write-Output $raw
  $report = $raw | ConvertFrom-Json
  if ($report.status -ne 'passed') {
    Write-LogTail -Path $stdoutPath -Label 'workspace QA stdout'
    Write-LogTail -Path $stderrPath -Label 'workspace QA stderr'
    throw "Workspace QA failed with status '$($report.status)'"
  }
} finally {
  if ($process -and -not $process.HasExited) {
    Stop-ProcessTree -ProcessId $process.Id
  }
  foreach ($name in $envNames) {
    if ($null -eq $oldEnv[$name]) {
      Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
    } else {
      Set-Item -LiteralPath "Env:$name" -Value $oldEnv[$name]
    }
  }
}
