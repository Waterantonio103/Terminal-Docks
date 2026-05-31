param(
  [int]$TimeoutSeconds = 120,
  [string]$RepoRootPath,
  [switch]$KeepRunning
)

$ErrorActionPreference = "Stop"

function Stop-ProcessTree {
  param([int]$RootPid)

  $children = Get-CimInstance Win32_Process |
    Where-Object { $_.ParentProcessId -eq $RootPid }

  foreach ($child in $children) {
    Stop-ProcessTree -RootPid ([int]$child.ProcessId)
  }

  $process = Get-Process -Id $RootPid -ErrorAction SilentlyContinue
  if ($process) {
    Stop-Process -Id $RootPid -Force -ErrorAction SilentlyContinue
  }
}

function Test-PortOpen {
  param(
    [string]$HostName,
    [int]$Port
  )

  $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($listener) {
    return $true
  }

  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $connect = $client.BeginConnect($HostName, $Port, $null, $null)
    if (-not $connect.AsyncWaitHandle.WaitOne(100)) {
      return $false
    }
    $client.EndConnect($connect)
    return $true
  }
  catch {
    return $false
  }
  finally {
    $client.Close()
  }
}

$repoRoot = if ($RepoRootPath) {
  Resolve-Path $RepoRootPath
} else {
  Resolve-Path (Join-Path $PSScriptRoot "..")
}
$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npmCommand) {
  $npmCommand = Get-Command npm -ErrorAction Stop
}
$npm = $npmCommand.Source

$startInfo = New-Object System.Diagnostics.ProcessStartInfo
$startInfo.FileName = $npm
$startInfo.Arguments = "run tauri -- dev"
$startInfo.WorkingDirectory = $repoRoot.Path
$startInfo.UseShellExecute = $false
$startInfo.RedirectStandardOutput = $false
$startInfo.RedirectStandardError = $false
$startInfo.CreateNoWindow = $true

$process = New-Object System.Diagnostics.Process
$process.StartInfo = $startInfo
$process.EnableRaisingEvents = $true

$watch = [System.Diagnostics.Stopwatch]::StartNew()
$events = [ordered]@{}

[void]$process.Start()

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$windowProcess = $null

try {
  while ((Get-Date) -lt $deadline) {
    if (
      -not $events.Contains("viteReady") -and
      (
        (Test-PortOpen -HostName "localhost" -Port 1420) -or
        (Test-PortOpen -HostName "127.0.0.1" -Port 1420)
      )
    ) {
      $events.viteReady = [Math]::Round($watch.Elapsed.TotalMilliseconds)
    }

    if (-not $events.Contains("appProcessStarted")) {
      $appProcess = Get-Process -ErrorAction SilentlyContinue |
        Where-Object {
          $_.Id -ne $PID -and
          $_.Id -ne $process.Id -and
          ($_.ProcessName -eq "comet-ai" -or $_.Path -like "*\src-tauri\target\debug\comet-ai.exe")
        } |
        Select-Object -First 1

      if ($appProcess) {
        $events.appProcessStarted = [Math]::Round($watch.Elapsed.TotalMilliseconds)
      }
    }

    if (-not $events.Contains("windowVisible")) {
      $candidates = Get-Process -ErrorAction SilentlyContinue |
        Where-Object {
          $_.Id -ne $PID -and
          $_.Id -ne $process.Id -and
          $_.MainWindowHandle -ne 0 -and
          ($_.ProcessName -eq "comet-ai" -or $_.Path -like "*\src-tauri\target\debug\comet-ai.exe")
        }

      $windowProcess = $candidates | Select-Object -First 1
      if ($windowProcess) {
        $events.windowVisible = [Math]::Round($watch.Elapsed.TotalMilliseconds)
        if (-not $KeepRunning) {
          break
        }
      }
    }

    if ($process.HasExited) {
      break
    }

    Start-Sleep -Milliseconds 100
  }
}
finally {
  if (-not $KeepRunning) {
    if ($windowProcess) {
      Stop-Process -Id $windowProcess.Id -Force -ErrorAction SilentlyContinue
    }
    Stop-ProcessTree -RootPid $process.Id
  }
}

$watch.Stop()

$result = [ordered]@{
  totalMs = [Math]::Round($watch.Elapsed.TotalMilliseconds)
  viteReadyMs = $events.viteReady
  appProcessStartedMs = $events.appProcessStarted
  windowVisibleMs = $events.windowVisible
  timedOut = -not $events.Contains("windowVisible")
  keptRunning = [bool]$KeepRunning
}

$result | ConvertTo-Json
