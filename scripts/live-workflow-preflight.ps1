param(
  [string]$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path,
  [int[]]$Ports = @(1700, 1701, 3741),
  [int]$GeminiTimeoutSeconds = 60,
  [switch]$SkipGeminiAuthCheck,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

function Normalize-PathText {
  param([string]$Value)
  if (-not $Value) { return '' }
  return $Value.Replace('/', '\').TrimEnd('\').ToLowerInvariant()
}

function Get-ProcessByIdSafe {
  param([int]$ProcessId)
  try {
    return Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop
  } catch {
    return $null
  }
}

function Stop-KnownProcess {
  param(
    [Parameter(Mandatory = $true)]$Process,
    [Parameter(Mandatory = $true)][string]$Reason
  )

  $pidValue = [int]$Process.ProcessId
  $name = if ($Process.Name) { $Process.Name } else { '<unknown>' }
  if ($DryRun) {
    Write-Host "would-stop pid=$pidValue name=$name reason=$Reason"
    return
  }

  Stop-Process -Id $pidValue -Force -ErrorAction Stop
  Write-Host "stopped pid=$pidValue name=$name reason=$Reason"
}

function Fail-GeminiPreflight {
  param(
    [Parameter(Mandatory = $true)][string]$Message,
    [string]$Output = ''
  )

  $details = @(
    "Gemini CLI preflight failed: $Message",
    'Run this check manually:',
    '  gemini -p "Return TD_OK only" --output-format json --approval-mode yolo',
    'For headless live workflows, authenticate Gemini with cached login credentials or environment-based auth:',
    '  - Gemini API: set GEMINI_API_KEY.',
    '  - Vertex API key: set GOOGLE_GENAI_USE_VERTEXAI=true, GOOGLE_API_KEY, GOOGLE_CLOUD_PROJECT, and GOOGLE_CLOUD_LOCATION.',
    '  - Vertex ADC/service account: set GOOGLE_GENAI_USE_VERTEXAI=true, GOOGLE_APPLICATION_CREDENTIALS, GOOGLE_CLOUD_PROJECT, and GOOGLE_CLOUD_LOCATION.',
    'Use -SkipGeminiAuthCheck only for live suites that do not launch Gemini.'
  )

  if ($Output) {
    $details += 'Gemini output:'
    $details += $Output.Trim()
  }

  Write-Error ($details -join [Environment]::NewLine)
  exit 3
}

function Test-GeminiAuthPreflight {
  param([Parameter(Mandatory = $true)][string]$WorkingDirectory)

  if ($SkipGeminiAuthCheck) {
    Write-Host 'gemini auth preflight skipped'
    return
  }

  if ($DryRun) {
    Write-Host 'would-run gemini auth preflight: gemini -p "Return TD_OK only" --output-format json --approval-mode yolo'
    return
  }

  $geminiCommand = Get-Command gemini -ErrorAction SilentlyContinue
  if (-not $geminiCommand) {
    Fail-GeminiPreflight -Message 'gemini executable was not found on PATH.'
  }

  # Gemini CLI docs define headless prompts with -p/--prompt, JSON output with
  # --output-format json, and yolo approval through --approval-mode yolo.
  Write-Host 'checking Gemini auth: gemini -p "Return TD_OK only" --output-format json --approval-mode yolo'

  $stdoutFile = New-TemporaryFile
  $stderrFile = New-TemporaryFile
  try {
    $process = Start-Process `
      -FilePath 'cmd.exe' `
      -ArgumentList '/d /s /c "gemini -p ""Return TD_OK only"" --output-format json --approval-mode yolo"' `
      -WorkingDirectory $WorkingDirectory `
      -WindowStyle Hidden `
      -RedirectStandardOutput $stdoutFile.FullName `
      -RedirectStandardError $stderrFile.FullName `
      -PassThru

    if (-not $process.WaitForExit($GeminiTimeoutSeconds * 1000)) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      Fail-GeminiPreflight -Message "gemini did not complete within $GeminiTimeoutSeconds seconds."
    }

    $stdout = Get-Content -Raw -LiteralPath $stdoutFile.FullName -ErrorAction SilentlyContinue
    $stderr = Get-Content -Raw -LiteralPath $stderrFile.FullName -ErrorAction SilentlyContinue
    $combinedOutput = (($stdout, $stderr) -join [Environment]::NewLine).Trim()

    if ($process.ExitCode -ne 0) {
      Fail-GeminiPreflight -Message "gemini exited with code $($process.ExitCode)." -Output $combinedOutput
    }

    try {
      $json = $stdout | ConvertFrom-Json -ErrorAction Stop
    } catch {
      Fail-GeminiPreflight -Message 'gemini did not return valid JSON output.' -Output $combinedOutput
    }

    if (-not ([string]$json.response -match 'TD_OK')) {
      Fail-GeminiPreflight -Message 'gemini JSON response did not contain TD_OK.' -Output $combinedOutput
    }

    Write-Host 'gemini auth preflight ok'
  } finally {
    Remove-Item -LiteralPath $stdoutFile.FullName, $stderrFile.FullName -Force -ErrorAction SilentlyContinue
  }
}

$repoPath = (Resolve-Path -LiteralPath $RepoRoot).Path
$repoNorm = Normalize-PathText $repoPath
$debugExe = Join-Path $repoPath 'src-tauri\target\debug\comet-ai.exe'
$debugExeNorm = Normalize-PathText $debugExe
$unknownOwners = @()

Write-Host "live-workflow-preflight repo=$repoPath"

Test-GeminiAuthPreflight -WorkingDirectory $repoPath

Get-CimInstance Win32_Process -Filter "Name = 'comet-ai.exe'" -ErrorAction SilentlyContinue |
  Where-Object { (Normalize-PathText $_.ExecutablePath) -eq $debugExeNorm } |
  ForEach-Object {
    Stop-KnownProcess -Process $_ -Reason 'repo debug Tauri binary may lock src-tauri\target\debug\comet-ai.exe'
  }

foreach ($port in $Ports) {
  $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
  foreach ($listener in $listeners) {
    $owner = Get-ProcessByIdSafe -ProcessId ([int]$listener.OwningProcess)
    if (-not $owner) { continue }

    $cmdNorm = Normalize-PathText $owner.CommandLine
    $exeNorm = Normalize-PathText $owner.ExecutablePath
    $isRepoTauri = $exeNorm -eq $debugExeNorm
    $isRepoMcp = ($cmdNorm.Contains($repoNorm) -and $cmdNorm.Contains('mcp-server') -and $cmdNorm.Contains('server.mjs'))
    $isRepoDevServer = ($cmdNorm.Contains($repoNorm) -and ($cmdNorm.Contains('vite') -or $cmdNorm.Contains('@tauri-apps') -or $cmdNorm.Contains('tauri.js')))

    if ($isRepoTauri -or $isRepoMcp -or $isRepoDevServer) {
      Stop-KnownProcess -Process $owner -Reason "repo-owned listener on port $port"
      continue
    }

    $unknownOwners += [pscustomobject]@{
      Port = $port
      ProcessId = $owner.ProcessId
      Name = $owner.Name
      CommandLine = $owner.CommandLine
    }
  }
}

if ($unknownOwners.Count -gt 0) {
  Write-Warning 'Unknown listener(s) were left running. Stop them manually or change the harness ports.'
  $unknownOwners | Format-Table -AutoSize | Out-String | Write-Warning
  exit 2
}

Write-Host 'live-workflow-preflight complete'
