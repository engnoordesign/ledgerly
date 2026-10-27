# Opens Ledgerly in its own app window. Used by Ledgerly.bat. No setup needed.
# Runs hidden, so any problem is shown in a message box instead of a console.
$ErrorActionPreference = 'Stop'
try {
    . (Join-Path $PSScriptRoot 'common.ps1')
    if (-not (Test-Path -LiteralPath $IndexPath)) {
        throw "Cannot find index.html in:`n$Root`n`nKeep the scripts folder next to index.html."
    }
    [void](Start-Ledgerly)
} catch {
    Add-Type -AssemblyName System.Windows.Forms
    [void][System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Ledgerly', 'OK', 'Error')
    exit 1
}
