# Decrypt only in this process, run a repository smoke, then clear its key binding.
[CmdletBinding()]
param(
    [ValidateSet('m1', 'm3', 'windows-workflow')][string]$Smoke = 'windows-workflow',
    [string]$Model = 'openai/gpt-4.1-mini',
    [Parameter(Mandatory = $true)][string]$Out,
    [string]$Checkout = (Split-Path -Parent $PSScriptRoot),
    [string]$Runtime
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-common.ps1')
$paths = Get-LuunaWindowsPaths
$root = Split-Path -Parent $PSScriptRoot
$record = Get-Content -LiteralPath (Join-Path $paths.Credentials 'provider.json') -Raw | ConvertFrom-Json
if ($record.provider -notin @('openrouter', 'openai', 'anthropic')) { throw 'Unsupported provider configuration' }
$secret = ConvertTo-SecureString $record.encrypted_key
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
$name = 'LUUNA_PI_' + $record.provider.ToUpperInvariant() + '_API_KEY'
$previous = [Environment]::GetEnvironmentVariable($name, 'Process')
$previousArgs = $env:LUUNA_PI_ARGS_JSON
try {
    [Environment]::SetEnvironmentVariable($name, [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer), 'Process')
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    $pi = Join-Path $root 'tools\pi\node_modules\@earendil-works\pi-coding-agent\dist\cli.js'
    $env:LUUNA_PI_ARGS_JSON = ConvertTo-Json -InputObject @($pi) -Compress
    $runtimeArgs = @()
    if ($Runtime) {
        if ($Smoke -eq "m3") { throw "The strict M3 harness builds its own clean revision." }
        $runtimeArgs = @("--runtime", (Resolve-Path -LiteralPath $Runtime).Path)
    }
    & $node (Join-Path $Checkout "scripts\$Smoke-smoke.mjs") --mode real --provider $record.provider --model $Model --pi $node --out $Out @runtimeArgs
    $result = $LASTEXITCODE
} finally {
    [Environment]::SetEnvironmentVariable($name, $previous, 'Process')
    $env:LUUNA_PI_ARGS_JSON = $previousArgs
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    $secret.Dispose()
}
exit $result
