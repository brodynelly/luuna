# Builds a Windows development distribution of Luuna: an NSIS installer that
# carries the Tauri desktop, the release runtime, the Windows helper scripts and
# the pinned Pi tree (ADR 0018). Node.js, Git and Python stay host prerequisites
# that `luuna-runtime doctor` reports. The installer is unsigned unless a
# certificate thumbprint is supplied; an unsigned installer is a development
# distribution, never release evidence.
#
#   powershell -NoProfile -File scripts/package-windows.ps1 [-DebugBuild] [-SkipPi] [-CertificateThumbprint <sha1>] [-TimestampUrl <url>]
[CmdletBinding()]
param(
    [switch]$DebugBuild,
    [switch]$SkipPi,
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
if (!(Test-Path -LiteralPath (Join-Path $root 'node_modules\.bin\tauri.cmd'))) { throw 'Run npm ci --ignore-scripts at the repository root first (the Tauri CLI is a pinned devDependency).' }
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

Step ('Staging resources in ' + $stage)
if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'scripts') | Out-Null
Copy-Item -LiteralPath $runtime -Destination (Join-Path $stage 'luuna-runtime.exe')
foreach ($script in @('windows-common.ps1', 'ensure-windows-runtime.ps1', 'start-windows.ps1', 'stop-windows.ps1', 'set-windows-provider.ps1', 'with-windows-provider.ps1')) {
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
foreach ($required in @('luuna-runtime.exe', 'scripts\ensure-windows-runtime.ps1', 'scripts\windows-common.ps1', 'Configure Luuna.cmd')) {
    if (!(Test-Path -LiteralPath (Join-Path $copied $required))) { throw ('Packaged resource missing after build: ' + $required) }
}
if (!$SkipPi -and !(Test-Path -LiteralPath (Join-Path $copied 'pi\node_modules\@earendil-works\pi-coding-agent\dist\cli.js'))) { throw 'Packaged Pi tree missing after build.' }
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
    host = [ordered]@{ os = [Environment]::OSVersion.VersionString; architecture = $env:PROCESSOR_ARCHITECTURE; rust = $rustVersion; node = $nodeVersion; pi = $piVersion }
    signed = $signed
    webview_install_mode = 'downloadBootstrapper'
    prerequisites_on_target = @('WebView2 Runtime (bootstrapped by the installer when absent)', 'Node.js 24.19 or newer on PATH for the pinned Pi engine', 'Git 2.43 or newer on PATH', 'Python 3 for Python check recipes', 'a provider key saved with Configure Luuna.cmd')
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
