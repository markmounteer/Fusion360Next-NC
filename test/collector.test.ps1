# SPDX-License-Identifier: MIT
$ErrorActionPreference = 'Stop'
$collector = Join-Path $PSScriptRoot '..\scripts\collect-diagnostics.ps1'
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('next-nc-collector-test-' + [Guid]::NewGuid().ToString('N'))
$source = Join-Path $temporary 'source'
$destination = Join-Path $temporary 'reports'
$watcher = $null
[IO.Directory]::CreateDirectory($source) | Out-Null
function Check($Condition, [string]$Message) { if (!$Condition) { throw $Message } }
function Fixture([string]$Name, [string]$Body, [DateTime]$Time) {
    $path = Join-Path $source $Name
    $content = "Information: Vendor: Fusion360Next-NC`nPost processor engine: 5.413.5`nConfiguration path: missing.cps`nOutput path: synthetic.stpnc`n" + $Body
    [IO.File]::WriteAllText($path, $content)
    [IO.File]::SetLastWriteTimeUtc($path, $Time)
    return $path
}
function Collect { & $collector -SourceRoot $source -Destination $destination | Out-Null }
function Read-Report([string]$Name = 'latest') { return Get-Content -LiteralPath (Join-Path $destination ($Name + '.json')) -Raw | ConvertFrom-Json }
function Count-Runs { return @(Get-ChildItem -LiteralPath $destination -Directory).Count }
function File-Hash([string]$Path) {
    $hash = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($hash.ComputeHash([IO.File]::ReadAllBytes($Path)))).Replace('-', '').ToLowerInvariant() }
    finally { $hash.Dispose() }
}
try {
    $earlier = [DateTime]::UtcNow.AddMinutes(-10)
    $compat = Fixture '1001.log' "Error: Failed to post process. See below for details.`nError: Post configuration is not compatible with this version of the post processor engine.`nFailed while processing global script.`nPost processing failed.`n" $earlier
    [IO.File]::WriteAllText((Join-Path $source 'unrelated.log'), 'An unrelated log mentions Fusion360Next-NC')
    Collect
    $report = Read-Report
    Check ($report.code -eq 'ENGINE_CONFIGURATION_INCOMPATIBLE') 'Compatibility diagnosis absent'
    Check ($report.primaryError -like 'Post configuration is not compatible*') 'Generic banner hid primary error'
    Check ($report.diagnosis -like '*before onOpen*') 'Initialization boundary absent'
    Check ((Count-Runs) -eq 1) 'Unrelated log collected'
    $originalHash = File-Hash $compat
    Check ($report.engineLogSHA256 -eq $originalHash) 'Raw log hash changed'
    Check ((File-Hash (Join-Path $report.archiveDirectory 'engine.log')) -eq $originalHash) 'Original bytes not preserved'
    Collect
    Check ((Count-Runs) -eq 1) 'Duplicate archive on rescan'
    $success = Fixture 'success.log' "NEXTNC START {`"release`":`"0.1.2`"}`nPost processing completed successfully.`n" $earlier.AddMinutes(1)
    Collect
    Check ((Read-Report).status -eq 'succeeded') 'Latest success not indexed'
    Check ((Read-Report 'latest-error').code -eq 'ENGINE_CONFIGURATION_INCOMPATIBLE') 'Success overwrote latest-error'
    $body = @'
NEXTNC DIAGNOSTIC BEGIN
{"schema":"next-nc/diagnostic/1","release":"0.1.2","callback":"onLinear","record":542,"error":"Synthetic off-plane motion","sections":[{"tool":7}],"recentEvents":[{"callback":"onLinear","arguments":[1,2,3,4]}]}
NEXTNC DIAGNOSTIC END
Error: Synthetic off-plane motion
Post processing failed.
'@
    $detail = Fixture 'detail.log' $body $earlier.AddMinutes(2)
    Collect
    $report = Read-Report 'latest-error'
    Check ($report.callbackDiagnostic.record -eq 542) 'Structured report not extracted'
    Check ($report.callbackDiagnostic.sections[0].tool -eq 7) 'Tool context lost'
    Check ($report.callbackDiagnostic.recentEvents[0].arguments.Count -eq 4) 'Trace lost'
    Check ($report.primaryError -eq 'Synthetic off-plane motion') 'Specific report error lost'
    $partial = Fixture 'partial.log' "Error: Synthetic interrupted run`n" $earlier.AddMinutes(3)
    Collect
    Check ((Read-Report).status -eq 'incomplete') 'Partial log treated as complete'
    [IO.File]::AppendAllText($partial, "Post processing failed.`n")
    [IO.File]::SetLastWriteTimeUtc($partial, $earlier.AddMinutes(4))
    Collect
    Check ((Read-Report).status -eq 'failed') 'Final log not recollected'
    Check ((Count-Runs) -eq 5) 'Incomplete snapshot or completed log lost'
    # Older logs must never displace the latest failure when rediscovered.
    Fixture 'older.log' "Error: Older failure`nPost processing failed.`n" $earlier.AddMinutes(-1) | Out-Null
    Collect
    Check ((Read-Report 'latest-error').primaryError -eq 'Synthetic interrupted run') 'Older log displaced latest error'
    # Simulate a locked file, then confirm the next pass retries it.
    $locked = Fixture 'locked.log' "Error: Locked failure`nPost processing failed.`n" $earlier.AddMinutes(5)
    $stream = [IO.File]::Open($locked, 'Open', 'ReadWrite', 'None')
    try {
        Collect
        $health = Get-Content -LiteralPath (Join-Path $destination 'collector-status.json') -Raw | ConvertFrom-Json
        Check ($health.problems.Count -eq 1) 'Locked file not reported'
    } finally { $stream.Dispose() }
    Collect
    Check ((Read-Report).primaryError -eq 'Locked failure') 'Locked file not retried'
    $syntax = Join-Path $source 'syntax.log'
    [IO.File]::WriteAllText($syntax, "Post processor engine: 5.413.5`nConfiguration path: C:\synthetic\next-nc.cps`nError: Synthetic syntax error`nPost processing failed.`n")
    [IO.File]::SetLastWriteTimeUtc($syntax, $earlier.AddMinutes(5).AddSeconds(1))
    Collect
    Check ((Read-Report).primaryError -eq 'Synthetic syntax error') 'Startup failure before vendor metadata was missed'
    # Verify continuous collection, not only the one-shot path.
    $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $args = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $collector + '" -Watch -SourceRoot "' + $source + '" -Destination "' + $destination + '"'
    $watcher = Start-Process -FilePath $ps -ArgumentList $args -WindowStyle Hidden -PassThru
    $deadline = [DateTime]::UtcNow.AddSeconds(12)
    do {
        Start-Sleep -Milliseconds 300
        $health = Get-Content -LiteralPath (Join-Path $destination 'collector-status.json') -Raw | ConvertFrom-Json
    } while ($health.pid -ne $watcher.Id -and [DateTime]::UtcNow -lt $deadline)
    Check ($health.pid -eq $watcher.Id -and $health.watch) 'Watcher did not finish its initial scan'
    Fixture 'watch.log' "Error: Watched failure`nPost processing failed.`n" $earlier.AddMinutes(6) | Out-Null
    $deadline = [DateTime]::UtcNow.AddSeconds(12)
    do { Start-Sleep -Milliseconds 300; $observed = (Read-Report).primaryError -eq 'Watched failure' } while (!$observed -and [DateTime]::UtcNow -lt $deadline)
    Check $observed 'Watcher did not collect a new failure'
    Write-Output 'PASS: collector filtering, compatibility diagnosis, raw bytes, deduplication, latest-error retention, structured details, incomplete logs, chronology, retry, and continuous collection.'
} finally {
    if ($watcher -and !$watcher.HasExited) { Stop-Process -Id $watcher.Id; $watcher.WaitForExit(5000) | Out-Null }
    $resolved = [IO.Path]::GetFullPath($temporary)
    Check ([IO.Path]::GetDirectoryName($resolved) -eq [IO.Path]::GetTempPath().TrimEnd('\')) 'Unsafe test cleanup parent'
    Check ([IO.Path]::GetFileName($resolved).StartsWith('next-nc-collector-test-')) 'Unsafe test cleanup prefix'
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
