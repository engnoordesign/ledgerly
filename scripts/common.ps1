# Shared helpers for the Ledgerly launcher and setup scripts.
# ASCII only on purpose: Windows PowerShell 5.1 reads BOM-less files as ANSI.

$script:Root      = Split-Path -Parent $PSScriptRoot
$script:IndexPath = Join-Path $script:Root 'index.html'
$script:IconPath  = Join-Path $script:Root 'assets\ledgerly.ico'

function Get-LedgerlyUrl {
    # file:///D:/systems%20&%20apps/ledgerly/index.html
    # Spaces, ampersands and non-English folder names are escaped by System.Uri.
    return ([System.Uri]$script:IndexPath).AbsoluteUri
}

function Find-AppBrowser {
    # A Chromium browser can open Ledgerly as a standalone app window (no tabs, no address bar).
    $pf86 = ${env:ProgramFiles(x86)}
    $known = @(
        @{ Name = 'Microsoft Edge'; Path = "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe" },
        @{ Name = 'Microsoft Edge'; Path = "$pf86\Microsoft\Edge\Application\msedge.exe" },
        @{ Name = 'Google Chrome';  Path = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" },
        @{ Name = 'Google Chrome';  Path = "$pf86\Google\Chrome\Application\chrome.exe" },
        @{ Name = 'Google Chrome';  Path = "$env:LocalAppData\Google\Chrome\Application\chrome.exe" },
        @{ Name = 'Brave';          Path = "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe" },
        @{ Name = 'Brave';          Path = "$env:LocalAppData\BraveSoftware\Brave-Browser\Application\brave.exe" }
    )
    foreach ($b in $known) {
        if ($b.Path -and (Test-Path -LiteralPath $b.Path)) { return $b }
    }
    # Fall back to the registered "App Paths" entries
    foreach ($entry in @(@('msedge.exe', 'Microsoft Edge'), @('chrome.exe', 'Google Chrome'))) {
        try {
            $p = (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\$($entry[0])" -ErrorAction Stop).'(default)'
            if ($p -and (Test-Path -LiteralPath $p)) { return @{ Name = $entry[1]; Path = $p } }
        } catch { }
    }
    return $null
}

function Start-Ledgerly {
    # Opens the app and returns the name of what it opened in.
    $b = Find-AppBrowser
    if ($b) {
        Start-Process -FilePath $b.Path -ArgumentList ('--app=' + (Get-LedgerlyUrl))
        return $b.Name
    }
    Start-Process -FilePath $script:IndexPath   # the default browser
    return 'your default browser'
}
