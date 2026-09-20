@echo off
setlocal EnableExtensions
if /I "%~1"=="ELEVATED" goto elevated

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -ArgumentList 'ELEVATED' -Verb RunAs"
if errorlevel 1 (
  echo Failed to request Administrator elevation.
  pause
  exit /b 1
)
exit /b 0

:elevated
set "JARVIS_SELF=%~f0"
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$raw=[IO.File]::ReadAllText($env:JARVIS_SELF); $marker=('###'+'POWERSHELL'+'###'); $i=$raw.LastIndexOf($marker,[StringComparison]::Ordinal); if($i -lt 0){throw 'Payload marker missing.'}; $code=$raw.Substring($i+$marker.Length).TrimStart([char]13,[char]10); & ([ScriptBlock]::Create($code))"
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (
  echo JARVIS LOCAL BOOTSTRAP V5 COMPLETED.
) else (
  echo JARVIS LOCAL BOOTSTRAP V5 DID NOT CLOSE CLEANLY. Exit=%RC%
)
echo.
echo Leave this window open to read the sanitized result.
pause
exit /b %RC%

###POWERSHELL###
#requires -Version 5.1
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ExpectedHost = 'DESKTOP-7CM41S6'
$ExpectedHead = 'a7862db6012a99c37bb214597e8e1f5a68d290f0'
$ExpectedFallbackBlob = '78586313f4afb3e36bd853608f79c678a31b6a9d'
$ExpectedTransportBlob = '01851d5e357ca4f25947c65818a58ebe11388769'
$ExpectedQueueBlob = '9f5aa680bb42a11ab944d11af17401ac46a05539'
$RecoveryRoot = 'C:\ProgramData\PixelNetwork\JarvisRecovery\triggercmd-a7862db6-v5'
$ReceiptPath = Join-Path $RecoveryRoot 'local-bootstrap-v5-receipt.json'
$RawBase = "https://raw.githubusercontent.com/pixenetwork/duy/$ExpectedHead/ops/triggercmd"

function Get-GitBlobSha([string]$Path) {
    [byte[]]$content = [IO.File]::ReadAllBytes($Path)
    [byte[]]$header = [Text.Encoding]::ASCII.GetBytes("blob $($content.Length)`0")
    [byte[]]$payload = New-Object byte[] ($header.Length + $content.Length)
    [Array]::Copy($header, 0, $payload, 0, $header.Length)
    [Array]::Copy($content, 0, $payload, $header.Length, $content.Length)
    $sha1 = [Security.Cryptography.SHA1]::Create()
    try {
        return (($sha1.ComputeHash($payload) | ForEach-Object { $_.ToString('x2') }) -join '')
    } finally {
        $sha1.Dispose()
    }
}

function Get-CommandScore($Commands) {
    $expected = @(
        'Calculator',
        'Notepad',
        'Reboot in 10 seconds',
        'Jarvis PowerShell',
        'Jarvis Hostname',
        'Jarvis Windows MCP',
        'Jarvis Queue',
        'Jarvis Install Recovery'
    )
    $score = 0
    foreach ($name in $expected) {
        if (@($Commands | Where-Object { [string]$_.trigger -eq $name }).Count -eq 1) { $score++ }
    }
    return $score
}

function Read-CommandFile([string]$Path) {
    try {
        $commands = @(Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -ErrorAction Stop)
        return [pscustomobject]@{
            Ok = $true
            Commands = $commands
            Score = Get-CommandScore $commands
            HasPowerShell = (@($commands | Where-Object { [string]$_.trigger -eq 'Jarvis PowerShell' }).Count -eq 1)
            HasHostname = (@($commands | Where-Object { [string]$_.trigger -eq 'Jarvis Hostname' }).Count -eq 1)
        }
    } catch {
        return [pscustomobject]@{ Ok=$false; Commands=@(); Score=0; HasPowerShell=$false; HasHostname=$false }
    }
}

function Find-TriggerDataDir {
    $roots = New-Object System.Collections.Generic.List[string]

    foreach ($known in @(
        $env:USERPROFILE,
        'C:\Users\duy',
        'C:\Users\Administrator',
        'C:\Windows\System32\config\systemprofile'
    )) {
        if ($known -and -not $roots.Contains($known)) { $roots.Add($known) }
    }

    foreach ($p in @(Get-ChildItem -LiteralPath 'C:\Users' -Directory -ErrorAction SilentlyContinue)) {
        if (-not $roots.Contains($p.FullName)) { $roots.Add($p.FullName) }
    }

    $candidates = @()
    foreach ($root in $roots) {
        $dataDir = Join-Path $root '.TRIGGERcmdData'
        $commandsPath = Join-Path $dataDir 'commands.json'
        if (-not (Test-Path -LiteralPath $commandsPath -PathType Leaf)) { continue }

        $parsed = Read-CommandFile $commandsPath
        if (-not $parsed.Ok) { continue }

        $candidates += [pscustomobject]@{
            Root = $root
            DataDir = $dataDir
            CommandsPath = $commandsPath
            Commands = $parsed.Commands
            Score = [int]$parsed.Score
            Baseline = [bool]($parsed.HasPowerShell -and $parsed.HasHostname)
            ComputerIdPresent = (Test-Path -LiteralPath (Join-Path $dataDir 'computerid.cfg') -PathType Leaf)
        }
    }

    # Strongest identity: the known baseline pair already exposed by the cloud registry.
    $baseline = @($candidates | Where-Object { $_.Baseline })
    if ($baseline.Count -eq 1) { return $baseline[0] }

    # Otherwise select only a unique highest-scoring local command set with a
    # computer identity file. Never read token.tkn or computerid.cfg contents.
    $identified = @($candidates | Where-Object { $_.ComputerIdPresent -and $_.Score -ge 2 } | Sort-Object Score -Descending)
    if ($identified.Count -ge 1) {
        if ($identified.Count -eq 1 -or $identified[0].Score -gt $identified[1].Score) {
            return $identified[0]
        }
    }

    # Last bounded recovery: if commands.json was lost/corrupt, examine only
    # commands*.bak files immediately under discovered .TRIGGERcmdData dirs.
    $backupCandidates = @()
    foreach ($root in $roots) {
        $dataDir = Join-Path $root '.TRIGGERcmdData'
        if (-not (Test-Path -LiteralPath $dataDir -PathType Container)) { continue }
        if (-not (Test-Path -LiteralPath (Join-Path $dataDir 'computerid.cfg') -PathType Leaf)) { continue }

        foreach ($bak in @(Get-ChildItem -LiteralPath $dataDir -Filter 'commands*.bak' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTimeUtc -Descending)) {
            $parsed = Read-CommandFile $bak.FullName
            if (-not $parsed.Ok) { continue }
            if ($parsed.Score -lt 2) { continue }
            $backupCandidates += [pscustomobject]@{
                Root = $root
                DataDir = $dataDir
                CommandsPath = (Join-Path $dataDir 'commands.json')
                BackupPath = $bak.FullName
                Commands = $parsed.Commands
                Score = [int]$parsed.Score
                Baseline = [bool]($parsed.HasPowerShell -and $parsed.HasHostname)
                ComputerIdPresent = $true
                LastWriteTimeUtc = $bak.LastWriteTimeUtc
            }
        }
    }

    $backupBaseline = @($backupCandidates | Where-Object { $_.Baseline } | Sort-Object LastWriteTimeUtc -Descending)
    if ($backupBaseline.Count -eq 1) {
        Copy-Item -LiteralPath $backupBaseline[0].BackupPath -Destination $backupBaseline[0].CommandsPath -Force
        return $backupBaseline[0]
    }
    if ($backupBaseline.Count -gt 1) {
        $top = $backupBaseline[0]
        $second = $backupBaseline[1]
        if ($top.Root -eq $second.Root) {
            Copy-Item -LiteralPath $top.BackupPath -Destination $top.CommandsPath -Force
            return $top
        }
    }

    throw "Could not uniquely identify the TRIGGERcmd data directory. currentCandidates=$($candidates.Count) backupCandidates=$($backupCandidates.Count)"
}

function Invoke-Fixed {
    param([string]$Script,[string]$Action,[string]$Prefix)
    $saved = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $global:LASTEXITCODE = 0
        $lines = @(& powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $Script $Action 2>&1 |
            ForEach-Object { [string]$_ })
        $code = 0
        if ($null -ne $LASTEXITCODE) { $code = [int]$LASTEXITCODE }
    } finally {
        $ErrorActionPreference = $saved
    }
    $receipt = @($lines | Where-Object { $_ -like "$Prefix*" } | Select-Object -Last 1)
    $receiptText = ''
    if ($receipt.Count -gt 0) { $receiptText = [string]$receipt[0] }
    [pscustomobject]@{
        ExitCode = $code
        Receipt = $receiptText
    }
}

function Wait-FixedHealthy {
    param(
        [string]$Script,
        [string]$Prefix,
        [string]$HealthyPrefix,
        [int]$Seconds
    )
    $last = $null
    $deadline = (Get-Date).AddSeconds($Seconds)
    do {
        $last = Invoke-Fixed -Script $Script -Action 'status' -Prefix $Prefix
        if ($last.ExitCode -eq 0 -and $last.Receipt -like "$HealthyPrefix*") { return $last }
        Start-Sleep -Milliseconds 1000
    } while ((Get-Date) -lt $deadline)
    return $last
}

function Write-Receipt([hashtable]$Data) {
    New-Item -ItemType Directory -Force -Path $RecoveryRoot | Out-Null
    $Data.completedAtUtc = [DateTime]::UtcNow.ToString('o')
    $Data.machine = $ExpectedHost
    $Data.reviewedHead = $ExpectedHead
    $Data.newTaskCreated = $false
    $Data.newServiceCreated = $false
    $Data.newListenerCreated = $false
    $Data.newControlPlaneCreated = $false
    $Data.authorityWidened = $false
    $Data.tokenRead = $false
    $Data | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ReceiptPath -Encoding UTF8
}

if ([System.Net.Dns]::GetHostName() -ine $ExpectedHost) {
    throw "This bootstrap is sealed to $ExpectedHost."
}

New-Item -ItemType Directory -Force -Path $RecoveryRoot | Out-Null

$selected = $null
$servicePre = 'Unknown'
$servicePost = 'Unknown'
$mcpFinal = $null
$queueFinal = $null

try {
    Write-Host ''
    Write-Host '=== JARVIS LOCAL BOOTSTRAP V5 ==='

    Write-Host '1/7 Discovering the actual TRIGGERcmd data directory...'
    $selected = Find-TriggerDataDir
    Write-Host "TRIGGER_PROFILE_DISCOVERY=PASS score=$($selected.Score) baseline=$($selected.Baseline)"

    Write-Host '2/7 Fetching exact reviewed A786 recovery files...'
    $fallback = Join-Path $RecoveryRoot 'repair-windows-mcp-fallback.ps1'
    $transport = Join-Path $RecoveryRoot 'repair-windows-mcp-transport-overlay.ps1'
    $queueOverlay = Join-Path $RecoveryRoot 'repair-queue-result-window-overlay.ps1'
    Invoke-WebRequest -UseBasicParsing -Uri "$RawBase/repair-windows-mcp-fallback.ps1" -OutFile $fallback
    Invoke-WebRequest -UseBasicParsing -Uri "$RawBase/repair-windows-mcp-transport-overlay.ps1" -OutFile $transport
    Invoke-WebRequest -UseBasicParsing -Uri "$RawBase/repair-queue-result-window-overlay.ps1" -OutFile $queueOverlay

    Write-Host '3/7 Verifying immutable Git blob identities...'
    $fallbackBlob = Get-GitBlobSha $fallback
    $transportBlob = Get-GitBlobSha $transport
    $queueBlob = Get-GitBlobSha $queueOverlay
    if ($fallbackBlob -ne $ExpectedFallbackBlob) { throw 'Fallback blob mismatch.' }
    if ($transportBlob -ne $ExpectedTransportBlob) { throw 'Transport blob mismatch.' }
    if ($queueBlob -ne $ExpectedQueueBlob) { throw 'Queue overlay blob mismatch.' }
    Write-Host 'BLOB_VERIFICATION=PASS'

    Write-Host '4/7 Reapplying the exact reviewed fixed-command package...'
    $oldUserProfile = $env:USERPROFILE
    try {
        $env:USERPROFILE = [string]$selected.Root
        $output = @(& powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $queueOverlay 2>&1 |
            ForEach-Object { [string]$_ })
        $installCode = 0
        if ($null -ne $LASTEXITCODE) { $installCode = [int]$LASTEXITCODE }
    } finally {
        $env:USERPROFILE = $oldUserProfile
    }
    if ($installCode -ne 0) { throw "Reviewed A786 installer failed closed: exit=$installCode" }

    $verified = @(Get-Content -LiteralPath $selected.CommandsPath -Raw | ConvertFrom-Json -ErrorAction Stop)
    if (@($verified | Where-Object { [string]$_.trigger -eq 'Jarvis Control' }).Count -ne 0) { throw 'Retired command remains.' }
    foreach ($name in @('Jarvis Windows MCP','Jarvis Queue')) {
        $e = @($verified | Where-Object { [string]$_.trigger -eq $name })
        if ($e.Count -ne 1) { throw "$name missing or duplicated after install." }
        if ([string]$e[0].ground -ne 'background') { throw "$name ground mismatch." }
        if ([string]$e[0].allowParams -ne 'true') { throw "$name allowParams mismatch." }
        if ([string]$e[0].voiceReply -ne '{{result}}') { throw "$name result contract mismatch." }
    }
    Write-Host 'FIXED_COMMAND_INSTALL=PASS'

    Write-Host '5/7 Restarting only the existing TRIGGERcmd service...'
    $services = @(Get-Service -ErrorAction SilentlyContinue | Where-Object {
        $_.Name -eq 'TRIGGERcmdAgent' -or $_.DisplayName -match '(?i)TRIGGERcmd'
    })
    if ($services.Count -ne 1) { throw "Expected one existing TRIGGERcmd service; found $($services.Count)." }
    $svc = $services[0]
    $servicePre = [string]$svc.Status
    if ($svc.Status -eq 'Running') {
        Restart-Service -Name $svc.Name -Force -ErrorAction Stop
    } else {
        Start-Service -Name $svc.Name -ErrorAction Stop
    }
    $deadline = (Get-Date).AddSeconds(20)
    do {
        Start-Sleep -Milliseconds 500
        $svc = Get-Service -Name $svc.Name -ErrorAction Stop
    } while ($svc.Status -ne 'Running' -and (Get-Date) -lt $deadline)
    $servicePost = [string]$svc.Status
    if ($servicePost -ne 'Running') { throw 'TRIGGERcmd service failed to reach Running.' }
    Write-Host "TRIGGERCMD_SERVICE=$servicePost"

    Write-Host '6/7 Recovering Windows MCP and queue locally...'
    $mcpScript = Join-Path $selected.DataDir 'scripts\jarvis-windows-mcp.ps1'
    $queueScript = Join-Path $selected.DataDir 'scripts\jarvis-queue.ps1'
    if (-not (Test-Path -LiteralPath $mcpScript -PathType Leaf)) { throw 'Installed MCP script missing.' }
    if (-not (Test-Path -LiteralPath $queueScript -PathType Leaf)) { throw 'Installed Queue script missing.' }

    $oldUserProfile = $env:USERPROFILE
    try {
        $env:USERPROFILE = [string]$selected.Root

        $mcpInitial = Invoke-Fixed $mcpScript 'status' 'windows-mcp '
        $mcpRecovery = $null
        if ($mcpInitial.ExitCode -ne 0) {
            $mcpRecovery = Invoke-Fixed $mcpScript 'recover' 'windows-mcp '
        }
        $mcpFinal = Wait-FixedHealthy $mcpScript 'windows-mcp ' 'windows-mcp ok=True' 20

        $queueInitial = Invoke-Fixed $queueScript 'status' 'jarvis-queue '
        $queueRecovery = $null
        if ($queueInitial.ExitCode -ne 0) {
            $queueRecovery = Invoke-Fixed $queueScript 'recover' 'jarvis-queue '
        }
        $queueFinal = Wait-FixedHealthy $queueScript 'jarvis-queue ' 'jarvis-queue ok=True' 35
    } finally {
        $env:USERPROFILE = $oldUserProfile
    }

    $mcpOk = ($mcpFinal -and $mcpFinal.ExitCode -eq 0 -and $mcpFinal.Receipt -like 'windows-mcp ok=True*')
    $queueOk = ($queueFinal -and $queueFinal.ExitCode -eq 0 -and $queueFinal.Receipt -like 'jarvis-queue ok=True*')

    Write-Host '7/7 Writing sanitized receipt...'
    $overallStatus = 'LOCAL_BOOTSTRAP_V5_PARTIAL_FAIL_CLOSED'
    if ($mcpOk -and $queueOk) { $overallStatus = 'LOCAL_BOOTSTRAP_V5_READY' }

    Write-Receipt @{
        status = $overallStatus
        discovery = @{
            score = [int]$selected.Score
            baseline = [bool]$selected.Baseline
            computerIdPresent = [bool]$selected.ComputerIdPresent
        }
        blobs = @{
            fallback = $fallbackBlob
            transport = $transportBlob
            queue = $queueBlob
        }
        service = @{ pre=$servicePre; post=$servicePost }
        windowsMcp = @{
            initial = $mcpInitial
            recovery = $mcpRecovery
            final = $mcpFinal
            ok = $mcpOk
        }
        queue = @{
            initial = $queueInitial
            recovery = $queueRecovery
            final = $queueFinal
            ok = $queueOk
        }
    }

    Write-Host ''
    Write-Host '=== SANITIZED RESULT ==='
    Write-Host "TRIGGERCMD_SERVICE=$servicePost"
    if ($mcpFinal.Receipt) { Write-Host $mcpFinal.Receipt }
    if ($queueFinal.Receipt) { Write-Host $queueFinal.Receipt }
    Write-Host "MCP_OK=$mcpOk"
    Write-Host "QUEUE_OK=$queueOk"
    Write-Host "RECEIPT=$ReceiptPath"

    if (-not ($mcpOk -and $queueOk)) { exit 2 }
    exit 0
}
catch {
    $discoverySummary = @{ score = 0; baseline = $false }
    if ($null -ne $selected) {
        $discoverySummary = @{
            score = [int]$selected.Score
            baseline = [bool]$selected.Baseline
        }
    }

    Write-Receipt @{
        status = 'LOCAL_BOOTSTRAP_V5_FAILED_CLOSED'
        failCode = 'bounded-v5-recovery-failed'
        discovery = $discoverySummary
        service = @{ pre=$servicePre; post=$servicePost }
        windowsMcpFinal = $mcpFinal
        queueFinal = $queueFinal
    }
    Write-Error 'LOCAL_BOOTSTRAP_V5_FAILED_CLOSED=bounded-v5-recovery-failed'
    Write-Host "RECEIPT=$ReceiptPath"
    exit 3
}