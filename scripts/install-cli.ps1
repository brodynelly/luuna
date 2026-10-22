[CmdletBinding()]
param(
    [string]$ComponentsRoot,
    [string]$InstallDirectory
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (!$ComponentsRoot) { $ComponentsRoot = Split-Path -Parent $root }
if (!$InstallDirectory) { $InstallDirectory = Join-Path $env:LOCALAPPDATA 'Luuna\bin' }
$manifest = Get-Content -LiteralPath (Join-Path $root 'components\manifest.json') -Raw | ConvertFrom-Json
$bunCommand = Get-Command bun -ErrorAction Stop
$bun = $bunCommand.Source
$bunVersion = (& $bun --version).Trim()
if ($bunVersion -ne $manifest.runtime.version) {
    throw "Luuna components require Bun $($manifest.runtime.version); found $bunVersion."
}

$commands = @(
    @{ name = 'luuna-atlas'; alias = 'lat'; directory = 'luuna-atlas'; entry = 'src\cli.ts'; dispatch = 'atlas' }
    @{ name = 'luuna-beacon'; alias = 'lbc'; directory = 'luuna-beacon'; entry = 'src\index.ts'; dispatch = 'beacon' }
    @{ name = 'luuna-missions'; alias = 'lms'; directory = 'luuna-missions'; entry = 'src\index.ts'; dispatch = 'missions' }
)

foreach ($command in $commands) {
    $componentRoot = Join-Path $ComponentsRoot $command.directory
    $entry = Join-Path $componentRoot $command.entry
    $packagePath = Join-Path $componentRoot 'package.json'
    if (!(Test-Path -LiteralPath $packagePath) -or !(Test-Path -LiteralPath $entry)) {
        throw "Missing $($command.directory) checkout. Clone Luuna's component repositories beside the main checkout first."
    }
    $package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
    if ($package.name -notmatch '^@luuna/' -or !$package.bin.PSObject.Properties[$command.name]) {
        throw "The $($command.directory) checkout does not expose the expected $($command.name) CLI."
    }
    & $bun install --frozen-lockfile --ignore-scripts --cwd $componentRoot
    if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed for $($command.directory)." }
}

New-Item -ItemType Directory -Force -Path $InstallDirectory | Out-Null
$launcher = (Join-Path $PSScriptRoot 'start-terminal.ps1').Replace('"', '""')
$launchers = @{
    'luuna.cmd' = "@echo off`r`npowershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$launcher`" %*`r`n"
    'lu.cmd' = "@echo off`r`n`"%~dp0luuna.cmd`" %*`r`n"
    'luuna-atlas.cmd' = "@echo off`r`nbun `"$(Join-Path $ComponentsRoot 'luuna-atlas\src\cli.ts')`" %*`r`n"
    'luuna-beacon.cmd' = "@echo off`r`nbun `"$(Join-Path $ComponentsRoot 'luuna-beacon\src\index.ts')`" %*`r`n"
    'luuna-missions.cmd' = "@echo off`r`nbun `"$(Join-Path $ComponentsRoot 'luuna-missions\src\index.ts')`" %*`r`n"
    'lat.cmd' = "@echo off`r`n`"%~dp0luuna.cmd`" atlas %*`r`n"
    'lbc.cmd' = "@echo off`r`n`"%~dp0luuna.cmd`" beacon %*`r`n"
    'lms.cmd' = "@echo off`r`n`"%~dp0luuna.cmd`" missions %*`r`n"
}
foreach ($name in $launchers.Keys) {
    Set-Content -LiteralPath (Join-Path $InstallDirectory $name) -Value $launchers[$name] -Encoding Ascii
}

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$pathEntries = @($userPath -split ';' | Where-Object { $_ })
if ($pathEntries -notcontains $InstallDirectory) {
    [Environment]::SetEnvironmentVariable('Path', (@($pathEntries) + $InstallDirectory) -join ';', 'User')
}
if (($env:Path -split ';') -notcontains $InstallDirectory) { $env:Path = "$InstallDirectory;$env:Path" }

Write-Output "Installed Luuna CLI launchers to $InstallDirectory"
Write-Output 'Commands: luuna, lu, luuna-atlas/lat, luuna-beacon/lbc, luuna-missions/lms'
Write-Output 'Open a new terminal to use the updated user PATH.'
