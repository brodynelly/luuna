# `lu` / `luuna`: runs the Rust terminal client (crates/luuna-tui) against the local
# development runtime. The fixed startup helper starts or reuses the runtime and hands
# the connection back through memory only (ADR 0011); the token reaches the client as
# an environment variable of this process and is never written or echoed. Works from a
# development checkout (target\debug\luuna-tui.exe from `cargo build --locked -p
# luuna-tui`; CARGO_TARGET_DIR is honoured) and from the packaged layout
# (scripts/package-windows.ps1), which places luuna-tui.exe beside the scripts folder.
# The client embeds its command table and the capability catalog; it needs no Node.
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
# `luuna help missions` is the component's own help.
if ($Arguments.Count -eq 2 -and $Arguments[0] -eq 'help' -and $suiteComponents.ContainsKey($Arguments[1])) {
    $Arguments = @($Arguments[1], '--help')
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
$development = Test-Path -LiteralPath (Join-Path $root 'Cargo.toml')
if ($development) {
    $target = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $root 'target' }
    if (![System.IO.Path]::IsPathRooted($target)) { $target = Join-Path $root $target }
    $client = Join-Path $target 'debug\luuna-tui.exe'
    if (!(Test-Path -LiteralPath $client)) { throw 'The terminal client is not built. Run `cargo build --locked -p luuna-tui` at the Luuna checkout root.' }
} else {
    $client = Join-Path $root 'luuna-tui.exe'
    if (!(Test-Path -LiteralPath $client)) { throw 'The installed terminal client (luuna-tui.exe) is missing. Reinstall the complete Luuna distribution.' }
}
# The client's help names the command the developer types.
$env:LUUNA_CLI_NAME = 'lu'
# Help (`help`, `-h`, `<command> --help`) and catalog are local, credential-free
# operations and must not start a service. A `--help` after `--` is an argument.
$beforeSeparator = @($Arguments | ForEach-Object -Begin { $ended = $false } -Process { if ($_ -eq '--') { $ended = $true }; if (!$ended) { $_ } })
if ($Arguments.Count -gt 0 -and ($Arguments[0] -in @('help', '--help', '-h', 'catalog') -or $beforeSeparator -contains '--help' -or $beforeSeparator -contains '-h')) {
    & $client @Arguments
    exit $LASTEXITCODE
}
$connection = if ($DataDirectory) { & (Join-Path $PSScriptRoot 'ensure-windows-runtime.ps1') -DataDirectory $DataDirectory } else { & (Join-Path $PSScriptRoot 'ensure-windows-runtime.ps1') }
$saved = @{}
foreach ($name in @('LUUNA_URL', 'LUUNA_API_TOKEN')) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
try {
    $env:LUUNA_URL = $connection.url
    $env:LUUNA_API_TOKEN = $connection.token
    & $client @Arguments
    exit $LASTEXITCODE
} finally {
    foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
    $connection = $null
}
