# Builds a Windows development distribution of Luuna: an NSIS installer that
# carries the Tauri desktop, the release runtime, the Windows helper scripts,
# the pinned Pi tree (ADR 0018), the pinned Missions/Atlas/Beacon trees with
# their distribution manifest and the pinned Bun 1.4.3 executable (ADR 0024),
# and the terminal client (packages/tui with @luuna/api-client and the
# capability catalog). Node.js, Git and Python stay host prerequisites that
# `luuna-runtime doctor` reports. The installer is unsigned unless a
# certificate thumbprint is supplied; an unsigned installer is a development
# distribution, never release evidence. See docs/PACKAGING.md for the layout
# and the clean-machine procedure.
#
#   powershell -NoProfile -File scripts/package-windows.ps1 [-DebugBuild] [-SkipPi] [-SkipComponents] [-CertificateThumbprint <sha1>] [-TimestampUrl <url>]
[CmdletBinding()]
param(
    [switch]$DebugBuild,
    [switch]$SkipPi,
    [switch]$SkipComponents,
    [string]$CertificateThumbprint,
    [string]$TimestampUrl = 'http://timestamp.digicert.com'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$tauriDirectory = Join-Path $root 'apps\desktop\src-tauri'
$profile = if ($DebugBuild) { 'debug' } else { 'release' }
$stage = Join-Path $tauriDirectory ('target\stage-' + $profile)
$started = Get-Date

function Step([string]$text) { Write-Host ("==> " + $text) }
function Require-Command([string]$name, [string]$hint) {
    if (!(Get-Command $name -ErrorAction SilentlyContinue)) { throw ($name + ' is required: ' + $hint) }
}
function Sha256([string]$path) { (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() }

Step 'Prerequisites'
Require-Command cargo 'install the pinned Rust toolchain (rust-toolchain.toml)'
Require-Command node.exe 'install Node.js 24.19 or newer'
Require-Command npm.cmd 'install npm with Node.js'
Require-Command git.exe 'install Git 2.43 or newer (the component pins are verified against gitlinks)'
if (!(Test-Path -LiteralPath (Join-Path $root 'node_modules\.bin\tauri.cmd'))) { throw 'Run npm ci --ignore-scripts at the repository root first (the Tauri CLI is a pinned devDependency).' }
if (!$SkipComponents -and $env:PROCESSOR_ARCHITECTURE -ne 'AMD64') { throw ('The pinned Bun package staged here is bun-windows-x64; this host is ' + $env:PROCESSOR_ARCHITECTURE + '. Use -SkipComponents or add the matching package.') }
$webview = @(
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (!$webview) { Write-Warning 'The WebView2 Runtime registration was not found on this machine; the installer still requires it on the target.' }
$rustVersion = (& cargo --version)
$nodeVersion = (& node.exe --version)

Step 'Release runtime (cargo build --locked -p luuna-runtime)'
$cargoArguments = @('build', '--locked', '-p', 'luuna-runtime')
if (!$DebugBuild) { $cargoArguments += '--release' }
& cargo @cargoArguments
if ($LASTEXITCODE -ne 0) { throw 'The runtime build failed.' }
$runtime = Join-Path $root ('target\' + $profile + '\luuna-runtime.exe')
if (!(Test-Path -LiteralPath $runtime)) { throw ('Runtime executable missing: ' + $runtime) }

$piSource = Join-Path $root 'tools\pi'
if (!$SkipPi) {
    Step 'Pinned Pi tree (npm ci --ignore-scripts --omit=dev in tools/pi)'
    Push-Location $piSource
    try {
        & npm.cmd ci --ignore-scripts --omit=dev
        if ($LASTEXITCODE -ne 0) { throw 'Installing the pinned Pi package failed.' }
    } finally { Pop-Location }
    $cli = Join-Path $piSource 'node_modules\@earendil-works\pi-coding-agent\dist\cli.js'
    if (!(Test-Path -LiteralPath $cli)) { throw 'The pinned Pi CLI was not installed.' }
    $piVersion = (& node.exe $cli --version)
    if ($LASTEXITCODE -ne 0) { throw 'The pinned Pi CLI does not answer --version.' }
} else { $piVersion = 'skipped' }

# Bun 1.4.3 exactly as scripts/setup-cloud.sh installs it (npm install bun@1.4.3
# into .tools/bun); the platform package carries the executable the components
# crate and scripts/components.mjs already look for.
$bunCandidates = @((Join-Path $root '.tools\bun\node_modules\@oven\bun-windows-x64\bin\bun.exe'), (Join-Path $root '.tools\bun\node_modules\bun\bin\bun.exe'))
$bun = $bunCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (!$SkipComponents) {
    Step 'Pinned Bun 1.4.3 (npm install bun@1.4.3 in .tools/bun)'
    if (!$bun) {
        & npm.cmd install --prefix (Join-Path $root '.tools\bun') --no-audit --no-fund bun@1.4.3
        if ($LASTEXITCODE -ne 0) { throw 'Installing the pinned Bun package failed.' }
        $bun = $bunCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    }
    if (!$bun) { throw ('The pinned Bun executable was not installed under ' + (Join-Path $root '.tools\bun')) }
    $bunVersion = (& $bun --version)
    if ($LASTEXITCODE -ne 0 -or $bunVersion.Trim() -ne '1.4.3') { throw ('Bun 1.4.3 is required; found ' + $bunVersion) }
} else { $bunVersion = 'skipped' }

Step ('Staging resources in ' + $stage)
if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'scripts') | Out-Null
Copy-Item -LiteralPath $runtime -Destination (Join-Path $stage 'luuna-runtime.exe')
foreach ($script in @('windows-common.ps1', 'ensure-windows-runtime.ps1', 'start-windows.ps1', 'stop-windows.ps1', 'set-windows-provider.ps1', 'with-windows-provider.ps1', 'start-terminal.ps1')) {
    Copy-Item -LiteralPath (Join-Path $root ('scripts\' + $script)) -Destination (Join-Path $stage ('scripts\' + $script))
}
foreach ($launcher in @('Configure Luuna.cmd', 'Stop Luuna.cmd')) {
    Copy-Item -LiteralPath (Join-Path $root $launcher) -Destination (Join-Path $stage $launcher)
}
if (!$SkipPi) {
    New-Item -ItemType Directory -Force -Path (Join-Path $stage 'pi') | Out-Null
    foreach ($file in @('package.json', 'package-lock.json')) { Copy-Item -LiteralPath (Join-Path $piSource $file) -Destination (Join-Path $stage ('pi\' + $file)) }
    # robocopy returns 0-7 for success.
    & robocopy (Join-Path $piSource 'node_modules') (Join-Path $stage 'pi\node_modules') /E /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -gt 7) { throw 'Copying the pinned Pi tree failed.' }
}
Copy-Item -LiteralPath (Join-Path $root 'LICENSE') -Destination (Join-Path $stage 'LICENSE')
Copy-Item -LiteralPath (Join-Path $root 'THIRD-PARTY-NOTICES.md') -Destination (Join-Path $stage 'THIRD-PARTY-NOTICES.md')

if (!$SkipComponents) {
    Step 'Pinned component trees (scripts/stage-components.mjs: frozen script-free Bun install, copy, digest)'
    & node.exe (Join-Path $root 'scripts\stage-components.mjs') stage --out $stage --root $root --bun $bun
    if ($LASTEXITCODE -ne 0) { throw 'Staging the pinned component trees failed; the source checkout must satisfy npm run components:verify.' }
    & node.exe (Join-Path $root 'scripts\stage-components.mjs') verify $stage
    if ($LASTEXITCODE -ne 0) { throw 'The staged component layout did not verify against its distribution manifest.' }
}

Step 'Terminal client (packages/tui, @luuna/api-client and the capability catalog)'
# Mirrors the checkout layout so the client resolves its dependency and the
# catalog exactly as in development: packages/tui/src/catalog.mjs reads
# ../../../schemas/capability-catalog.json and `@luuna/api-client` resolves
# through node_modules. The API client is compiled to JavaScript first
# (`npm run build --workspace @luuna/api-client`, tsconfig.build.json): Node
# refuses to strip types from files under node_modules, so the staged package
# exports dist/index.js rather than the TypeScript source.
& npm.cmd run build --workspace @luuna/api-client
if ($LASTEXITCODE -ne 0) { throw 'Compiling @luuna/api-client failed.' }
if (-not (Test-Path (Join-Path $root 'packages\api-client\dist\index.js'))) { throw 'The compiled API client is missing packages\api-client\dist\index.js.' }
foreach ($directory in @('packages\tui\bin', 'packages\tui\src', 'node_modules\@luuna\api-client\dist', 'schemas')) {
    New-Item -ItemType Directory -Force -Path (Join-Path $stage $directory) | Out-Null
}
& robocopy (Join-Path $root 'packages\tui\bin') (Join-Path $stage 'packages\tui\bin') /E /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -gt 7) { throw 'Copying the terminal client failed.' }
& robocopy (Join-Path $root 'packages\tui\src') (Join-Path $stage 'packages\tui\src') /E /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -gt 7) { throw 'Copying the terminal client failed.' }
& robocopy (Join-Path $root 'packages\api-client\dist') (Join-Path $stage 'node_modules\@luuna\api-client\dist') /E /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -gt 7) { throw 'Copying the compiled API client failed.' }
foreach ($file in @('packages\tui\package.json', 'packages\tui\README.md', 'schemas\capability-catalog.json')) {
    Copy-Item -LiteralPath (Join-Path $root $file) -Destination (Join-Path $stage $file)
}
# The staged package manifest exports the compiled entry point only.
$apiClientManifest = Get-Content -Raw (Join-Path $root 'packages\api-client\package.json') | ConvertFrom-Json
@{ name = $apiClientManifest.name; version = $apiClientManifest.version; license = $apiClientManifest.license; type = 'module'; exports = @{ '.' = './dist/index.js' } } |
    ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 (Join-Path $stage 'node_modules\@luuna\api-client\package.json')
# The staged terminal client must start on the host Node without the checkout.
Push-Location $stage
try {
    & node.exe 'packages\tui\bin\luuna-tui.mjs' --help | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'The staged terminal client did not start (node packages\tui\bin\luuna-tui.mjs --help failed).' }
} finally { Pop-Location }
$terminalLauncher = @(
    '@echo off',
    'rem Opens the Luuna terminal client against the local runtime. Node.js 24.19 or newer must be on PATH.',
    'powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-terminal.ps1" %*'
) -join "`r`n"
Set-Content -LiteralPath (Join-Path $stage 'Luuna Terminal.cmd') -Value $terminalLauncher -Encoding ascii

Step 'Bundle configuration overlay'
$stageRelative = ('target/stage-' + $profile)
$bundle = [ordered]@{
    active = $true
    targets = @('nsis')
    resources = [ordered]@{ ($stageRelative + '/') = 'luuna/' }
    windows = [ordered]@{ webviewInstallMode = [ordered]@{ type = 'downloadBootstrapper' } }
}
if ($CertificateThumbprint) {
    $bundle.windows.certificateThumbprint = $CertificateThumbprint
    $bundle.windows.digestAlgorithm = 'sha256'
    $bundle.windows.timestampUrl = $TimestampUrl
}
$overlay = [ordered]@{ bundle = $bundle }
$overlayPath = Join-Path $tauriDirectory ('target\bundle-overlay-' + $profile + '.json')
$overlay | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $overlayPath -Encoding utf8

Step 'tauri build'
$tauriArguments = @('exec', '--workspace', '@luuna/desktop', '--', 'tauri', 'build', '--config', $overlayPath)
if ($DebugBuild) { $tauriArguments += '--debug' }
Push-Location $root
try {
    & npm.cmd @tauriArguments
    if ($LASTEXITCODE -ne 0) { throw 'tauri build failed.' }
} finally { Pop-Location }

Step 'Verifying the packaged layout'
$built = Join-Path $tauriDirectory ('target\' + $profile)
$copied = Join-Path $built 'luuna'
foreach ($required in @('luuna-runtime.exe', 'scripts\ensure-windows-runtime.ps1', 'scripts\windows-common.ps1', 'scripts\start-terminal.ps1', 'Configure Luuna.cmd', 'Luuna Terminal.cmd', 'packages\tui\bin\luuna-tui.mjs', 'packages\tui\src\catalog.mjs', 'node_modules\@luuna\api-client\dist\index.js', 'schemas\capability-catalog.json')) {
    if (!(Test-Path -LiteralPath (Join-Path $copied $required))) { throw ('Packaged resource missing after build: ' + $required) }
}
if (!$SkipPi -and !(Test-Path -LiteralPath (Join-Path $copied 'pi\node_modules\@earendil-works\pi-coding-agent\dist\cli.js'))) { throw 'Packaged Pi tree missing after build.' }
$stagedComponents = $null
if (!$SkipComponents) {
    foreach ($required in @('components\manifest.json', 'components\dist-manifest.json', 'components\missions\package.json', 'components\atlas\package.json', 'components\beacon\package.json', 'bun\bun.exe')) {
        if (!(Test-Path -LiteralPath (Join-Path $copied $required))) { throw ('Packaged component resource missing after build: ' + $required) }
    }
    # The bundler copied the staged trees; prove the copies still match their digests.
    & node.exe (Join-Path $root 'scripts\stage-components.mjs') verify $copied
    if ($LASTEXITCODE -ne 0) { throw 'The packaged component layout does not verify against its distribution manifest.' }
    $dist = Get-Content -LiteralPath (Join-Path $copied 'components\dist-manifest.json') -Raw | ConvertFrom-Json
    $stagedComponents = @(foreach ($component in $dist.components) { [ordered]@{ name = $component.name; commit = $component.commit; digest = $component.digest; files = $component.files } })
}
$installers = @(Get-ChildItem -LiteralPath (Join-Path $built 'bundle\nsis') -Filter '*.exe' -ErrorAction SilentlyContinue)
if (!$installers.Count) { throw 'No NSIS installer was produced.' }
$desktop = Join-Path $built 'luuna-desktop.exe'
$signed = $false
if ($CertificateThumbprint) {
    $signature = Get-AuthenticodeSignature -LiteralPath $installers[0].FullName
    $signed = $signature.Status -eq 'Valid'
    if (!$signed) { throw ('The installer is not validly signed: ' + $signature.Status) }
}

$report = [ordered]@{
    built_at = $started.ToUniversalTime().ToString('o')
    profile = $profile
    host = [ordered]@{ os = [Environment]::OSVersion.VersionString; architecture = $env:PROCESSOR_ARCHITECTURE; rust = $rustVersion; node = $nodeVersion; pi = $piVersion; bun = $bunVersion }
    signed = $signed
    webview_install_mode = 'downloadBootstrapper'
    prerequisites_on_target = @('WebView2 Runtime (bootstrapped by the installer when absent)', 'Node.js 24.19 or newer on PATH for the pinned Pi engine and the terminal client', 'Git 2.43 or newer on PATH', 'Python 3 for Python check recipes', 'a provider key saved with Configure Luuna.cmd')
    components = $stagedComponents
    terminal_client = 'Luuna Terminal.cmd (packages/tui on the host Node)'
    clean_machine_test = 'not executed by this script; see docs/PACKAGING.md'
    artifacts = @(
        foreach ($installer in $installers) { [ordered]@{ path = $installer.FullName; sha256 = (Sha256 $installer.FullName); size_bytes = $installer.Length } }
    )
    desktop_executable = [ordered]@{ path = $desktop; sha256 = (Sha256 $desktop) }
    runtime_executable = [ordered]@{ path = (Join-Path $copied 'luuna-runtime.exe'); sha256 = (Sha256 (Join-Path $copied 'luuna-runtime.exe')) }
}
$reportPath = Join-Path $built ('package-report-' + $started.ToUniversalTime().ToString('yyyyMMddTHHmmssZ') + '.json')
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $reportPath -Encoding utf8
Write-Host ''
Write-Host ('Installer: ' + $installers[0].FullName)
Write-Host ('SHA-256:   ' + $report.artifacts[0].sha256)
Write-Host ('Report:    ' + $reportPath)
if (!$signed) { Write-Warning 'Unsigned development distribution: Windows SmartScreen will warn on a fresh host. Supply -CertificateThumbprint for a signed build.' }
