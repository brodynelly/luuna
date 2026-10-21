# Explicit authenticated stop; never force-terminate an unrelated process.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-common.ps1')
$paths = Get-LuunaWindowsPaths
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
$file = Join-Path $paths.Credentials 'connection.json'
$connection = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
if ($connection.runtime_url -ne 'http://127.0.0.1:4242') { throw 'Unexpected runtime endpoint in local connection metadata.' }
$secret = ConvertTo-SecureString $connection.encrypted_token
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try {
    $headers = @{ Authorization = 'Bearer ' + [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    $reply = Invoke-RestMethod -Method Post -Uri ($connection.runtime_url + '/api/v1/shutdown') -Headers $headers -MaximumRedirection 0 -TimeoutSec 15
    if ($reply.status -ne 'shutting_down') { throw 'The runtime did not accept shutdown.' }
    $process = Get-Process -Id $connection.runtime_pid -ErrorAction SilentlyContinue
    if ($process) {
        if ($process.Path -ne $connection.runtime_path) { throw 'Runtime process identity changed; no process was terminated.' }
        if (!$process.WaitForExit(15000)) { throw 'Runtime has not exited after 15 seconds; no force termination was attempted.' }
    }
    Write-Output 'Luuna runtime stopped cleanly. Work and evidence are preserved; the client may stay open.'
} finally {
    $headers = $null
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    $secret.Dispose()
}
