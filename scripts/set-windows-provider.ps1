# Saves a provider key with Windows DPAPI; no plaintext secret is written to disk.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-common.ps1')
$paths = Get-LuunaWindowsPaths
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Luuna - provider setup'
$form.ClientSize = New-Object System.Drawing.Size(490, 280)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.TopMost = $true
$label = New-Object System.Windows.Forms.Label
$label.Text = 'Provider'
$label.Location = New-Object System.Drawing.Point(20, 18)
$label.AutoSize = $true
$form.Controls.Add($label)
$provider = New-Object System.Windows.Forms.ComboBox
$provider.Location = New-Object System.Drawing.Point(20, 40)
$provider.Width = 450
$provider.DropDownStyle = 'DropDownList'
$provider.Items.AddRange(@('openrouter', 'openai', 'anthropic'))
$provider.SelectedIndex = 0
$form.Controls.Add($provider)
$keyLabel = New-Object System.Windows.Forms.Label
$keyLabel.Text = 'API key (hidden; never sent through chat)'
$keyLabel.Location = New-Object System.Drawing.Point(20, 80)
$keyLabel.AutoSize = $true
$form.Controls.Add($keyLabel)
$key = New-Object System.Windows.Forms.TextBox
$key.Location = New-Object System.Drawing.Point(20, 104)
$key.Width = 450
$key.UseSystemPasswordChar = $true
$form.Controls.Add($key)
$status = New-Object System.Windows.Forms.Label
$status.Location = New-Object System.Drawing.Point(20, 145)
$status.Size = New-Object System.Drawing.Size(450, 62)
$status.Text = 'Encrypted for your Windows account in Local AppData. Luuna will use it for provider requests. Saving does not test or spend credit.'
$form.Controls.Add($status)
$save = New-Object System.Windows.Forms.Button
$save.Text = 'Save key'
$save.Location = New-Object System.Drawing.Point(350, 224)
$save.Width = 120
$save.Add_Click({
    if ([string]::IsNullOrWhiteSpace($key.Text)) {
        $status.Text = 'Enter an API key first.'
        return
    }
    try {
        $directory = $paths.Credentials
        [System.IO.Directory]::CreateDirectory($directory) | Out-Null
        $secret = ConvertTo-SecureString $key.Text.Trim() -AsPlainText -Force
        $encrypted = ConvertFrom-SecureString $secret
        $record = @{ provider = [string]$provider.SelectedItem; encrypted_key = $encrypted }
        $destination = Join-Path $directory 'provider.json'
        $temporary = Join-Path $directory 'provider.pending.json'
        [System.IO.File]::WriteAllText($temporary, ($record | ConvertTo-Json))
        Move-Item -LiteralPath $temporary -Destination $destination -Force
        $key.Clear()
        $secret.Dispose()
        $status.Text = 'Saved encrypted for your Windows account. You may close this window; Luuna can now load the key.'
        $save.Enabled = $false
    } catch {
        $status.Text = 'Could not save the key. No secret details are displayed. Check that your .luuna credentials folder is writable.'
    }
})
$form.Controls.Add($save)
$form.AcceptButton = $save
[void]$form.ShowDialog()
$key.Clear()
$form.Dispose()
