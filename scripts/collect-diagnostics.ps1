# SPDX-License-Identifier: MIT
# Windows PowerShell 5.1+. Local-only: never uploads logs or reads Fusion AppLogs.
[CmdletBinding()]
param(
    [switch]$Watch,
    [string]$SourceRoot = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Temp\Fusion360CAM'),
    [string]$Destination = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Fusion360Next-NC\diagnostics')
)
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$Destination = [IO.Path]::GetFullPath($Destination)
[IO.Directory]::CreateDirectory($Destination) | Out-Null

function Get-Hash([byte[]]$Bytes, [string]$Algorithm = 'SHA256') {
    $hasher = [Security.Cryptography.HashAlgorithm]::Create($Algorithm)
    try { return ([BitConverter]::ToString($hasher.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant() }
    finally { $hasher.Dispose() }
}
function Write-Text([string]$Path, [string]$Text) {
    # Replace a whole file so a reader never observes a partially written report.
    $pending = $Path + '.tmp'
    [IO.File]::WriteAllText($pending, $Text, $utf8)
    if ([IO.File]::Exists($Path)) {
        # PowerShell 5.1 converts $null to an invalid empty backup filename.
        [IO.File]::Replace($pending, $Path, $Path + '.previous')
        [IO.File]::Delete($Path + '.previous')
    }
    else { [IO.File]::Move($pending, $Path) }
}
function Get-Field([string]$Text, [string]$Name) {
    $match = [regex]::Match($Text, '(?m)^' + [regex]::Escape($Name) + ':\s*(.*?)\r?$')
    if ($match.Success) { return $match.Groups[1].Value }
    return $null
}
function Get-PostEvidence([string]$ConfigPath) {
    $evidence = [ordered]@{ path = $ConfigPath; observedAtCollection = $true; note = 'Current file only; engine checksum is opaque and is not compared to SHA-256.' }
    # No network paths, relative paths, execution, or arbitrary extension reads.
    if ($ConfigPath -notmatch '^[A-Za-z]:[/\\]' -or [IO.Path]::GetExtension($ConfigPath) -ne '.cps') { return $evidence }
    try {
        $file = Get-Item -LiteralPath $ConfigPath
        if ($file.Length -gt 2MB) { return $evidence }
        $bytes = [IO.File]::ReadAllBytes($file.FullName)
        $source = $utf8.GetString($bytes)
        $evidence.sha256 = Get-Hash $bytes
        $evidence.release = [regex]::Match($source, 'var VERSION\s*=\s*"([^"]+)"').Groups[1].Value
        $evidence.configurationVersionExpression = [regex]::Match($source, '(?m)^version\s*=\s*([^;]+)').Groups[1].Value.Trim()
        $evidence.minimumRevision = [regex]::Match($source, '(?m)^minimumRevision\s*=\s*(\d+)').Groups[1].Value
    } catch { $evidence.readError = $_.Exception.Message }
    return $evidence
}
function Update-Latest([string]$Name, $Report, [string]$Text) {
    $jsonPath = Join-Path $Destination ($Name + '.json')
    if (Test-Path -LiteralPath $jsonPath) {
        try {
            $previous = Get-Content -LiteralPath $jsonPath -Raw | ConvertFrom-Json
            if ([DateTime]::Parse($previous.sourceModifiedUTC).ToUniversalTime() -gt [DateTime]::Parse($Report.sourceModifiedUTC).ToUniversalTime()) { return }
        } catch { } # A damaged index can be rebuilt from the immutable run folders.
    }
    Write-Text $jsonPath ($Report | ConvertTo-Json -Depth 30)
    Write-Text (Join-Path $Destination ($Name + '.txt')) $Text
}
function Save-Log([IO.FileInfo]$File) {
    if ($File.Length -gt 8MB) { throw "Engine log exceeds 8 MiB; left in place: $($File.FullName)" }
    $bytes = [IO.File]::ReadAllBytes($File.FullName)
    $text = $utf8.GetString($bytes)
    # Require a dedicated engine log identifying this post, not a mention in an application log.
    $identified = $text -match '(?m)^(?:Information: Vendor: Fusion360Next-NC|Vendor url: https://github.com/markmounteer/Fusion360Next-NC)\r?$' -or
        $text -match '(?m)^Configuration path: .*[/\\]next-nc\.cps\r?$'
    if (!$identified -or $text -notmatch '(?m)^Post processor engine:') { return }
    $complete = $text -match '(?m)^Post processing (?:failed|completed successfully)\.\s*$'
    $failed = $text -match '(?m)^(?:Error:|Post processing failed\.)'
    # Also retain a stable interrupted log, clearly distinguished from a finished run.
    if (!$complete -and ([DateTime]::UtcNow - $File.LastWriteTimeUtc).TotalSeconds -lt 10) { return 'retry' }
    $hash = Get-Hash $bytes
    $id = $File.LastWriteTimeUtc.ToString('yyyyMMddTHHmmssfffZ') + '-' + $hash.Substring(0, 12)
    $folder = Join-Path $Destination $id
    $reportPath = Join-Path $folder 'report.json'
    if (Test-Path -LiteralPath $reportPath) {
        # Repair indexes after a previous interrupted write without duplicating runs.
        $saved = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json
        $savedText = Get-Content -LiteralPath (Join-Path $folder 'report.txt') -Raw
        Update-Latest 'latest' $saved $savedText
        if ($failed) { Update-Latest 'latest-error' $saved $savedText }
        return
    }
    $detail = $null
    $match = [regex]::Match($text, '(?s)NEXTNC DIAGNOSTIC BEGIN\r?\n(.*?)\r?\nNEXTNC DIAGNOSTIC END')
    if ($match.Success) { try { $detail = $match.Groups[1].Value | ConvertFrom-Json } catch { } }
    $start = $null
    $match = [regex]::Match($text, '(?m)^NEXTNC START (\{.*\})\r?$')
    if ($match.Success) { try { $start = $match.Groups[1].Value | ConvertFrom-Json } catch { } }
    $configPath = Get-Field $text 'Configuration path'
    $checksum = Get-Field $text 'Checksum of configuration'
    $post = Get-PostEvidence $configPath
    $errors = @([regex]::Matches($text, '(?m)^Error:\s*(.*?)\r?$') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique)
    $primary = @($errors | Where-Object { $_ -notmatch '^(Failed to post|Output file has been closed|Failed while processing)' } | Select-Object -First 1)
    $diagnosis = 'Read the first specific error and operation details below.'
    $code = 'POST_FAILURE'
    if ($detail) { $primary = @($detail.error); $diagnosis = 'The Next-NC callback report identifies the failure and relevant operation settings.' }
    if ($text -match 'Post configuration is not compatible with this version') {
        $code = 'ENGINE_CONFIGURATION_INCOMPATIBLE'
        $diagnosis = 'The engine rejected the configuration before onOpen/precheck could run. Update the Next-NC post used by the Configuration path, then repost. Next-NC 0.1.1 incorrectly assigned its release number to Autodesk''s reserved version field; 0.1.2 restores version = "1.0". This does not require changing the Fusion operation. For a different post version, compare its minimumRevision and configuration version with the engine. Certification warnings are separate.'
    } elseif ($text -match '\[COMPENSATION\]|Controller-side tool-nose compensation|controller compensation is unsupported') {
        $code = 'CONTROLLER_COMPENSATION'
        $diagnosis = 'Edit the named Fusion operation > Passes > Compensation Type > In computer, regenerate the toolpath, and repost. Do not select Off merely to bypass validation.'
    }
    $status = if (!$complete) { 'incomplete' } elseif ($failed) { 'failed' } else { 'succeeded' }
    if (!$failed -and $complete) { $code = 'POST_SUCCEEDED'; $diagnosis = 'Engine reports successful export. This is not controller or machine validation.' }
    if (!$complete) { $diagnosis = 'No terminal engine result was found; this is an interrupted or incomplete log snapshot. ' + $diagnosis }
    $report = [ordered]@{
        schema = 'next-nc/collected-diagnostic/1'; collectorVersion = '0.1.2'; id = $id; status = $status; code = $code
        collectedUTC = [DateTime]::UtcNow.ToString('o'); sourceModifiedUTC = $File.LastWriteTimeUtc.ToString('o')
        sourceLog = $File.FullName; engineLogSHA256 = $hash; archiveDirectory = $folder
        engine = Get-Field $text 'Post processor engine'; configurationPath = $configPath
        configurationChecksumFromEngine = $checksum; inputChecksumFromEngine = Get-Field $text 'Checksum of intermediate NC data'
        outputPath = Get-Field $text 'Output path'; securityLevelFromEngine = Get-Field $text 'Security level'
        startTimeFromEngine = Get-Field $text 'Start time'; stopTimeFromEngine = Get-Field $text 'Stop time'
        primaryError = ($primary -join "`n"); diagnosis = $diagnosis; errors = $errors
        postAtCollection = $post; callbackStart = $start; callbackDiagnostic = $detail
        privacy = 'Local diagnostic only. May contain paths, operation names and recent coordinates. Review before sharing.'
    }
    [IO.Directory]::CreateDirectory($folder) | Out-Null
    [IO.File]::WriteAllBytes((Join-Path $folder 'engine.log'), $bytes)
    $summary = @"
Next-NC diagnostic: $status
Code: $code
Engine: $($report.engine)
Error: $($report.primaryError)

$diagnosis

Source log: $($File.FullName)
Collected UTC: $($report.collectedUTC)
Source modified UTC: $($report.sourceModifiedUTC)
Configuration: $configPath
Output: $($report.outputPath)
Archive: $folder
Raw engine log SHA-256: $hash
Post at collection (may differ from post at run time): $($post | ConvertTo-Json -Compress)

Full engine log, including any detailed Next-NC callback report:
----------------------------------------------------------------
$text
"@
    Write-Text (Join-Path $folder 'report.txt') $summary
    Write-Text $reportPath ($report | ConvertTo-Json -Depth 30)
    Update-Latest 'latest' $report $summary
    if ($failed) { Update-Latest 'latest-error' $report $summary }
    Write-Output $reportPath
}

# One collector per destination, including one-shot invocations.
$mutexName = 'Local\NextNC-' + (Get-Hash $utf8.GetBytes($Destination.ToLowerInvariant())).Substring(0, 24)
$mutex = New-Object System.Threading.Mutex($false, $mutexName)
$acquired = $false
try {
    try { $acquired = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $acquired = $true }
    if (!$acquired) { Write-Output "Collector already active for $Destination"; return }
    $seen = @{}
    do {
        $problems = @()
        if (Test-Path -LiteralPath $SourceRoot) {
            try {
                $logs = @(Get-ChildItem -LiteralPath $SourceRoot -Filter '*.log' -File -Recurse -ErrorAction Stop | Sort-Object LastWriteTimeUtc)
                foreach ($file in $logs) {
                    $stamp = "$($file.LastWriteTimeUtc.Ticks):$($file.Length)"
                    if ($seen[$file.FullName] -eq $stamp) { continue }
                    try {
                        $result = Save-Log $file
                        if ($result -ne 'retry') { $seen[$file.FullName] = $stamp; if ($result) { Write-Output $result } }
                    } catch { $problems += "$($file.FullName): $($_.Exception.Message)" }
                }
            } catch { $problems += $_.Exception.Message }
        }
        $health = [ordered]@{ collectorVersion = '0.1.2'; pid = $PID; watch = [bool]$Watch; checkedUTC = [DateTime]::UtcNow.ToString('o'); sourceRoot = $SourceRoot; destination = $Destination; problems = $problems }
        Write-Text (Join-Path $Destination 'collector-status.json') ($health | ConvertTo-Json -Depth 4)
        if ($Watch) { Start-Sleep -Seconds 3 }
    } while ($Watch)
} finally {
    if ($acquired) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
