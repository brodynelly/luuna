# Opens the Luuna terminal client (packages/tui) against the local development
# runtime. The fixed startup helper starts or reuses the runtime and hands the
# connection back through memory only (ADR 0011); the token reaches the client
# as an environment variable of this process and is never written or echoed.
# Works from a development checkout (host Node, root node_modules) and from the
# packaged layout (scripts/package-windows.ps1), which stages packages/tui, its
# @luuna/api-client dependency and the capability catalog beside this script.
# Node.js 24.19 or newer on PATH is a host prerequisite; it runs the
# TypeScript client through its built-in type stripping.
[CmdletBinding()]
param([string]$DataDirectory, [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$client = Join-Path $root 'packages\tui\bin\luuna-tui.mjs'
if (!(Test-Path -LiteralPath $client)) { throw 'The terminal client is not present beside this script.' }
$node = (Get-Command node.exe -ErrorAction Stop).Source
$connection = if ($DataDirectory) { & (Join-Path $PSScriptRoot 'ensure-windows-runtime.ps1') -DataDirectory $DataDirectory } else { & (Join-Path $PSScriptRoot 'ensure-windows-runtime.ps1') }
$saved = @{}
foreach ($name in @('LUUNA_URL', 'LUUNA_API_TOKEN')) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
try {
    $env:LUUNA_URL = $connection.url
    $env:LUUNA_API_TOKEN = $connection.token
    & $node $client @Arguments
    exit $LASTEXITCODE
} finally {
    foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
    $connection = $null
}
