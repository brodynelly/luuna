# Opens the Rust terminal workbench through packages/tui against the local development
# runtime. The fixed startup helper starts or reuses the runtime and hands the
# connection back through memory only (ADR 0011); the token reaches the client
# as an environment variable of this process and is never written or echoed.
# Works from a development checkout (host Node, root node_modules) and from the
# packaged layout (scripts/package-windows.ps1), which stages packages/tui, its
# @luuna/api-client dependency and the capability catalog beside this script.
# Node.js 24.19 or newer on PATH is a host prerequisite; it runs the
# TypeScript client through its built-in type stripping.
# `luuna atlas|beacon|missions` dispatches to the independently installed
# component CLIs without starting the runtime.
# -DataDirectory is accepted only by name: every positional word belongs to the
# client, so `luuna projects` never selects a data directory named "projects".
[CmdletBinding(PositionalBinding = $false)]
param([string]$DataDirectory, [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$suiteComponents = @{
    atlas = @{ directory = 'luuna-atlas'; entry = 'src\cli.ts'; bin = 'luuna-atlas' }
    beacon = @{ directory = 'luuna-beacon'; entry = 'src\index.ts'; bin = 'luuna-beacon' }
    missions = @{ directory = 'luuna-missions'; entry = 'src\index.ts'; bin = 'luuna-missions' }
}
if ($Arguments.Count -gt 0 -and $suiteComponents.ContainsKey($Arguments[0])) {
    $component = $suiteComponents[$Arguments[0]]
    $componentRoot = Join-Path (Split-Path -Parent $root) $component.directory
    $entry = Join-Path $componentRoot $component.entry
    if (!(Test-Path -LiteralPath $entry)) { throw "Luuna $($Arguments[0]) checkout is missing beside the Luuna repository. Run scripts/install-cli.ps1 from the Luuna checkout." }
    $package = Get-Content -LiteralPath (Join-Path $componentRoot 'package.json') -Raw | ConvertFrom-Json
    if (!$package.bin.PSObject.Properties[$component.bin] -or !(Test-Path -LiteralPath (Join-Path $componentRoot 'node_modules'))) {
        throw "Luuna $($Arguments[0]) dependencies or CLI entry are missing. Run scripts/install-cli.ps1 from the Luuna checkout."
    }
    $bun = (Get-Command bun -ErrorAction Stop).Source
    $componentArguments = @($Arguments | Select-Object -Skip 1)
    & $bun $entry @componentArguments
    exit $LASTEXITCODE
}
$client = Join-Path $root 'packages\tui\bin\luuna-tui.mjs'
if (!(Test-Path -LiteralPath $client)) { throw 'The terminal client is not present beside this script.' }
$node = (Get-Command node.exe -ErrorAction Stop).Source
# Help and catalog are local, credential-free operations and must not start a service.
if ($Arguments.Count -gt 0 -and $Arguments[0] -in @('help', '--help', '-h', 'catalog')) {
    & $node $client @Arguments
    exit $LASTEXITCODE
}
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
