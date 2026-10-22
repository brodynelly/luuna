# Stable across Explorer and packaged development terminals. Only encrypted records migrate.
function Get-LuunaWindowsPaths {
    $homeDirectory = Join-Path $env:USERPROFILE '.luuna'
    $credentialsDirectory = Join-Path $homeDirectory 'credentials'
    $logsDirectory = Join-Path $homeDirectory 'logs'
    New-Item -ItemType Directory -Force -Path $credentialsDirectory, $logsDirectory | Out-Null
    foreach ($name in @('provider.json', 'connection.json')) {
        $destination = Join-Path $credentialsDirectory $name
        $legacy = Join-Path $env:LOCALAPPDATA ('Luuna\credentials\' + $name)
        if (!(Test-Path -LiteralPath $destination) -and (Test-Path -LiteralPath $legacy)) {
            Copy-Item -LiteralPath $legacy -Destination $destination
        }
    }
    return @{ Home = $homeDirectory; Credentials = $credentialsDirectory; Logs = $logsDirectory }
}

# A packaged installation (scripts/package-windows.ps1, ADR 0024) stages the
# pinned Missions/Atlas/Beacon trees with their distribution manifest and the
# pinned Bun executable beside the runtime. Returns $null for a development
# checkout, which keeps using its submodules and .tools Bun.
function Get-LuunaPackagedComponents([string]$Root) {
    $distManifest = Join-Path $Root 'components\dist-manifest.json'
    $bun = Join-Path $Root 'bun\bun.exe'
    if ((Test-Path -LiteralPath $distManifest) -and (Test-Path -LiteralPath $bun)) {
        return @{ Root = $Root; Bun = $bun }
    }
    return $null
}
