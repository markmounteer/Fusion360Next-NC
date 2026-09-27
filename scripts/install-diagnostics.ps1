# SPDX-License-Identifier: MIT
# Install a current-user, hidden log collector. No admin rights or network access.
[CmdletBinding()]
param([switch]$Uninstall)
$ErrorActionPreference = 'Stop'
$install = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Fusion360Next-NC'
$scriptPath = Join-Path $install 'collect-diagnostics.ps1'
$shortcut = Join-Path ([Environment]::GetFolderPath('Startup')) 'Fusion360Next-NC Diagnostics.lnk'
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

# Stop only this exact installed collector, never an arbitrary PID from a file.
Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" | Where-Object {
    $_.CommandLine -and $_.CommandLine.Contains('"' + $scriptPath + '"') -and $_.CommandLine.Contains('-Watch')
} | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction Stop }

if ($Uninstall) {
    if (Test-Path -LiteralPath $shortcut) { Remove-Item -LiteralPath $shortcut }
    Write-Output "Collector stopped and startup shortcut removed. Saved reports remain at $install\diagnostics."
    return
}
[IO.Directory]::CreateDirectory($install) | Out-Null
if ([IO.Path]::GetFullPath($PSScriptRoot) -ne [IO.Path]::GetFullPath($install)) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'collect-diagnostics.ps1') -Destination $scriptPath -Force
    Copy-Item -LiteralPath $PSCommandPath -Destination (Join-Path $install 'install-diagnostics.ps1') -Force
}
$arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $scriptPath + '" -Watch'
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($shortcut)
$link.TargetPath = $powershell
$link.Arguments = $arguments
$link.WorkingDirectory = $install
$link.WindowStyle = 7
$link.Description = 'Archive local Next-NC Fusion post logs; no uploads.'
$link.Save()
Start-Process -FilePath $powershell -ArgumentList $arguments -WindowStyle Hidden
Write-Output "Collector installed and started. Reports: $install\diagnostics\latest-error.txt"
Write-Output "Starts at sign-in. To stop and disable: run install-diagnostics.ps1 -Uninstall."
