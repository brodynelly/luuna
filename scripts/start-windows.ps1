# Development launcher. The native app owns automatic startup and connection.
[CmdletBinding()]
param([string]$DataDirectory, [switch]$Native)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-common.ps1')
$paths = Get-LuunaWindowsPaths
$root = Split-Path -Parent $PSScriptRoot
$desktop = Join-Path $root 'apps\desktop\src-tauri\target\debug\luuna-desktop.exe'
if ($Native) {
    if (!(Test-Path -LiteralPath $desktop)) { throw 'Build the native desktop first; see docs/WINDOWS-VERIFICATION.md.' }
    if ($DataDirectory) { $null = & (Join-Path $PSScriptRoot 'ensure-windows-runtime.ps1') -DataDirectory $DataDirectory }
    $client = Get-Process luuna-desktop -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $desktop } | Select-Object -First 1
    if ($client -and !$DataDirectory) { $null = & (Join-Path $PSScriptRoot 'ensure-windows-runtime.ps1') }
    if (!$client) { Start-Process -FilePath $desktop -WorkingDirectory $root -WindowStyle Normal | Out-Null }
    Write-Output 'Luuna desktop opened. The app starts and connects to your local runtime automatically.'
    return
}
if (Get-NetTCPConnection -State Listen -LocalPort 1420 -ErrorAction SilentlyContinue) { throw 'Port 1420 is in use. Open the existing browser client or use -Native.' }
$connection = & (Join-Path $PSScriptRoot 'ensure-windows-runtime.ps1') -DataDirectory $DataDirectory
$token = $connection.token
$local = $paths.Logs
$node = (Get-Command node.exe -ErrorAction Stop).Source
$vite = Join-Path $root 'node_modules\vite\bin\vite.js'
$client = Start-Process -FilePath $node -ArgumentList @(('"'+$vite+'"'),'--host','127.0.0.1','--port','1420','--strictPort') -WorkingDirectory (Join-Path $root 'apps\desktop') -WindowStyle Hidden -RedirectStandardError (Join-Path $local 'client-error.log') -RedirectStandardOutput (Join-Path $local 'client.log') -PassThru
if (Get-Process powershell -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne $PID -and $_.MainWindowTitle -eq 'Luuna - local connection' }) {
    Write-Output 'Luuna is running; the existing local connection window contains the current token.'
    return
}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Luuna - local connection'
$form.ClientSize = New-Object System.Drawing.Size(500,195)
$form.StartPosition = 'CenterScreen'
$label = New-Object System.Windows.Forms.Label
$label.Location = New-Object System.Drawing.Point(18,18)
$label.Size = New-Object System.Drawing.Size(464,65)
$label.Text = "Luuna is running. Open the client, copy this local connection token, and paste it into its connection form. Runtime: http://127.0.0.1:4242. Closing this window leaves the service running."
$field = New-Object System.Windows.Forms.TextBox
$field.Location = New-Object System.Drawing.Point(18,90)
$field.Width=464
$field.Text=$token
$field.ReadOnly=$true
$field.UseSystemPasswordChar=$true
$copy = New-Object System.Windows.Forms.Button
$copy.Location = New-Object System.Drawing.Point(18,135)
$copy.Width=180
$copy.Text='Copy connection token'
$copy.Add_Click({ [System.Windows.Forms.Clipboard]::SetText($field.Text) })
$open = New-Object System.Windows.Forms.Button
$open.Location = New-Object System.Drawing.Point(302,135)
$open.Width=180
$open.Text='Open Luuna'
$open.Add_Click({ if ($Native) { if ($client.HasExited) { Start-Process -FilePath $desktop -WindowStyle Normal } } else { Start-Process 'http://127.0.0.1:1420' } })
$form.Controls.AddRange(@($label,$field,$copy,$open))
if (!$Native) { Start-Process 'http://127.0.0.1:1420' }
[void]$form.ShowDialog()
$field.Clear()
$form.Dispose()
$token=$null
