<#
.SYNOPSIS
  Win10-Speedup - entschlackt Windows 10 (Telemetrie, Bloat, Hintergrundlast) und richtet
  eine blitzschnelle Dateisuche (Everything + EverythingToolbar) als Ersatz fuer die
  Windows-Suche ein.

.DESCRIPTION
  * Legt vorher einen Wiederherstellungspunkt an.
  * Merkt sich JEDEN geaenderten Registry-Wert / Dienst / Task -> mit -Undo rueckgaengig machbar.
  * Defender, Firewall und Windows Update werden NICHT angefasst.

.PARAMETER Mode
  Safe = nur unkritische Tweaks vorausgewaehlt, Max = auch die haerteren (Standard).
.PARAMETER NoMenu
  Keine Auswahl/Rueckfragen, es laufen alle Tweaks, die fuer den Mode vorausgewaehlt sind.
.PARAMETER OnlySearch
  Nur die schnelle Suche (Everything + Toolbar) einrichten.
.PARAMETER Undo
  Alle vom Skript gemachten Aenderungen zurueckdrehen (soweit moeglich).
.PARAMETER SkipRestorePoint
  Keinen Wiederherstellungspunkt anlegen.
.PARAMETER KeepWindowsSearch
  Bei der Such-Installation den Windows-Suchdienst (WSearch) NICHT abschalten.
#>
#Requires -Version 5.1
[CmdletBinding()]
param(
    [ValidateSet('Safe', 'Max')][string]$Mode = 'Max',
    [switch]$NoMenu,
    [switch]$OnlySearch,
    [switch]$Undo,
    [switch]$SkipRestorePoint,
    [switch]$KeepWindowsSearch
)

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

# ----------------------------------------------------------------------------
# Adminrechte
# ----------------------------------------------------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host 'Starte neu mit Administratorrechten ...' -ForegroundColor Yellow
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $PSCommandPath))
    foreach ($kv in $PSBoundParameters.GetEnumerator()) {
        if ($kv.Value -is [switch]) {
            if ($kv.Value.IsPresent) { $argList += "-$($kv.Key)" }
        } else {
            $argList += "-$($kv.Key)"
            $argList += [string]$kv.Value
        }
    }
    Start-Process -FilePath (Get-Process -Id $PID).Path -ArgumentList $argList -Verb RunAs
    exit
}

# ----------------------------------------------------------------------------
# Zustand / Logging
# ----------------------------------------------------------------------------
$script:StateDir = Join-Path $env:ProgramData 'Win10Speedup'
$script:StateFile = Join-Path $script:StateDir 'state.json'
$script:Items = [ordered]@{}
$script:Warnings = New-Object System.Collections.Generic.List[string]
$script:NeedExplorerRestart = $false
$script:IsLaptop = $false

function Write-Step([string]$m) { Write-Host "  [+] $m" -ForegroundColor Green }
function Write-Info([string]$m) { Write-Host "      $m" -ForegroundColor Gray }
function Add-Warn([string]$m) { Write-Host "  [!] $m" -ForegroundColor Yellow; $script:Warnings.Add($m) }

function Save-State {
    try {
        $json = ConvertTo-Json -InputObject @($script:Items.Values) -Depth 6
        [IO.File]::WriteAllText($script:StateFile, $json, (New-Object Text.UTF8Encoding $false))
    } catch {
        Write-Host "  [!] State konnte nicht gespeichert werden: $($_.Exception.Message)" -ForegroundColor Red
    }
}

function Initialize-State {
    New-Item -ItemType Directory -Path $script:StateDir -Force | Out-Null
    if (Test-Path -LiteralPath $script:StateFile) {
        try {
            $loaded = @(Get-Content -LiteralPath $script:StateFile -Raw -Encoding UTF8 | ConvertFrom-Json)
            foreach ($r in $loaded) { if ($r -and $r.Key) { $script:Items[$r.Key] = $r } }
        } catch {
            Add-Warn "Alte state.json nicht lesbar: $($_.Exception.Message)"
        }
    }
}

# Merkt sich den ORIGINALZUSTAND nur beim allerersten Mal (auch ueber mehrere Laeufe hinweg).
function Add-StateItem {
    param([string]$Key, [hashtable]$Data)
    if ($script:Items.Contains($Key)) { return }
    $Data['Key'] = $Key
    $script:Items[$Key] = [pscustomobject]$Data
    Save-State
}

# ----------------------------------------------------------------------------
# Registry-Helfer (mit Original-Sicherung)
# ----------------------------------------------------------------------------
function Save-RegOriginal {
    param([string]$Path, [string]$Name)
    $key = "REG|$Path|$Name"
    if ($script:Items.Contains($key)) { return }
    $d = @{ Kind = 'Reg'; Path = $Path; Name = $Name; Existed = $false; Type = $null; Value = $null }
    $k = Get-Item -LiteralPath $Path -ErrorAction SilentlyContinue
    if ($k -and ($k.GetValueNames() -contains $Name)) {
        $d.Existed = $true
        $d.Type = $k.GetValueKind($Name).ToString()
        $v = $k.GetValue($Name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        if ($v -is [byte[]]) { $v = [Convert]::ToBase64String($v) }
        $d.Value = $v
    }
    Add-StateItem $key $d
}

function Set-Reg {
    param([string]$Path, [string]$Name, $Value, [string]$Type = 'DWord')
    try {
        if (-not (Test-Path -LiteralPath $Path)) { New-Item -Path $Path -Force -ErrorAction Stop | Out-Null }
        Save-RegOriginal $Path $Name
        New-ItemProperty -LiteralPath $Path -Name $Name -Value $Value -PropertyType $Type -Force -ErrorAction Stop | Out-Null
    } catch {
        Add-Warn "Registry: $Path\$Name -> $($_.Exception.Message)"
    }
}

function Remove-Reg {
    param([string]$Path, [string]$Name)
    try {
        $k = Get-Item -LiteralPath $Path -ErrorAction SilentlyContinue
        if ($k -and ($k.GetValueNames() -contains $Name)) {
            Save-RegOriginal $Path $Name
            Remove-ItemProperty -LiteralPath $Path -Name $Name -ErrorAction Stop
        }
    } catch {
        Add-Warn "Registry entfernen: $Path\$Name -> $($_.Exception.Message)"
    }
}

# ----------------------------------------------------------------------------
# Dienste / Aufgaben / Features
# ----------------------------------------------------------------------------
function Set-ServiceStart {
    param(
        [string]$Name,
        [ValidateSet('Disabled', 'Manual', 'Automatic')][string]$Start,
        [switch]$Stop
    )
    $svcKey = "HKLM:\SYSTEM\CurrentControlSet\Services\$Name"
    if (-not (Test-Path -LiteralPath $svcKey)) { return }
    $p = Get-ItemProperty -LiteralPath $svcKey -ErrorAction SilentlyContinue
    Add-StateItem "SVC|$Name" @{ Kind = 'Svc'; Name = $Name; Start = [int]$p.Start; Delayed = [int]$p.DelayedAutostart }
    $scMode = switch ($Start) { 'Disabled' { 'disabled' } 'Manual' { 'demand' } 'Automatic' { 'auto' } }
    $regVal = switch ($Start) { 'Disabled' { 4 } 'Manual' { 3 } 'Automatic' { 2 } }
    $done = $false
    try {
        Set-Service -Name $Name -StartupType $Start -ErrorAction Stop
        $done = $true
    } catch {
        & sc.exe config $Name start= $scMode | Out-Null
        $done = ($LASTEXITCODE -eq 0)
    }
    if (-not $done) {
        # Vorlagen-Dienste (z.B. OneSyncSvc) gibt es nur als Registry-Schluessel
        try {
            Set-ItemProperty -LiteralPath $svcKey -Name Start -Value $regVal -Type DWord -ErrorAction Stop
            $done = $true
        } catch {
            Add-Warn "Dienst $Name konnte nicht auf '$Start' gesetzt werden."
            return
        }
    }
    if ($Stop) { Stop-Service -Name $Name -Force -ErrorAction SilentlyContinue }
    Write-Info "Dienst $Name -> $Start"
}

function Disable-TaskSafe {
    param([string]$Path, [string]$Name = '*')
    $tasks = @(Get-ScheduledTask -TaskPath $Path -TaskName $Name -ErrorAction SilentlyContinue)
    foreach ($t in $tasks) {
        if ($t.State -eq 'Disabled') { continue }
        Add-StateItem "TASK|$($t.TaskPath)$($t.TaskName)" @{ Kind = 'Task'; Path = $t.TaskPath; Name = $t.TaskName }
        try {
            Disable-ScheduledTask -TaskPath $t.TaskPath -TaskName $t.TaskName -ErrorAction Stop | Out-Null
            Write-Info "Aufgabe aus: $($t.TaskPath)$($t.TaskName)"
        } catch {
            Add-Warn "Aufgabe $($t.TaskName): $($_.Exception.Message)"
        }
    }
}

$script:FeatureCache = $null
function Disable-FeatureSafe {
    param([string]$Name)
    if (-not $script:FeatureCache) {
        $script:FeatureCache = @(Get-WindowsOptionalFeature -Online -ErrorAction SilentlyContinue)
    }
    $f = $script:FeatureCache | Where-Object { $_.FeatureName -eq $Name -and $_.State -eq 'Enabled' }
    if (-not $f) { return }
    Add-StateItem "FEAT|$Name" @{ Kind = 'Feature'; Name = $Name }
    try {
        Disable-WindowsOptionalFeature -Online -FeatureName $Name -NoRestart -ErrorAction Stop | Out-Null
        Write-Info "Feature entfernt: $Name"
    } catch {
        Add-Warn "Feature ${Name}: $($_.Exception.Message)"
    }
}

# ----------------------------------------------------------------------------
# Apps entfernen
# ----------------------------------------------------------------------------
$script:ProtectedApps = @(
    'Microsoft.WindowsStore', 'Microsoft.StorePurchaseApp', 'Microsoft.DesktopAppInstaller',
    'Microsoft.VCLibs*', 'Microsoft.NET.*', 'Microsoft.UI.Xaml*', 'Microsoft.Services.Store.Engagement',
    'Microsoft.WindowsCalculator', 'Microsoft.Windows.Photos', 'Microsoft.WindowsTerminal',
    'Microsoft.ScreenSketch', 'Microsoft.HEIFImageExtension', 'Microsoft.WebpImageExtension',
    'Microsoft.VP9VideoExtensions', 'Microsoft.WindowsCamera', 'Microsoft.SecHealthUI',
    'Microsoft.Windows.ShellExperienceHost', 'Microsoft.Windows.StartMenuExperienceHost',
    'Microsoft.AAD.BrokerPlugin', 'Microsoft.LockApp', 'Microsoft.Win32WebViewHost',
    'windows.immersivecontrolpanel', 'Microsoft.WindowsAppRuntime*', 'Microsoft.MicrosoftEdge*'
)
$script:ProvisionedCache = $null

function Test-ProtectedApp([string]$Name) {
    foreach ($p in $script:ProtectedApps) { if ($Name -like $p) { return $true } }
    return $false
}

function Remove-AppxByName {
    param([string[]]$Patterns)
    if ($null -eq $script:ProvisionedCache) {
        $script:ProvisionedCache = @(Get-AppxProvisionedPackage -Online -ErrorAction SilentlyContinue)
    }
    foreach ($pat in $Patterns) {
        $pkgs = @(Get-AppxPackage -AllUsers -Name $pat -ErrorAction SilentlyContinue |
                Where-Object { -not (Test-ProtectedApp $_.Name) -and -not $_.NonRemovable })
        foreach ($p in $pkgs) {
            try {
                Remove-AppxPackage -Package $p.PackageFullName -AllUsers -ErrorAction Stop
                Write-Info "App entfernt: $($p.Name)"
            } catch {
                Write-Info "App nicht entfernbar: $($p.Name)"
            }
        }
        $prov = @($script:ProvisionedCache | Where-Object { $_.DisplayName -like $pat -and -not (Test-ProtectedApp $_.DisplayName) })
        foreach ($pp in $prov) {
            Remove-AppxProvisionedPackage -Online -PackageName $pp.PackageName -ErrorAction SilentlyContinue | Out-Null
        }
    }
}

# ----------------------------------------------------------------------------
# Kleine Hilfsfunktionen
# ----------------------------------------------------------------------------
function Confirm-YesNo {
    param([string]$Question, [bool]$Default = $true)
    $hint = if ($Default) { 'J/n' } else { 'j/N' }
    $a = Read-Host "$Question [$hint]"
    if ([string]::IsNullOrWhiteSpace($a)) { return $Default }
    return ($a.Trim().ToLower() -in @('j', 'ja', 'y', 'yes'))
}

# Liefert SSD / HDD / Unspecified / Unknown fuer das Systemlaufwerk
function Get-SystemDiskType {
    try {
        $part = Get-Partition -DriveLetter ($env:SystemDrive.TrimEnd(':')) -ErrorAction Stop
        $disk = Get-PhysicalDisk -ErrorAction Stop | Where-Object { $_.DeviceId -eq [string]$part.DiskNumber } | Select-Object -First 1
        if ($disk) { return [string]$disk.MediaType }
    } catch { }
    return 'Unknown'
}

function New-Shortcut {
    param([string]$Path, [string]$Target, [string]$Arguments = '', [string]$Description = '')
    try {
        $dir = Split-Path -Parent $Path
        if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        $sh = New-Object -ComObject WScript.Shell
        $lnk = $sh.CreateShortcut($Path)
        $lnk.TargetPath = $Target
        $lnk.Arguments = $Arguments
        $lnk.WorkingDirectory = Split-Path -Parent $Target
        $lnk.Description = $Description
        $lnk.IconLocation = "$Target,0"
        $lnk.Save()
        Add-StateItem "FILE|$Path" @{ Kind = 'File'; Path = $Path }
        return $true
    } catch {
        Add-Warn "Verknuepfung ${Path}: $($_.Exception.Message)"
        return $false
    }
}

# Setzt "key=value" in einer INI-Datei (Section-lose Everything.ini), BOM wird beibehalten.
function Set-IniValue {
    param([string]$Path, [string]$Key, [string]$Value)
    $hadBom = $false
    if (Test-Path -LiteralPath $Path) {
        $bytes = [IO.File]::ReadAllBytes($Path)
        $hadBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
        $lines = @([IO.File]::ReadAllLines($Path, (New-Object Text.UTF8Encoding $false)))
        if ($hadBom -and $lines.Count -gt 0) { $lines[0] = $lines[0].TrimStart([char]0xFEFF) }
    } else {
        $lines = @('[Everything]')
    }
    $found = $false
    $pattern = '^\s*' + [regex]::Escape($Key) + '\s*='
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match $pattern) { $lines[$i] = "$Key=$Value"; $found = $true; break }
    }
    if (-not $found) { $lines += "$Key=$Value" }
    $dir = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    [IO.File]::WriteAllLines($Path, $lines, (New-Object Text.UTF8Encoding $hadBom))
}

# Traegt JSON-Schluessel in eine (kommentartolerante) VS-Code-settings.json ein.
function Set-JsonSettingText {
    param([string]$Text, [string]$Key, [string]$RawValue)
    $keyEsc = [regex]::Escape('"' + $Key + '"')
    if ($Text -match ($keyEsc + '\s*:\s*("[^"]*"|[^,\r\n}]+)')) {
        return [regex]::Replace($Text, ($keyEsc + '\s*:\s*("[^"]*"|[^,\r\n}\s]+)'), ('"' + $Key + '": ' + $RawValue), 1)
    }
    $idx = $Text.IndexOf('{')
    if ($idx -lt 0) { return "{`r`n    `"$Key`": $RawValue`r`n}`r`n" }
    $rest = $Text.Substring($idx + 1)
    $stripped = ($rest -replace '(?s)/\*.*?\*/', '' -replace '(?m)^\s*//.*$', '').Trim()
    $comma = if ($stripped -eq '}' -or $stripped -eq '') { '' } else { ',' }
    return $Text.Substring(0, $idx + 1) + "`r`n    `"$Key`": $RawValue$comma" + $rest
}

# ----------------------------------------------------------------------------
# Wiederherstellungspunkt
# ----------------------------------------------------------------------------
function New-SafetyRestorePoint {
    Write-Host "`nLege Wiederherstellungspunkt an ..." -ForegroundColor Cyan
    try {
        Enable-ComputerRestore -Drive "$env:SystemDrive\" -ErrorAction Stop
        $p = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\SystemRestore'
        $old = (Get-ItemProperty -LiteralPath $p -Name SystemRestorePointCreationFrequency -ErrorAction SilentlyContinue).SystemRestorePointCreationFrequency
        Set-ItemProperty -LiteralPath $p -Name SystemRestorePointCreationFrequency -Value 0 -Type DWord -Force
        Checkpoint-Computer -Description 'Win10-Speedup (vor den Aenderungen)' -RestorePointType MODIFY_SETTINGS -ErrorAction Stop
        if ($null -eq $old) { Remove-ItemProperty -LiteralPath $p -Name SystemRestorePointCreationFrequency -ErrorAction SilentlyContinue }
        else { Set-ItemProperty -LiteralPath $p -Name SystemRestorePointCreationFrequency -Value $old -Type DWord -Force }
        Write-Step 'Wiederherstellungspunkt erstellt.'
        return $true
    } catch {
        Add-Warn "Wiederherstellungspunkt fehlgeschlagen: $($_.Exception.Message)"
        return $false
    }
}

# ============================================================================
# TWEAKS
# ============================================================================

function Invoke-TweakTelemetry {
    foreach ($s in 'DiagTrack', 'dmwappushservice', 'diagnosticshub.standardcollector.service', 'WerSvc') {
        Set-ServiceStart $s Disabled -Stop
    }
    $dc = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\DataCollection'
    Set-Reg $dc 'AllowTelemetry' 0
    Set-Reg $dc 'DoNotShowFeedbackNotifications' 1
    Set-Reg $dc 'DisableOneSettingsDownloads' 1
    Set-Reg $dc 'LimitDiagnosticLogCollection' 1
    Set-Reg $dc 'LimitDumpCollection' 1
    Set-Reg 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\DataCollection' 'AllowTelemetry' 0
    $ac = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\AppCompat'
    Set-Reg $ac 'AITEnable' 0
    Set-Reg $ac 'DisableInventory' 1
    Set-Reg $ac 'DisablePCA' 1
    Set-Reg $ac 'DisableUAR' 1
    Set-Reg 'HKLM:\SOFTWARE\Policies\Microsoft\SQMClient\Windows' 'CEIPEnable' 0
    Set-Reg 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Windows Error Reporting' 'Disabled' 1
    Set-Reg 'HKLM:\SOFTWARE\Microsoft\Windows\Windows Error Reporting' 'Disabled' 1
    $sys = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\System'
    Set-Reg $sys 'EnableActivityFeed' 0
    Set-Reg $sys 'PublishUserActivities' 0
    Set-Reg $sys 'UploadUserActivities' 0
    Set-Reg $sys 'AllowCrossDeviceClipboard' 0
    Set-Reg 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\AdvertisingInfo' 'DisabledByGroupPolicy' 1
    Set-Reg 'HKCU:\Software\Microsoft\Windows\CurrentVersion\AdvertisingInfo' 'Enabled' 0
    Set-Reg 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Privacy' 'TailoredExperiencesWithDiagnosticDataEnabled' 0
    Set-Reg 'HKCU:\Control Panel\International\User Profile' 'HttpAcceptLanguageOptOut' 1
    Set-Reg 'HKCU:\Software\Microsoft\Siuf\Rules' 'NumberOfSIUFInPeriod' 0
    Set-Reg 'HKCU:\Software\Microsoft\InputPersonalization' 'RestrictImplicitInkCollection' 1
    Set-Reg 'HKCU:\Software\Microsoft\InputPersonalization' 'RestrictImplicitTextCollection' 1
    Set-Reg 'HKCU:\Software\Microsoft\InputPersonalization\TrainedDataStore' 'HarvestContacts' 0
    Set-Reg 'HKCU:\Software\Microsoft\Personalization\Settings' 'AcceptedPrivacyPolicy' 0
    Set-Reg 'HKCU:\Software\Microsoft\Speech_OneCore\Settings\OnlineSpeechPrivacy' 'HasAccepted' 0
    Set-Reg 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced' 'Start_TrackProgs' 0
    # Delivery Optimization: nur HTTP, kein Upload an fremde PCs
    Set-Reg 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\DeliveryOptimization' 'DODownloadMode' 0
    # Telemetrie-/Diagnose-Aufgaben
    $tasks = @(
        @('\Microsoft\Windows\Application Experience\', '*'),
        @('\Microsoft\Windows\Customer Experience Improvement Program\', '*'),
        @('\Microsoft\Windows\Feedback\Siuf\', '*'),
        @('\Microsoft\Windows\Windows Error Reporting\', '*'),
        @('\Microsoft\Windows\DiskDiagnostic\', 'Microsoft-Windows-DiskDiagnosticDataCollector'),
        @('\Microsoft\Windows\Autochk\', 'Proxy'),
        @('\Microsoft\Windows\NetTrace\', 'GatherNetworkInfo'),
        @('\Microsoft\Windows\PI\', 'Sqm-Tasks'),
        @('\Microsoft\Windows\Device Information\', 'Device'),
        @('\Microsoft\Windows\Maps\', '*'),
        @('\Microsoft\Windows\Shell\', 'FamilySafety*'),
        @('\Microsoft\Windows\CloudExperienceHost\', 'CreateObjectTask'),
        @('\Microsoft\Windows\Windows Media Sharing\', '*'),
        @('\Microsoft\Office\', 'OfficeTelemetry*')
    )
    foreach ($t in $tasks) { Disable-TaskSafe $t[0] $t[1] }
}

function Invoke-TweakAds {
    $cdm = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager'
    foreach ($n in 'ContentDeliveryAllowed', 'FeatureManagementEnabled', 'OemPreInstalledAppsEnabled',
        'PreInstalledAppsEnabled', 'PreInstalledAppsEverEnabled', 'SilentInstalledAppsEnabled',
        'SoftLandingEnabled', 'SystemPaneSuggestionsEnabled', 'RotatingLockScreenEnabled',
        'RotatingLockScreenOverlayEnabled', 'SubscribedContent-310093Enabled', 'SubscribedContent-338387Enabled',
        'SubscribedContent-338388Enabled', 'SubscribedContent-338389Enabled', 'SubscribedContent-338393Enabled',
        'SubscribedContent-353694Enabled', 'SubscribedContent-353696Enabled', 'SubscribedContent-353698Enabled',
        'SubscribedContent-88000326Enabled') {
        Set-Reg $cdm $n 0
    }
    Set-Reg 'HKCU:\Software\Microsoft\Windows\CurrentVersion\UserProfileEngagement' 'ScoobeSystemSettingEnabled' 0
    Set-Reg 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced' 'ShowSyncProviderNotifications' 0
    $cc = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\CloudContent'
    Set-Reg $cc 'DisableWindowsConsumerFeatures' 1
    Set-Reg $cc 'DisableSoftLanding' 1
    Set-Reg $cc 'DisableWindowsSpotlightFeatures' 1
    Set-Reg $cc 'DisableTailoredExperiencesWithDiagnosticData' 1
    Set-Reg $cc 'DisableCloudOptimizedContent' 1
    Set-Reg 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsCopilot' 'TurnOffWindowsCopilot' 1
    $script:NeedExplorerRestart = $true
}

function Invoke-TweakCortana {
    $s = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Search'
    Set-Reg $s 'SearchboxTaskbarMode' 0
    Set-Reg $s 'BingSearchEnabled' 0
    Set-Reg $s 'CortanaConsent' 0
    Set-Reg $s 'CanCortanaBeEnabled' 0
    Set-Reg $s 'AllowSearchToUseLocation' 0
    Set-Reg $s 'BackgroundAppGlobalToggle' 0
    $ws = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Windows Search'
    Set-Reg $ws 'AllowCortana' 0
    Set-Reg $ws 'AllowCortanaAboveLock' 0
    Set-Reg $ws 'AllowSearchToUseLocation' 0
    Set-Reg $ws 'ConnectedSearchUseWeb' 0
    Set-Reg $ws 'DisableWebSearch' 1
    Set-Reg $ws 'AllowCloudSearch' 0
    $adv = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced'
    Set-Reg $adv 'ShowCortanaButton' 0
    Set-Reg $adv 'ShowTaskViewButton' 0
    Set-Reg "$adv\People" 'PeopleBand' 0
    Set-Reg 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Feeds' 'ShellFeedsTaskbarViewMode' 2
    Set-Reg 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Windows Feeds' 'EnableFeeds' 0
    Set-Reg 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\Explorer' 'HideSCAMeetNow' 1
    $script:NeedExplorerRestart = $true
}

function Invoke-TweakServices {
    foreach ($s in 'RetailDemo', 'MapsBroker', 'RemoteRegistry', 'Fax', 'WpcMonSvc', 'PhoneSvc',
        'SEMgrSvc', 'WalletService', 'TrkWks', 'WMPNetworkSvc', 'OneSyncSvc') {
        Set-ServiceStart $s Disabled -Stop
    }
    Set-ServiceStart 'DoSvc' Manual
    # SysMain (Superfetch) nur auf SSD sinnvoll abschalten
    if ((Get-SystemDiskType) -eq 'SSD') {
        Set-ServiceStart 'SysMain' Disabled -Stop
    } else {
        Write-Info 'SysMain (Superfetch) bleibt an: Systemlaufwerk ist keine erkannte SSD.'
    }
}

function Invoke-TweakApps {
    Write-Info 'Entferne vorinstallierte Apps (Store, Rechner, Fotos, Terminal bleiben) ...'
    Remove-AppxByName @(
        'Microsoft.Bing*', 'Microsoft.GetHelp', 'Microsoft.Getstarted', 'Microsoft.Messaging',
        'Microsoft.Microsoft3DViewer', 'Microsoft.MicrosoftOfficeHub', 'Microsoft.MicrosoftSolitaireCollection',
        'Microsoft.MixedReality.Portal', 'Microsoft.OneConnect', 'Microsoft.People', 'Microsoft.Print3D',
        'Microsoft.SkypeApp', 'Microsoft.WindowsFeedbackHub', 'Microsoft.Wallet', 'Microsoft.YourPhone',
        'Microsoft.ZuneMusic', 'Microsoft.ZuneVideo', 'Microsoft.WindowsMaps', 'Microsoft.MSPaint',
        'Microsoft.Office.OneNote', 'Microsoft.Todos', 'Microsoft.PowerAutomateDesktop',
        'Microsoft.549981C3F5F10', 'Clipchamp.Clipchamp', 'Microsoft.MicrosoftTeams', 'MicrosoftTeams',
        'king.com.*', '*CandyCrush*', '*Facebook*', '*Twitter*', '*Instagram*', '*TikTok*', '*Netflix*',
        '*Disney*', '*LinkedIn*', '*Duolingo*', '*Hulu*', '*PicsArt*', '*Flipboard*', '*Pandora*',
        '*AdobePhotoshopExpress*', '*EclipseManager*', '*ActiproSoftware*', '*Royal*Revolt*'
    )
    $script:NeedExplorerRestart = $true
}

function Invoke-TweakExtraApps {
    Remove-AppxByName @(
        'microsoft.windowscommunicationsapps', 'Microsoft.MicrosoftStickyNotes',
        'Microsoft.WindowsAlarms', 'Microsoft.WindowsSoundRecorder'
    )
}

function Invoke-TweakXbox {
    Remove-AppxByName @(
        'Microsoft.XboxApp', 'Microsoft.XboxGameOverlay', 'Microsoft.XboxGamingOverlay',
        'Microsoft.XboxIdentityProvider', 'Microsoft.XboxSpeechToTextOverlay', 'Microsoft.Xbox.TCUI',
        'Microsoft.GamingApp'
    )
    foreach ($s in 'XblAuthManager', 'XblGameSave', 'XboxGipSvc', 'XboxNetApiSvc', 'BcastDVRUserService') {
        Set-ServiceStart $s Disabled -Stop
    }
    Disable-TaskSafe '\Microsoft\XblGameSave\' '*'
}

function Invoke-TweakBackground {
    Set-Reg 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\AppPrivacy' 'LetAppsRunInBackground' 2
    Set-Reg 'HKCU:\Software\Microsoft\Windows\CurrentVersion\BackgroundAccessApplications' 'GlobalUserDisabled' 1
    Set-Reg 'HKCU:\System\GameConfigStore' 'GameDVR_Enabled' 0
    Set-Reg 'HKCU:\Software\Microsoft\Windows\CurrentVersion\GameDVR' 'AppCaptureEnabled' 0
    Set-Reg 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\GameDVR' 'AllowGameDVR' 0
    Set-Reg 'HKCU:\Software\Microsoft\GameBar' 'UseNexusForGameBarEnabled' 0
    Set-Reg 'HKCU:\Software\Microsoft\GameBar' 'ShowStartupPanel' 0
    # Spielmodus bleibt bewusst AN
    Set-Reg 'HKCU:\Software\Microsoft\GameBar' 'AutoGameModeEnabled' 1
}

function Invoke-TweakVisual {
    $ex = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer'
    Set-Reg "$ex\VisualEffects" 'VisualFXSetting' 3
    Set-Reg "$ex\Advanced" 'TaskbarAnimations' 0
    Set-Reg "$ex\Advanced" 'ListviewAlphaSelect' 0
    Set-Reg 'HKCU:\Control Panel\Desktop' 'UserPreferencesMask' ([byte[]](0x90, 0x12, 0x03, 0x80, 0x10, 0x00, 0x00, 0x00)) 'Binary'
    Set-Reg 'HKCU:\Control Panel\Desktop' 'FontSmoothing' '2' 'String'
    Set-Reg 'HKCU:\Control Panel\Desktop' 'MenuShowDelay' '0' 'String'
    Set-Reg 'HKCU:\Control Panel\Desktop\WindowMetrics' 'MinAnimate' '0' 'String'
    Set-Reg 'HKCU:\Software\Microsoft\Windows\DWM' 'EnableAeroPeek' 0
    Set-Reg 'HKCU:\Software\Microsoft\Windows\DWM' 'AlwaysHibernateThumbnails' 0
    Set-Reg 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize' 'EnableTransparency' 0
    Write-Info 'Wirkt vollstaendig nach Ab- und Anmelden.'
    $script:NeedExplorerRestart = $true
}

function Invoke-TweakPower {
    # Schnelleres Herunterfahren: haengende Dienste/Apps frueher beenden
    Set-Reg 'HKLM:\SYSTEM\CurrentControlSet\Control' 'WaitToKillServiceTimeout' '2000' 'String'
    Set-Reg 'HKCU:\Control Panel\Desktop' 'WaitToKillAppTimeout' '2000' 'String'
    Set-Reg 'HKCU:\Control Panel\Desktop' 'HungAppTimeout' '2000' 'String'
    if ($script:IsLaptop) {
        Add-Warn 'Laptop/Akku erkannt: Energieplan bleibt unveraendert (Akkulaufzeit).'
        return
    }
    $cur = (& powercfg /getactivescheme) -join ' '
    $rx = '[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}'
    $prev = if ($cur -match $rx) { $Matches[0] } else { $null }
    if ($prev) { Add-StateItem 'POWER|scheme' @{ Kind = 'PowerScheme'; Guid = $prev } }
    $planName = 'Win10-Speedup Ultimative Leistung'
    $existing = (& powercfg /list) -join "`n"
    if ($existing -match ('(' + $rx + ')\s+\(' + [regex]::Escape($planName) + '\)')) {
        $new = $Matches[1]   # beim zweiten Lauf den vorhandenen Plan wiederverwenden
    } else {
        $out = (& powercfg -duplicatescheme e9a42b02-d5df-448d-aa00-03f14749eb61 2>&1) -join ' '
        $new = if ($out -match $rx) { $Matches[0] } else { $null }
        if (-not $new) { $new = '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c' } # Hochleistung als Fallback
        else { & powercfg -changename $new $planName | Out-Null }
    }
    & powercfg -setactive $new
    if ($LASTEXITCODE -eq 0) { Write-Info "Energieplan aktiv: $new" } else { Add-Warn 'Energieplan konnte nicht gesetzt werden.' }
}

function Invoke-TweakHibernate {
    if ($script:IsLaptop) { Add-Warn 'Laptop erkannt: Ruhezustand bleibt aktiv.'; return }
    $hib = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Power' -ErrorAction SilentlyContinue).HibernateEnabled
    Add-StateItem 'POWER|hibernate' @{ Kind = 'Hibernate'; Enabled = [int]$hib }
    & powercfg -h off
    Set-Reg 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power' 'HiberbootEnabled' 0
    Write-Info 'hiberfil.sys entfernt, Schnellstart aus (Neustart = echter Neustart).'
}

function Invoke-TweakExplorer {
    $adv = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced'
    Set-Reg $adv 'HideFileExt' 0
    Set-Reg $adv 'LaunchTo' 1
    $script:NeedExplorerRestart = $true
}

function Invoke-TweakAutostart {
    $patterns = @('OneDrive*', 'MicrosoftEdgeAutoLaunch*', 'Skype*', 'Teams*', 'com.squirrel.Teams*', 'Cortana*')
    foreach ($runKey in 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run', 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run',
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run') {
        $k = Get-Item -LiteralPath $runKey -ErrorAction SilentlyContinue
        if (-not $k) { continue }
        foreach ($name in $k.GetValueNames()) {
            foreach ($pat in $patterns) {
                if ($name -like $pat) { Remove-Reg $runKey $name; Write-Info "Autostart entfernt: $name"; break }
            }
        }
    }
}

function Invoke-TweakEdge {
    $e = 'HKLM:\SOFTWARE\Policies\Microsoft\Edge'
    Set-Reg $e 'StartupBoostEnabled' 0
    Set-Reg $e 'BackgroundModeEnabled' 0
    Set-Reg $e 'HideFirstRunExperience' 1
    Set-Reg $e 'MetricsReportingEnabled' 0
    Set-Reg $e 'PersonalizationReportingEnabled' 0
    Set-Reg $e 'EdgeShoppingAssistantEnabled' 0
    Set-Reg $e 'ShowRecommendationsEnabled' 0
    Set-Reg $e 'HubsSidebarEnabled' 0
    Set-ServiceStart 'edgeupdate' Manual
    Set-ServiceStart 'edgeupdatem' Manual
}

function Invoke-TweakEdgeRemove {
    $root = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application"
    $setup = Get-ChildItem -Path $root -Filter 'setup.exe' -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -like '*\Installer\setup.exe' } | Sort-Object FullName -Descending | Select-Object -First 1
    if (-not $setup) { Add-Warn 'Edge-Installer nicht gefunden (evtl. schon entfernt).'; return }
    Get-Process msedge -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Process -FilePath $setup.FullName -ArgumentList '--uninstall --system-level --verbose-logging --force-uninstall' -Wait
    Set-Reg 'HKLM:\SOFTWARE\Microsoft\EdgeUpdate' 'DoNotUpdateToEdgeWithChromium' 1
    Write-Info 'Edge deinstalliert (WebView2-Runtime bleibt, wird von Apps gebraucht). Nicht rueckgaengig machbar.'
}

function Invoke-TweakOneDrive {
    $docs = [Environment]::GetFolderPath('MyDocuments')
    $desk = [Environment]::GetFolderPath('Desktop')
    if (($docs -like '*OneDrive*') -or ($desk -like '*OneDrive*')) {
        Add-Warn 'OneDrive uebersprungen: Desktop/Dokumente liegen in OneDrive. Erst Ordner zurueckverlegen, sonst droht Datenverlust.'
        return
    }
    Get-Process OneDrive -ErrorAction SilentlyContinue | Stop-Process -Force
    $setup = "$env:SystemRoot\SysWOW64\OneDriveSetup.exe"
    if (-not (Test-Path -LiteralPath $setup)) { $setup = "$env:SystemRoot\System32\OneDriveSetup.exe" }
    if (Test-Path -LiteralPath $setup) {
        Start-Process -FilePath $setup -ArgumentList '/uninstall' -Wait
        Write-Info 'OneDrive deinstalliert (Neuinstallation: winget install Microsoft.OneDrive).'
    }
    Set-Reg 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\OneDrive' 'DisableFileSyncNGSC' 1
    Remove-Reg 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' 'OneDrive'
    foreach ($c in 'Registry::HKEY_CLASSES_ROOT\CLSID\{018D5C66-4533-4307-9B53-224DE2ED1FE6}',
        'Registry::HKEY_CLASSES_ROOT\Wow6432Node\CLSID\{018D5C66-4533-4307-9B53-224DE2ED1FE6}') {
        Set-Reg $c 'System.IsPinnedToNameSpaceTree' 0
    }
    $leftover = Join-Path $env:USERPROFILE 'OneDrive'
    if ((Test-Path -LiteralPath $leftover) -and -not (Get-ChildItem -LiteralPath $leftover -Force -ErrorAction SilentlyContinue)) {
        Remove-Item -LiteralPath $leftover -Force -ErrorAction SilentlyContinue
    }
    $script:NeedExplorerRestart = $true
}

function Invoke-TweakFeatures {
    Write-Info 'Entferne alte Windows-Features (dauert etwas) ...'
    foreach ($f in 'Internet-Explorer-Optional-amd64', 'MicrosoftWindowsPowerShellV2Root', 'SMB1Protocol',
        'FaxServicesClientPackage', 'Printing-XPSServices-Features', 'WorkFolders-Client', 'WindowsMediaPlayer') {
        Disable-FeatureSafe $f
    }
}

function Invoke-TweakLocation {
    Set-Reg 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\LocationAndSensors' 'DisableLocation' 1
    Set-ServiceStart 'lfsvc' Disabled -Stop
}

function Invoke-TweakNetSvc {
    foreach ($s in 'SSDPSRV', 'upnphost', 'icssvc', 'SharedAccess') { Set-ServiceStart $s Disabled -Stop }
}

function Invoke-TweakSpooler {
    Set-ServiceStart 'Spooler' Disabled -Stop
}

function Invoke-TweakEditors {
    $dir = Join-Path $env:APPDATA 'Code\User'
    if (-not (Test-Path -LiteralPath $dir)) {
        Write-Info 'VS Code-Benutzerordner nicht gefunden - uebersprungen (einmal VS Code starten und Skript erneut ausfuehren).'
        return
    }
    $f = Join-Path $dir 'settings.json'
    $existed = Test-Path -LiteralPath $f
    $bak = "$f.bak-win10speedup"
    if ($existed) {
        if (-not (Test-Path -LiteralPath $bak)) { Copy-Item -LiteralPath $f -Destination $bak -Force }
        Add-StateItem "FILEBAK|$f" @{ Kind = 'FileBackup'; Path = $f; Backup = $bak; Existed = $true }
        $text = [IO.File]::ReadAllText($f)
    } else {
        Add-StateItem "FILEBAK|$f" @{ Kind = 'FileBackup'; Path = $f; Backup = $bak; Existed = $false }
        $text = ''
    }
    $text = Set-JsonSettingText $text 'telemetry.telemetryLevel' '"off"'
    $text = Set-JsonSettingText $text 'workbench.enableExperiments' 'false'
    [IO.File]::WriteAllText($f, $text, (New-Object Text.UTF8Encoding $false))
    Write-Info 'VS Code: telemetry.telemetryLevel = off, Experimente aus.'
}

function Invoke-TweakBrave {
    $b = 'HKLM:\SOFTWARE\Policies\BraveSoftware\Brave'
    Set-Reg $b 'BraveRewardsDisabled' 1
    Set-Reg $b 'BraveWalletDisabled' 1
    Set-Reg $b 'BraveVPNDisabled' 1
    Set-Reg $b 'BraveAIChatEnabled' 0
    Set-Reg $b 'MetricsReportingEnabled' 0
    Set-Reg $b 'BackgroundModeEnabled' 0
    Write-Info 'Brave zeigt jetzt evtl. "Wird von deiner Organisation verwaltet" - das ist nur die Richtlinie.'
}

function Invoke-TweakCleanup {
    $before = (Get-PSDrive -Name ($env:SystemDrive.TrimEnd(':')) -ErrorAction SilentlyContinue).Free
    foreach ($p in $env:TEMP, "$env:WINDIR\Temp") {
        Get-ChildItem -LiteralPath $p -Force -ErrorAction SilentlyContinue |
            Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    }
    $wasRunning = (Get-Service wuauserv -ErrorAction SilentlyContinue).Status -eq 'Running'
    Stop-Service wuauserv -Force -ErrorAction SilentlyContinue
    Get-ChildItem -LiteralPath "$env:WINDIR\SoftwareDistribution\Download" -Force -ErrorAction SilentlyContinue |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    if ($wasRunning) { Start-Service wuauserv -ErrorAction SilentlyContinue }
    $after = (Get-PSDrive -Name ($env:SystemDrive.TrimEnd(':')) -ErrorAction SilentlyContinue).Free
    if ($before -and $after) { Write-Info ("Freigegeben: {0:N0} MB" -f (($after - $before) / 1MB)) }
}

function Invoke-TweakDism {
    Write-Info 'DISM-Komponentenbereinigung laeuft (mehrere Minuten) ...'
    & dism.exe /Online /Cleanup-Image /StartComponentCleanup | Out-Null
}

# ----------------------------------------------------------------------------
# Schnelle Suche: Everything + EverythingToolbar
# ----------------------------------------------------------------------------
function Get-EverythingExe {
    foreach ($p in "$env:ProgramFiles\Everything\Everything.exe", "${env:ProgramFiles(x86)}\Everything\Everything.exe",
        "$env:LOCALAPPDATA\Programs\Everything\Everything.exe") {
        if ($p -and (Test-Path -LiteralPath $p)) { return $p }
    }
    return $null
}

function Test-WingetPackage([string]$Id) {
    & winget list --id $Id -e --accept-source-agreements 2>&1 | Out-Null
    return ($LASTEXITCODE -eq 0)
}

function Install-WingetPackage([string]$Id) {
    if (Test-WingetPackage $Id) { Write-Info "$Id ist bereits installiert."; return $true }
    Write-Info "Installiere $Id ..."
    & winget install --id $Id -e --silent --accept-package-agreements --accept-source-agreements | Out-Host
    $c = $LASTEXITCODE
    # 0 = ok, 0x8A150061 = schon installiert, 0x8A15002B = kein Update noetig
    if ($c -eq 0 -or $c -eq -1978335135 -or $c -eq -1978335189) { return $true }
    Add-Warn "winget install $Id endete mit Code $c"
    return $false
}

function Test-DesktopRuntime {
    $base = Join-Path $env:ProgramFiles 'dotnet\shared\Microsoft.WindowsDesktop.App'
    if (-not (Test-Path -LiteralPath $base)) { return $false }
    return [bool](Get-ChildItem -LiteralPath $base -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^(8|9|1\d)\.' })
}

function Invoke-TweakFastSearch {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Add-Warn 'winget fehlt (App Installer aus dem Microsoft Store installieren). Suche NICHT eingerichtet - Windows-Suche bleibt aktiv.'
        Write-Info 'Manuell: Everything 1.4.1+ (voidtools.com, KEINE Lite-Version) und EverythingToolbar Deskband (github.com/srwi/EverythingToolbar).'
        return
    }
    $okEv = Install-WingetPackage 'voidtools.Everything'
    $ev = Get-EverythingExe
    if (-not $okEv -or -not $ev) { Add-Warn 'Everything nicht installiert - Windows-Suche bleibt aktiv.'; return }

    if (-not (Test-DesktopRuntime)) { [void](Install-WingetPackage 'Microsoft.DotNet.DesktopRuntime.8') }
    $okTb = Install-WingetPackage 'srwi.EverythingToolbar.Deskband'
    $okTb = $okTb -and (Test-WingetPackage 'srwi.EverythingToolbar.Deskband')

    # Everything-Dienst: liest den NTFS-Index mit Adminrechten, Everything selbst laeuft normal (ohne UAC)
    Get-Process Everything -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 1
    $svcProc = Start-Process -FilePath $ev -ArgumentList '-install-service' -PassThru
    if (-not $svcProc.WaitForExit(20000)) { Stop-Process -Id $svcProc.Id -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 2
    if (Get-Service -Name 'Everything' -ErrorAction SilentlyContinue) {
        Start-Service -Name 'Everything' -ErrorAction SilentlyContinue
        Write-Info 'Everything-Dienst installiert und gestartet.'
    } else {
        Add-Warn 'Everything-Dienst nicht gefunden - lege Autostart-Aufgabe mit Adminrechten an (Fallback).'
        try {
            $user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
            $act = New-ScheduledTaskAction -Execute $ev -Argument '-startup'
            $trg = New-ScheduledTaskTrigger -AtLogOn -User $user
            $pri = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest
            Register-ScheduledTask -TaskName 'Everything (Admin-Autostart)' -Action $act -Trigger $trg -Principal $pri -Force | Out-Null
            Add-StateItem 'SCHEDTASK|Everything' @{ Kind = 'RegisteredTask'; Name = 'Everything (Admin-Autostart)' }
        } catch { Add-Warn "Fallback-Aufgabe fehlgeschlagen: $($_.Exception.Message)" }
    }

    # Einstellungen (nur bei beendetem Everything schreiben, sonst ueberschreibt es sie beim Beenden)
    $ini = Join-Path $env:APPDATA 'Everything\Everything.ini'
    Add-StateItem "FILEBAK|$ini" @{ Kind = 'FileBackup'; Path = $ini; Backup = "$ini.bak-win10speedup"; Existed = (Test-Path -LiteralPath $ini) }
    if (Test-Path -LiteralPath $ini) { Copy-Item -LiteralPath $ini -Destination "$ini.bak-win10speedup" -Force }
    Set-IniValue $ini 'run_in_background' '1'
    Set-IniValue $ini 'show_tray_icon' '1'
    Set-IniValue $ini 'index_date_created' '1'
    Set-IniValue $ini 'fast_date_created_sort' '1'

    # Autostart im Hintergrund + Verknuepfungen fuer "zuletzt erstellt"
    $startup = Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\Startup\Everything (Schnellsuche).lnk'
    [void](New-Shortcut $startup $ev '-startup' 'Everything im Hintergrund starten')
    $menu = Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs'
    [void](New-Shortcut (Join-Path $menu 'Neue Dateien (heute).lnk') $ev '-newwindow -s "dc:today" -sort "Date Created" -sort-descending' 'Heute erstellte Dateien')
    [void](New-Shortcut (Join-Path $menu 'Neue Dateien (7 Tage).lnk') $ev '-newwindow -s "dc:last7days" -sort "Date Created" -sort-descending' 'In den letzten 7 Tagen erstellte Dateien')

    # Everything normal (ohne Adminrechte) ueber die Shell starten
    Start-Process -FilePath 'explorer.exe' -ArgumentList ('"{0}"' -f $startup)
    Start-Sleep -Seconds 2

    # Erst wenn alles da ist, wird die Windows-Suche abgeschaltet
    Invoke-TweakCortana
    if ($okTb -and -not $KeepWindowsSearch) {
        Set-ServiceStart 'WSearch' Disabled -Stop
        Write-Step 'Windows-Suchdienst (WSearch) abgeschaltet - Everything uebernimmt.'
    } elseif (-not $okTb) {
        Add-Warn 'EverythingToolbar fehlt - WSearch bleibt aktiv, bis die Toolbar installiert ist (Skript mit "Nur schnelle Suche" erneut starten).'
    }
    $script:NeedExplorerRestart = $true
    Write-Host ''
    Write-Host '  NOCH EIN HANDGRIFF: Rechtsklick auf die Taskleiste -> Symbolleisten -> EverythingToolbar' -ForegroundColor Cyan
    Write-Host '  (ggf. zweimal oeffnen). Tastenkuerzel zum Fokussieren: Win + Alt + S.' -ForegroundColor Cyan
}

# ----------------------------------------------------------------------------
# Auslagerungsdatei (= Windows-"Swap"), Speicherkomprimierung (= zram), TRIM
# ----------------------------------------------------------------------------
function Invoke-TweakPagefile {
    $cs = Get-CimInstance Win32_ComputerSystem
    $ramMB = [int][Math]::Round($cs.TotalPhysicalMemory / 1MB)
    $drive = $env:SystemDrive
    $type = Get-SystemDiskType
    if ($type -ne 'SSD') { Write-Info "Systemlaufwerk als '$type' erkannt (nicht SSD) - Auslagerungsdatei bleibt auf $drive." }

    # Feste Groesse (Start = Maximum): kein Wachsen/Schrumpfen, keine Fragmentierung, keine Ruckler.
    # <= 8 GB RAM: 1,5 x RAM, darueber 1 x RAM, immer zwischen 4 und 16 GB.
    $factor = if ($ramMB -le 8192) { 1.5 } else { 1.0 }
    $sizeMB = [int][Math]::Min([Math]::Max($ramMB * $factor, 4096), 16384)
    $freeMB = [int]((Get-PSDrive -Name ($drive.TrimEnd(':'))).Free / 1MB)
    if ($freeMB -lt ($sizeMB + 10240)) {
        Add-Warn "Zu wenig freier Platz auf $drive ($freeMB MB frei, $sizeMB MB noetig + 10 GB Reserve) - Auslagerungsdatei unveraendert."
    } else {
        $prev = @(Get-CimInstance Win32_PageFileSetting -ErrorAction SilentlyContinue | ForEach-Object {
                @{ Name = $_.Name; Initial = [int]$_.InitialSize; Max = [int]$_.MaximumSize } })
        Add-StateItem 'PAGEFILE' @{ Kind = 'Pagefile'; Auto = [bool]$cs.AutomaticManagedPagefile; Settings = $prev }
        try {
            Set-CimInstance -InputObject $cs -Property @{ AutomaticManagedPagefile = $false } -ErrorAction Stop
            $path = "$drive\pagefile.sys"
            $pf = Get-CimInstance Win32_PageFileSetting -Filter ("Name='" + $path.Replace('\', '\\') + "'") -ErrorAction SilentlyContinue
            if ($pf) {
                Set-CimInstance -InputObject $pf -Property @{ InitialSize = [uint32]$sizeMB; MaximumSize = [uint32]$sizeMB } -ErrorAction Stop
            } else {
                New-CimInstance -ClassName Win32_PageFileSetting -Property @{ Name = $path; InitialSize = [uint32]$sizeMB; MaximumSize = [uint32]$sizeMB } -ErrorAction Stop | Out-Null
            }
            Write-Info ("Auslagerungsdatei: fest {0} MB auf {1} (RAM: {2} MB) - wirkt nach dem Neustart." -f $sizeMB, $drive, $ramMB)
        } catch {
            Add-Warn "Auslagerungsdatei: $($_.Exception.Message) - stelle automatische Verwaltung wieder her."
            try { Set-CimInstance -InputObject $cs -Property @{ AutomaticManagedPagefile = $true } -ErrorAction Stop } catch { }
        }
    }

    # Speicherkomprimierung: Windows komprimiert selten genutzte RAM-Seiten, bevor es auf die Platte auslagert
    try {
        $mm = Get-MMAgent -ErrorAction Stop
        Add-StateItem 'MMAGENT' @{ Kind = 'MMAgent'; Compression = [bool]$mm.MemoryCompression }
        if ($mm.MemoryCompression) {
            Write-Info 'Speicherkomprimierung ist aktiv (das Windows-Gegenstueck zu zram).'
        } else {
            Enable-MMAgent -MemoryCompression -ErrorAction Stop
            Write-Info 'Speicherkomprimierung eingeschaltet (nach Neustart aktiv).'
        }
    } catch {
        Add-Warn "Speicherkomprimierung: $($_.Exception.Message)"
    }

    # TRIM: haelt die SSD schnell. Windows hat es normalerweise an - wir pruefen nur.
    if ($type -ne 'HDD') {
        $q = (& fsutil behavior query DisableDeleteNotify 2>&1) -join ' '
        if ($q -match 'NTFS\s+DisableDeleteNotify\s*=\s*1') {
            & fsutil behavior set DisableDeleteNotify 0 | Out-Null
            Write-Info 'TRIM war aus und ist jetzt an.'
        } elseif ($q -match 'DisableDeleteNotify\s*=\s*0') {
            Write-Info 'TRIM ist aktiv.'
        }
    }
}

# ----------------------------------------------------------------------------
# Win+S -> EverythingToolbar (per AutoHotkey v2)
# ----------------------------------------------------------------------------
function Invoke-TweakWinS {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { Add-Warn 'winget fehlt - Win+S-Umleitung uebersprungen.'; return }
    if (-not (Test-WingetPackage 'srwi.EverythingToolbar.Deskband')) {
        Add-Warn 'Win+S-Umleitung braucht die EverythingToolbar - zuerst "Schnelle Suche" ausfuehren.'
        return
    }
    if (-not (Install-WingetPackage 'AutoHotkey.AutoHotkey')) { return }
    $ahk = $null
    foreach ($c in "$env:ProgramFiles\AutoHotkey\v2\AutoHotkey64.exe", "$env:ProgramFiles\AutoHotkey\v2\AutoHotkey.exe",
        "$env:LOCALAPPDATA\Programs\AutoHotkey\v2\AutoHotkey64.exe") {
        if (Test-Path -LiteralPath $c) { $ahk = $c; break }
    }
    if (-not $ahk -and (Test-Path -LiteralPath "$env:ProgramFiles\AutoHotkey")) {
        $ahk = (Get-ChildItem -LiteralPath "$env:ProgramFiles\AutoHotkey" -Recurse -Filter 'AutoHotkey64.exe' -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
    }
    if (-not $ahk) { Add-Warn 'AutoHotkey v2 installiert, aber AutoHotkey64.exe nicht gefunden.'; return }

    $ahkScript = Join-Path $script:StateDir 'WinS-to-EverythingToolbar.ahk'
    $code = "#Requires AutoHotkey v2.0`r`n#SingleInstance Force`r`n; Win+S oeffnet die EverythingToolbar (sendet deren Kuerzel Win+Alt+S)`r`n`$#s::Send(`"{Blind}!s`")`r`n"
    [IO.File]::WriteAllText($ahkScript, $code, (New-Object Text.UTF8Encoding $false))
    Add-StateItem "FILE|$ahkScript" @{ Kind = 'File'; Path = $ahkScript }
    $lnk = Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\Startup\Win+S Schnellsuche.lnk'
    if (New-Shortcut $lnk $ahk ('"{0}"' -f $ahkScript) 'Win+S oeffnet die EverythingToolbar') {
        Get-Process -Name 'AutoHotkey*' -ErrorAction SilentlyContinue | Stop-Process -Force
        Start-Process -FilePath 'explorer.exe' -ArgumentList ('"{0}"' -f $lnk)
        Write-Info 'Win+S oeffnet jetzt die Toolbar-Suchleiste (setzt voraus, dass die Toolbar in der Taskleiste aktiviert ist).'
    }
}


# ============================================================================
# Katalog + Menue
# ============================================================================
# Level: 1 = sicher (in jedem Modus vorausgewaehlt), 2 = hart (nur Mode Max), 3 = riskant (nie vorausgewaehlt)
$script:Catalog = @(
    @{ Id = 1; Level = 1; Fn = 'Invoke-TweakTelemetry'; Title = 'Telemetrie, Datensammlung, Fehlerberichte & Diagnose-Aufgaben aus' },
    @{ Id = 2; Level = 1; Fn = 'Invoke-TweakAds'; Title = 'Werbung, Vorschlaege, Tipps, Spotlight & Konsum-Features aus' },
    @{ Id = 3; Level = 1; Fn = 'Invoke-TweakCortana'; Title = 'Cortana, Bing-Websuche, News-Widget, Aufgabenansicht & Co. aus der Taskleiste' },
    @{ Id = 4; Level = 1; Fn = 'Invoke-TweakServices'; Title = 'Unnoetige Hintergrunddienste abschalten (Fax, Karten, Remote-Registry, ...)' },
    @{ Id = 5; Level = 1; Fn = 'Invoke-TweakApps'; Title = 'Vorinstallierte Apps entfernen (News, Wetter, Solitaire, Teams, ...)' },
    @{ Id = 6; Level = 1; Fn = 'Invoke-TweakBackground'; Title = 'Hintergrund-Apps, Game-DVR-Aufnahme & Game-Bar-Popups aus' },
    @{ Id = 7; Level = 1; Fn = 'Invoke-TweakVisual'; Title = 'Animationen, Transparenz & Schatten aus (Win7-Feeling, schneller)' },
    @{ Id = 8; Level = 1; Fn = 'Invoke-TweakPower'; Title = 'Energieplan "Ultimative Leistung" (nur Desktop) + schnelleres Herunterfahren' },
    @{ Id = 9; Level = 1; Fn = 'Invoke-TweakExplorer'; Title = 'Explorer: Dateiendungen zeigen, "Dieser PC" als Start' },
    @{ Id = 10; Level = 1; Fn = 'Invoke-TweakAutostart'; Title = 'Autostart-Ballast entfernen (OneDrive, Teams, Skype, Edge)' },
    @{ Id = 11; Level = 1; Fn = 'Invoke-TweakEdge'; Title = 'Edge zaehmen (kein Hintergrund/Boost, Updater nur bei Bedarf)' },
    @{ Id = 12; Level = 1; Fn = 'Invoke-TweakEditors'; Title = 'VS Code: Telemetrie & Experimente aus' },
    @{ Id = 13; Level = 1; Fn = 'Invoke-TweakCleanup'; Title = 'Temp-Dateien & Windows-Update-Cache aufraeumen' },
    @{ Id = 14; Level = 1; Order = 100; Fn = 'Invoke-TweakFastSearch'; Title = 'SCHNELLE SUCHE: Everything + Taskleisten-Suchleiste, Windows-Suche abschalten' },
    @{ Id = 15; Level = 2; Fn = 'Invoke-TweakXbox'; Title = 'Xbox-Apps, Game Bar & Xbox-Dienste entfernen (Store-/Game-Pass-Spiele leiden!)' },
    @{ Id = 16; Level = 2; Fn = 'Invoke-TweakExtraApps'; Title = 'Mail & Kalender, Sticky Notes, Wecker, Sprachrekorder entfernen' },
    @{ Id = 17; Level = 2; Fn = 'Invoke-TweakOneDrive'; Title = 'OneDrive deinstallieren (wird uebersprungen, wenn Ordner darin liegen)' },
    @{ Id = 18; Level = 2; Fn = 'Invoke-TweakFeatures'; Title = 'Alte Features entfernen: IE11, PowerShell 2, SMB1, Fax, XPS, WMP' },
    @{ Id = 19; Level = 2; Fn = 'Invoke-TweakHibernate'; Title = 'Ruhezustand & Schnellstart aus (spart GB, sauberer Neustart)' },
    @{ Id = 20; Level = 2; Fn = 'Invoke-TweakLocation'; Title = 'Standortdienste aus (Wetter/Karten ohne Standort)' },
    @{ Id = 21; Level = 2; Fn = 'Invoke-TweakNetSvc'; Title = 'UPnP/SSDP, Internetfreigabe & Mobile Hotspot aus' },
    @{ Id = 22; Level = 2; Fn = 'Invoke-TweakBrave'; Title = 'Brave: Rewards, Wallet, VPN, KI-Chat & Metriken per Richtlinie aus' },
    @{ Id = 23; Level = 2; Fn = 'Invoke-TweakDism'; Title = 'Windows-Komponentenspeicher bereinigen (DISM, dauert)' },
    @{ Id = 24; Level = 2; Fn = 'Invoke-TweakPagefile'; Title = 'SSD-"Swap": feste Auslagerungsdatei, Speicherkomprimierung, TRIM-Check' },
    @{ Id = 25; Level = 2; Order = 101; Fn = 'Invoke-TweakWinS'; Title = 'Win+S oeffnet die Taskleisten-Suche (AutoHotkey, nach "Schnelle Suche")' },
    @{ Id = 26; Level = 3; Fn = 'Invoke-TweakEdgeRemove'; Title = 'Microsoft Edge deinstallieren (nicht umkehrbar)' },
    @{ Id = 27; Level = 3; Fn = 'Invoke-TweakSpooler'; Title = 'Druckwarteschlange abschalten (nur wenn du NIE druckst)' }
)

function Get-DefaultSelection {
    $sel = @{}
    foreach ($c in $script:Catalog) {
        $on = ($c.Level -eq 1) -or ($c.Level -eq 2 -and $Mode -eq 'Max')
        $sel[$c.Id] = $on
    }
    return $sel
}

function Show-Menu($sel) {
    Clear-Host
    Write-Host '=============================================================' -ForegroundColor Cyan
    Write-Host "  Windows 10 Speedup   (Modus: $Mode)" -ForegroundColor Cyan
    Write-Host '=============================================================' -ForegroundColor Cyan
    foreach ($c in $script:Catalog) {
        $box = if ($sel[$c.Id]) { '[x]' } else { '[ ]' }
        $color = switch ($c.Level) { 1 { 'White' } 2 { 'Yellow' } 3 { 'Red' } }
        $tag = switch ($c.Level) { 1 { 'sicher' } 2 { 'hart  ' } 3 { 'riskant' } }
        Write-Host ('  {0} {1,2}  {2,-7} {3}' -f $box, $c.Id, $tag, $c.Title) -ForegroundColor $color
    }
    Write-Host ''
    Write-Host '  Nummern (z.B. 5,17) = umschalten | A = alle sicheren + harten | S = nur sichere' -ForegroundColor Gray
    Write-Host '  N = nichts | ENTER = LOS | Q = Abbrechen' -ForegroundColor Gray
}

function Read-Selection {
    $sel = Get-DefaultSelection
    while ($true) {
        Show-Menu $sel
        $in = (Read-Host "`n  Eingabe").Trim()
        if ($in -eq '') { return $sel }
        switch -Regex ($in.ToLower()) {
            '^q$' { return $null }
            '^a$' { foreach ($c in $script:Catalog) { $sel[$c.Id] = ($c.Level -le 2) }; continue }
            '^s$' { foreach ($c in $script:Catalog) { $sel[$c.Id] = ($c.Level -eq 1) }; continue }
            '^n$' { foreach ($c in $script:Catalog) { $sel[$c.Id] = $false }; continue }
            default {
                foreach ($tok in ($in -split '[,;\s]+')) {
                    if ($tok -match '^\d+$' -and $sel.ContainsKey([int]$tok)) { $sel[[int]$tok] = -not $sel[[int]$tok] }
                }
            }
        }
    }
}

# ----------------------------------------------------------------------------
# Rueckgaengig
# ----------------------------------------------------------------------------
function Restore-StateItem($r) {
    switch ($r.Kind) {
        'Reg' {
            if ($r.Existed) {
                if (-not (Test-Path -LiteralPath $r.Path)) { New-Item -Path $r.Path -Force | Out-Null }
                $val = $r.Value
                switch ($r.Type) {
                    'Binary' { $val = [Convert]::FromBase64String([string]$val) }
                    'DWord' { $val = [int]$val }
                    'QWord' { $val = [long]$val }
                    'MultiString' { $val = [string[]]@($val) }
                }
                New-ItemProperty -LiteralPath $r.Path -Name $r.Name -Value $val -PropertyType $r.Type -Force | Out-Null
            } else {
                Remove-ItemProperty -LiteralPath $r.Path -Name $r.Name -ErrorAction SilentlyContinue
            }
        }
        'Svc' {
            $mode = switch ([int]$r.Start) {
                2 { if ([int]$r.Delayed -eq 1) { 'delayed-auto' } else { 'auto' } }
                3 { 'demand' }
                4 { 'disabled' }
                default { $null }
            }
            if ($mode) { & sc.exe config $r.Name start= $mode | Out-Null }
        }
        'Task' { Enable-ScheduledTask -TaskPath $r.Path -TaskName $r.Name -ErrorAction SilentlyContinue | Out-Null }
        'Feature' { Enable-WindowsOptionalFeature -Online -FeatureName $r.Name -NoRestart -ErrorAction SilentlyContinue | Out-Null }
        'PowerScheme' { & powercfg -setactive $r.Guid | Out-Null }
        'Hibernate' { if ([int]$r.Enabled -eq 1) { & powercfg -h on } }
        'File' { Remove-Item -LiteralPath $r.Path -Force -ErrorAction SilentlyContinue }
        'FileBackup' {
            if ($r.Existed -and (Test-Path -LiteralPath $r.Backup)) {
                Copy-Item -LiteralPath $r.Backup -Destination $r.Path -Force
            } elseif (-not $r.Existed) {
                Remove-Item -LiteralPath $r.Path -Force -ErrorAction SilentlyContinue
            }
        }
        'Pagefile' {
            $cs = Get-CimInstance Win32_ComputerSystem
            if ($r.Auto) {
                Set-CimInstance -InputObject $cs -Property @{ AutomaticManagedPagefile = $true }
            } else {
                Set-CimInstance -InputObject $cs -Property @{ AutomaticManagedPagefile = $false }
                $keep = @($r.Settings)
                foreach ($cur in @(Get-CimInstance Win32_PageFileSetting -ErrorAction SilentlyContinue)) {
                    if (-not ($keep | Where-Object { $_.Name -eq $cur.Name })) { Remove-CimInstance -InputObject $cur -ErrorAction SilentlyContinue }
                }
                foreach ($k in $keep) {
                    $pf = Get-CimInstance Win32_PageFileSetting -Filter ("Name='" + ([string]$k.Name).Replace('\', '\\') + "'") -ErrorAction SilentlyContinue
                    if ($pf) { Set-CimInstance -InputObject $pf -Property @{ InitialSize = [uint32]$k.Initial; MaximumSize = [uint32]$k.Max } }
                    else { New-CimInstance -ClassName Win32_PageFileSetting -Property @{ Name = [string]$k.Name; InitialSize = [uint32]$k.Initial; MaximumSize = [uint32]$k.Max } | Out-Null }
                }
            }
        }
        'MMAgent' { if (-not $r.Compression) { Disable-MMAgent -MemoryCompression -ErrorAction SilentlyContinue } }
        'RegisteredTask' { Unregister-ScheduledTask -TaskName $r.Name -Confirm:$false -ErrorAction SilentlyContinue }
    }
}

function Invoke-Undo {
    if ($script:Items.Count -eq 0) {
        Write-Host 'Keine gespeicherten Aenderungen gefunden - nichts rueckgaengig zu machen.' -ForegroundColor Yellow
        return
    }
    Write-Host ("Es werden {0} gespeicherte Aenderungen zurueckgedreht." -f $script:Items.Count) -ForegroundColor Cyan
    if (-not $NoMenu -and -not (Confirm-YesNo 'Fortfahren?' $true)) { return }
    $recs = @($script:Items.Values)
    [array]::Reverse($recs)
    $ok = 0
    foreach ($r in $recs) {
        try { Restore-StateItem $r; $ok++ } catch { Add-Warn "Undo $($r.Kind) $($r.Name): $($_.Exception.Message)" }
    }
    $archive = Join-Path $script:StateDir ("state.undone-{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
    Move-Item -LiteralPath $script:StateFile -Destination $archive -Force -ErrorAction SilentlyContinue
    Write-Step "$ok Aenderungen zurueckgedreht. Neustart empfohlen."
    Write-Host ''
    Write-Host '  Nicht automatisch umkehrbar:' -ForegroundColor Yellow
    Write-Host '   - entfernte Apps: im Microsoft Store neu installieren' -ForegroundColor Yellow
    Write-Host '   - OneDrive: winget install Microsoft.OneDrive' -ForegroundColor Yellow
    Write-Host '   - Everything/Toolbar bleiben installiert: winget uninstall voidtools.Everything ; winget uninstall srwi.EverythingToolbar.Deskband' -ForegroundColor Yellow
    Write-Host '   - Gruendlicher Rollback: Systemwiederherstellung -> "Win10-Speedup (vor den Aenderungen)"' -ForegroundColor Yellow
}

# ============================================================================
# MAIN
# ============================================================================
Initialize-State
try { Start-Transcript -Path (Join-Path $script:StateDir ("log-{0}.txt" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))) | Out-Null } catch { }

try {
    $build = [int](Get-CimInstance Win32_OperatingSystem).BuildNumber
    $script:IsLaptop = [bool](Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue)

    if ($Undo) { Invoke-Undo; return }

    if ($build -ge 22000) {
        Add-Warn 'Das ist Windows 11 - das Skript ist fuer Windows 10 gedacht (Taskleisten-Tweaks wirken anders).'
        if ($NoMenu -or -not (Confirm-YesNo 'Trotzdem fortfahren?' $false)) { return }
    }

    $selected = @()
    if ($OnlySearch) {
        $selected = @($script:Catalog | Where-Object { $_.Id -eq 14 -or $_.Id -eq 25 })
    } else {
        if ($NoMenu) {
            $sel = Get-DefaultSelection
        } else {
            $sel = Read-Selection
            if ($null -eq $sel) { Write-Host 'Abgebrochen.'; return }
        }
        $selected = @($script:Catalog | Where-Object { $sel[$_.Id] })
    }
    if ($selected.Count -eq 0) { Write-Host 'Nichts ausgewaehlt.'; return }

    if (-not $SkipRestorePoint) {
        $rp = New-SafetyRestorePoint
        if (-not $rp -and -not $NoMenu -and -not (Confirm-YesNo 'Ohne Wiederherstellungspunkt weitermachen? (Undo-Funktion bleibt nutzbar)' $false)) { return }
    }

    $ordered = @($selected | Sort-Object { if ($_.Order) { $_.Order } else { $_.Id } })
    $n = 0
    foreach ($c in $ordered) {
        $n++
        Write-Host ("`n[{0}/{1}] {2}" -f $n, $ordered.Count, $c.Title) -ForegroundColor Cyan
        try { & $c.Fn | Out-Host } catch { Add-Warn "$($c.Fn) fehlgeschlagen: $($_.Exception.Message)" }
    }
    Save-State

    Write-Host "`n=============================================================" -ForegroundColor Cyan
    Write-Host '  FERTIG' -ForegroundColor Green
    Write-Host '=============================================================' -ForegroundColor Cyan
    if ($script:Warnings.Count -gt 0) {
        Write-Host "`n  Hinweise / Warnungen ($($script:Warnings.Count)):" -ForegroundColor Yellow
        foreach ($w in $script:Warnings) { Write-Host "   - $w" -ForegroundColor Yellow }
    }
    Write-Host "`n  Rueckgaengig: START.bat -> [4]  oder  .\Win10-Speedup.ps1 -Undo" -ForegroundColor Gray
    Write-Host "  Log + Zustand: $script:StateDir" -ForegroundColor Gray

    if ($script:NeedExplorerRestart -and -not $NoMenu) {
        if (Confirm-YesNo "`n  Explorer jetzt neu starten (Taskleiste flackert kurz)?" $true) {
            Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
        }
    }
    Write-Host "`n  Bitte den PC jetzt NEU STARTEN, damit alles greift." -ForegroundColor Green
} finally {
    try { Stop-Transcript | Out-Null } catch { }
    if (-not $NoMenu) { [void](Read-Host "`n  ENTER zum Beenden") }
}
