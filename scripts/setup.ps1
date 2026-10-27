# First-time setup for Ledgerly on Windows. Run it with run-setup.bat (double-click).
#   run-setup.bat               set up, then open the app
#   run-setup.bat -NoLaunch     set up without opening the app
#   run-setup.bat -Uninstall    remove the shortcuts (your data is not touched)
[CmdletBinding()]
param(
    [switch]$Uninstall,
    [switch]$NoLaunch,
    [string]$ShortcutFolder   # optional: put one shortcut here instead of the Desktop and Start menu (used for testing)
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

function Say([string]$text, [string]$color = 'Gray') { Write-Host $text -ForegroundColor $color }
function Step([int]$n, [string]$text) { Write-Host ''; Write-Host "[$n/4] $text" -ForegroundColor Cyan }

$desktop   = [Environment]::GetFolderPath('DesktopDirectory')
$startMenu = [Environment]::GetFolderPath('Programs')
if ($ShortcutFolder) {
    New-Item -ItemType Directory -Force -Path $ShortcutFolder | Out-Null
    $links = @((Join-Path $ShortcutFolder 'Ledgerly.lnk'))
} else {
    $links = @((Join-Path $desktop 'Ledgerly.lnk'), (Join-Path $startMenu 'Ledgerly.lnk'))
}

Write-Host ''
Say '  Ledgerly setup' 'White'
Say "  Folder: $Root" 'DarkGray'

# ---------- uninstall ----------
if ($Uninstall) {
    Write-Host ''
    foreach ($l in $links) {
        if (Test-Path -LiteralPath $l) { Remove-Item -LiteralPath $l -Force; Say "  Removed  $l" 'Green' }
        else { Say "  Not found  $l" 'DarkGray' }
    }
    Write-Host ''
    Say '  Shortcuts removed. Your data is untouched: it lives in your browser.'
    Say '  Run run-setup.bat again any time to bring them back.'
    exit 0
}

# ---------- 1. app files ----------
Step 1 'Checking the app files'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not (Test-Path -LiteralPath $IconPath) -and $node) {
    Say '  The icon is missing. Drawing it now...' 'Yellow'
    & node (Join-Path $Root 'tools\make-icon.js') | Out-Null
}
$required = @('index.html', 'css\styles.css', 'js\app.js', 'js\engine.js', 'js\lang-ar.js')
$missing = @($required | Where-Object { -not (Test-Path -LiteralPath (Join-Path $Root $_)) })
if ($missing.Count -gt 0) {
    Say "  Missing: $($missing -join ', ')" 'Red'
    Say '  Run this from the full Ledgerly folder (do not copy run-setup.bat on its own).' 'Red'
    exit 1
}
$count = 1 + (Get-ChildItem -LiteralPath (Join-Path $Root 'css'), (Join-Path $Root 'js') -Recurse -File | Measure-Object).Count
Say "  OK  $count app files found" 'Green'
if (-not (Test-Path -LiteralPath $IconPath)) { Say '  Note: no icon file, the shortcut will use a default icon.' 'Yellow' }

# ---------- 2. this computer ----------
Step 2 'Checking this computer'
$browser = Find-AppBrowser
if ($browser) { Say "  OK  $($browser.Name) found. Ledgerly opens in its own app window." 'Green' }
else { Say '  No Edge, Chrome or Brave found. Ledgerly will open in your default browser.' 'Yellow' }
if ($node) { Say "  OK  Node.js $(& node --version) found (optional, only used by the self-check below)." 'Green' }
else { Say '  Node.js not found. That is fine: the app itself needs nothing installed.' 'DarkGray' }

# ---------- 3. shortcuts ----------
Step 3 'Creating the app icon'
$ws = New-Object -ComObject WScript.Shell
foreach ($l in $links) {
    try {
        $s = $ws.CreateShortcut($l)
        if ($browser) { $s.TargetPath = $browser.Path; $s.Arguments = '--app=' + (Get-LedgerlyUrl) }
        else { $s.TargetPath = $IndexPath }
        $s.WorkingDirectory = $Root
        if (Test-Path -LiteralPath $IconPath) { $s.IconLocation = "$IconPath,0" }
        $s.Description = 'Ledgerly - private budget and accounting'
        $s.Save()
        Say "  OK  $l" 'Green'
    } catch {
        Say "  Could not create $l : $($_.Exception.Message)" 'Yellow'
    }
}

# ---------- 4. self-check ----------
Step 4 'Self-check'
if ($node) {
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try {
        $r = @(& node (Join-Path $Root 'tools\engine-test.js') 2>&1 | ForEach-Object { "$_" })
        $i = @(& node (Join-Path $Root 'tools\check-i18n.js') 2>&1 | ForEach-Object { "$_" })
    } finally { $ErrorActionPreference = $prev }
    $last = ($r | Where-Object { $_ -match 'passed' } | Select-Object -Last 1)
    if ($last -match ', 0 failed') { Say "  OK  accounting checks: $last" 'Green' } else { Say "  Check this: $last" 'Yellow' }
    $line = ($i | Where-Object { $_ -match 'strings in use' } | Select-Object -First 1)
    if ($line -and -not ($i -match 'MISSING')) { Say "  OK  Arabic translation: $line" 'Green' } else { Say '  Some Arabic strings are missing. Run: node tools\check-i18n.js' 'Yellow' }
} else {
    Say '  Skipped (needs Node.js). The app does not need it.' 'DarkGray'
}

# ---------- done ----------
Write-Host ''
Say '  All set.' 'Green'
Say '  - Open Ledgerly any time from the icon on your Desktop, or search "Ledgerly" in the Start menu.'
Say '  - For one-click access: right-click the icon and choose "Pin to taskbar".'
Say '  - Your data is stored in this browser on this PC. Use Settings > Download backup now and then.'
if (-not $NoLaunch) {
    Write-Host ''
    $opened = Start-Ledgerly
    Say "  Opening Ledgerly in $opened ..." 'Cyan'
}
exit 0
