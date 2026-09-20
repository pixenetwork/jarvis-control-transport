param(
  [Parameter(Mandatory=$true)][string]$ReceiptHook,
  [Parameter(Mandatory=$true)][string]$AllowedDirectoriesBase64
)

$ErrorActionPreference = 'Stop'
$InstallDir = 'C:\ProgramData\PixelNetwork\JarvisDesktop\dc-bridge'
$InInstallDir = $false

function Send-BridgeReceipt {
  param([hashtable]$Payload)
  try {
    Invoke-RestMethod -Uri $ReceiptHook -Method Post -ContentType 'application/json' -Body ($Payload | ConvertTo-Json -Compress -Depth 12) | Out-Null
  } catch {}
}

function Resolve-Program {
  param([string]$Name, [string[]]$Fallbacks)
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source) { return $cmd.Source }
  foreach ($candidate in $Fallbacks) {
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  throw "Required program not found: $Name"
}

try {
  $allowedJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($AllowedDirectoriesBase64))
  $AllowedDirectories = @($allowedJson | ConvertFrom-Json)
  if ($AllowedDirectories.Count -lt 1) { throw 'AllowedDirectories is empty.' }

  $NodeExe = Resolve-Program 'node.exe' @(
    'C:\Program Files\nodejs\node.exe',
    'C:\Program Files (x86)\nodejs\node.exe'
  )
  $NpmCmd = Resolve-Program 'npm.cmd' @(
    'C:\Program Files\nodejs\npm.cmd',
    'C:\Program Files (x86)\nodejs\npm.cmd'
  )

  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

  $packageJson = @'
{
  "name": "jarvis-local-desktop-commander-bridge",
  "private": true,
  "type": "module",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.9.0",
    "@wonderwhy-er/desktop-commander": "0.2.51"
  }
}
'@

  $bridgeJs = @'
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [, , toolName, argsB64 = "e30="] = process.argv;
if (!toolName) throw new Error("tool name required");
const args = JSON.parse(Buffer.from(argsB64, "base64").toString("utf8"));
const here = path.dirname(fileURLToPath(import.meta.url));
const server = path.join(here, "node_modules", "@wonderwhy-er", "desktop-commander", "dist", "index.js");

const client = new Client({
  name: "jarvis-local-dc-bridge",
  version: "1.0.0"
});

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [server],
  env: {
    ...process.env,
    DISABLE_TELEMETRY: "true"
  }
});

try {
  await client.connect(transport);
  const result = await client.callTool({
    name: toolName,
    arguments: args
  });
  process.stdout.write(JSON.stringify(result));
} finally {
  await client.close().catch(() => {});
}
'@

  $callPs = @'
param(
  [Parameter(Mandatory=$true)][string]$CorrelationId,
  [Parameter(Mandatory=$true)][string]$Tool,
  [string]$ArgsB64 = 'e30='
)

$ErrorActionPreference = 'Stop'
$BridgeDir = 'C:\ProgramData\PixelNetwork\JarvisDesktop\dc-bridge'
$InBridgeDir = $false

try {
  $ReceiptHook = (Get-Content -LiteralPath (Join-Path $BridgeDir 'receipt-hook.txt') -Raw).Trim()
  $NodeExe = (Get-Content -LiteralPath (Join-Path $BridgeDir 'node-path.txt') -Raw).Trim()
  Push-Location $BridgeDir
  $InBridgeDir = $true

  $raw = (& $NodeExe '.\bridge.mjs' $Tool $ArgsB64 2>$null | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $raw) { throw "Desktop Commander tool call failed: $Tool" }

  $receipt = [ordered]@{
    status = 'ok'
    correlationId = $CorrelationId
    tool = $Tool
    host = $env:COMPUTERNAME
    result = $raw
    completedAt = (Get-Date).ToUniversalTime().ToString('o')
  }
} catch {
  $receipt = [ordered]@{
    status = 'error'
    correlationId = $CorrelationId
    tool = $Tool
    host = $env:COMPUTERNAME
    error = $_.Exception.Message
    completedAt = (Get-Date).ToUniversalTime().ToString('o')
  }
} finally {
  if ($InBridgeDir) { Pop-Location }
  try {
    $ReceiptHook = (Get-Content -LiteralPath (Join-Path $BridgeDir 'receipt-hook.txt') -Raw).Trim()
    Invoke-RestMethod -Uri $ReceiptHook -Method Post -ContentType 'application/json' -Body ($receipt | ConvertTo-Json -Compress -Depth 12) | Out-Null
  } catch {}
}
'@

  Set-Content -LiteralPath (Join-Path $InstallDir 'package.json') -Value $packageJson -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $InstallDir 'bridge.mjs') -Value $bridgeJs -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $InstallDir 'dc-call.ps1') -Value $callPs -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $InstallDir 'receipt-hook.txt') -Value $ReceiptHook -Encoding UTF8 -NoNewline
  Set-Content -LiteralPath (Join-Path $InstallDir 'node-path.txt') -Value $NodeExe -Encoding UTF8 -NoNewline

  Push-Location $InstallDir
  $InInstallDir = $true

  & $NpmCmd install --ignore-scripts --no-audit --no-fund | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' }

  $telemetryRequest = @{ key = 'telemetryEnabled'; value = $false } | ConvertTo-Json -Compress
  $telemetryB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($telemetryRequest))
  & $NodeExe '.\bridge.mjs' 'set_config_value' $telemetryB64 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Failed to disable Desktop Commander telemetry.' }

  $directoryRequest = @{ key = 'allowedDirectories'; value = $AllowedDirectories } | ConvertTo-Json -Compress
  $directoryB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($directoryRequest))
  & $NodeExe '.\bridge.mjs' 'set_config_value' $directoryB64 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Failed to configure Desktop Commander allowed directories.' }

  $configRaw = (& $NodeExe '.\bridge.mjs' 'get_config' 'e30=' 2>$null | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $configRaw) { throw 'Desktop Commander get_config verification failed.' }
  $configEnvelope = $configRaw | ConvertFrom-Json
  $configText = [string]$configEnvelope.content[0].text
  $config = $configText | ConvertFrom-Json

  $probePath = [string]$AllowedDirectories[0]
  $probeRequest = @{ path = $probePath; depth = 1 } | ConvertTo-Json -Compress
  $probeB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($probeRequest))
  $probeRaw = (& $NodeExe '.\bridge.mjs' 'list_directory' $probeB64 2>$null | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $probeRaw) { throw 'Desktop Commander list_directory verification failed.' }

  $desktopCommanderPackage = Get-Content -LiteralPath (Join-Path $InstallDir 'node_modules\@wonderwhy-er\desktop-commander\package.json') -Raw | ConvertFrom-Json

  Send-BridgeReceipt ([ordered]@{
    status = 'bootstrap-ok'
    bridge = 'jarvis-local-desktop-commander'
    host = $env:COMPUTERNAME
    runAs = $env:USERNAME
    installPath = $InstallDir
    packageVersion = [string]$desktopCommanderPackage.version
    dcVersion = [string]$config.version
    telemetryEnabled = [bool]$config.telemetryEnabled
    allowedDirectoryCount = @($config.allowedDirectories).Count
    probePath = $probePath
    listDirectoryCall = $true
    verifiedAt = (Get-Date).ToUniversalTime().ToString('o')
  })
} catch {
  Send-BridgeReceipt ([ordered]@{
    status = 'bootstrap-error'
    bridge = 'jarvis-local-desktop-commander'
    host = $env:COMPUTERNAME
    runAs = $env:USERNAME
    installPath = $InstallDir
    error = $_.Exception.Message
    verifiedAt = (Get-Date).ToUniversalTime().ToString('o')
  })
  throw
} finally {
  if ($InInstallDir) { Pop-Location }
}
