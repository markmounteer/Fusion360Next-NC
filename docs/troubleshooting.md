# Posting diagnostics

## Arc direction error in 0.1.2

`Next-NC: arc direction must be explicit` during `onCircular` can be caused by a post adapter bug, not an operation setting. Autodesk engine 5.413.5 supplies the clockwise callback argument as numeric `0` for counterclockwise (the API documents a Boolean). The writer requires an explicit JavaScript Boolean. Version **0.1.3** converts only `0`/`1` and `false`/`true` at the Fusion boundary, including the full-circle flag. Unknown, missing and string values still fail with the received value and type. The independent writer's Boolean validation remains strict.

Import the updated CPS and repost. No compensation, feed or geometry setting needs changing for this error. The saved diagnostic's final `onCircular` event retains the original argument, so `0` remains visible as evidence rather than being hidden by normalization. The native posting suite reproduces the old failure with Autodesk's profile sample and checks the corrected complete output. Synthetic tests additionally check clockwise direction and full circles.

The same sample exposed tiny endpoint-radius differences in the engine's arc coordinates. In 0.1.3, partial arcs rejected by the writer's radius consistency check may be linearized by Fusion if the mismatch fits within the post's existing 0.002 mm tolerance (or a tighter supplied operation tolerance). The mismatch is deducted from the tolerance passed to the native linearizer. The post verifies that the generated motion reaches the supplied endpoint and logs each fallback as `NEXTNC ARC LINEARIZED`. Invalid flags, invalid geometry, full-circle inconsistencies, excessive mismatch or unavailable linearization still stop export. There is no extra post property and the post does not invent a replacement center.

## Engine compatibility error in 0.1.1

`Post configuration is not compatible with this version of the post processor engine` can occur before any callback, including `onOpen`, runs. Version 0.1.1 accidentally set Autodesk's reserved `version` global to the project release (`0.1.1`). Version 0.1.2 restores **`version = "1.0"`**; the project release remains separately available as `NextNC.version`. Autodesk [documents this field as the configuration version](https://cam.autodesk.com/posts/reference/classPostProcessor.html), not the release number.

This regression was reproduced with Autodesk engine 5.413.5 and Autodesk's facing sample: the incorrect field fails during global initialization, and the corrected field allows the sample to post successfully. Import **0.1.2 or later** into the Fusion Post Library and select that copy. Check **Configuration path** in the log to identify the exact file Fusion used. Updating a downloaded copy does not update a previously imported cloud copy. No Fusion compensation or LinuxCNC settings need changing to fix this compatibility error.

Interrogating a CPS with `--interrogate` does **not** exercise this compatibility gate. The project now includes an actual native-posting regression test as well as a configuration-version unit check.

## Automatic Windows log archive

The stable location is:

```text
%LOCALAPPDATA%\Fusion360Next-NC\diagnostics\
    latest-error.txt       Most recent failed run, with explanation and full log
    latest-error.json      Same report as structured data
    latest.txt/json        Most recent run, including successful runs
    collector-status.json Last scan time, process ID and collection problems
    <UTC timestamp>-<hash>\
        engine.log        Original bytes from Fusion's post log
        report.txt        Readable diagnosis and full log
        report.json       Version/path/checksum evidence and callback report
```

Download and extract `diagnostics-windows.zip` from the release. In PowerShell, run from the extracted folder:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-diagnostics.ps1
```

This copies the two scripts to `%LOCALAPPDATA%\Fusion360Next-NC`, starts a hidden current-user collector, and creates **Fusion360Next-NC Diagnostics** in the user's Startup folder. It needs neither Node.js nor administrator rights. It scans `%LOCALAPPDATA%\Temp\Fusion360CAM` every three seconds for dedicated Next-NC engine logs. It preserves existing and future logs, including initialization failures, and retries locked files. A stable log without a terminal result is archived after ten seconds as **incomplete** and collected again if it changes. Later successes do not erase `latest-error`. Timestamp/hash folders retain the history; there is no automatic deletion.

The CPS writes its details through Autodesk's `log()` API. It does not lower Fusion's security level or launch a helper process. The separate collector is necessary because an incompatible or syntactically invalid CPS cannot execute its own diagnostic callbacks. If the collector is stopped, details remain in Fusion's temporary engine log until Fusion/Windows removes it; there is no promise of recovery after that removal. Check `collector-status.json` for a recent `checkedUTC` and an empty `problems` list. Logs larger than 8 MiB are left in place and reported there.

For a one-time collection when the watcher is stopped:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\collect-diagnostics.ps1
```

To stop collection and remove its sign-in shortcut, while retaining the reports:

```powershell
& "$env:LOCALAPPDATA\Fusion360Next-NC\install-diagnostics.ps1" -Uninstall
```

This is a Windows/Fusion log collector; it does not connect to LinuxCNC. It makes no network requests and does not gather Fusion application logs, account tokens, CAD files or complete toolpaths. Reports do contain local paths, operation names and up to 12 recent callback arguments (including coordinates); review them before publishing. The configuration file hash is observed at collection time and can differ from the file used at posting time. Autodesk's opaque log checksum is retained separately, not equated with the SHA-256 file hash.

## Detailed callback reports

From 0.1.2, the first callback failure writes a `NEXTNC DIAGNOSTIC` block to the full engine log. It includes the exact error, UTC timestamps, release/profile/configuration versions, engine version, security API result, source/output paths, units, section count, active operation, failing callback, record/NC location, stack when available, active spindle/feed state and the last 12 events. The first 200 section snapshots include tool and work offsets, compensation metadata, feed/spindle/coolant settings, work-plane vectors and all issues found for that section. All selected sections are still checked, and all precheck failures appear in the error text, even beyond the snapshot limit.

The first error is preserved if later callbacks fail. A diagnostic API/logging failure cannot turn a rejected program into a successful export or replace its original error. Successful runs record start metadata and an output-written marker; the final engine result determines the collector's success status. Engine initialization failures have engine-level evidence only: missing callback details are expected and are not fabricated.

## Section precheck

Starting in 0.1.1, Next-NC checks all selected machining sections in `onOpen`, before motion callbacks or STEP output. Errors are grouped by operation, section number and tool. Fix the listed operations together, regenerate their toolpaths, then post again.

## Controller-side compensation

A typical precheck message looks like this (synthetic example):

```text
Next-NC 0.1.1 precheck failed: 1 of 2 section(s) need attention.

Operation "Facing" (section 2, tool T7):
  - [COMPENSATION] Compensation Type is In control. This requests controller-side
    compensation, which this post does not support. In Fusion, edit this operation
    > Passes > Compensation Type > In computer, regenerate its toolpath, then post again.
    Do not select Off just to bypass this check; Off removes compensation.

No STEP-NC program was written.
```

The precheck reads Fusion's `operation:compensationType` parameter per section. It recognizes `computer`, `control`, `wear`, `inverseWear`, and `off`. In control, Wear and Inverse wear are rejected because this exporter does not implement controller-side cutter/tool-nose compensation. Unknown values are reported explicitly. Intentional Off settings remain allowed; Off is not a substitute for In computer.

When Fusion does not provide the parameter, precheck leaves the setting undetermined. If a later motion requests left or right controller compensation, the runtime diagnostic identifies the operation and the request, explains the missing metadata, and gives the correction. If the metadata says In computer but motion still requests controller compensation, it reports that discrepancy and advises regenerating the selected operation. It never drops the compensation request to make the export succeed.

## Other early checks

Precheck also reports the existing unsupported section conditions: non-turning/multi-axis sections, optional sections, secondary spindles, rotated/mirrored work planes, cycles, unsupported feed/spindle modes and coolant, plus invalid CSS speed or maximum RPM. Multiple conditions can appear under the same operation.

This is a metadata check, not a complete simulation or inspection of every motion record. Numeric geometry, arc consistency, changing process state, Manual NC and other commands still have runtime validation. There is no guarantee that a successful precheck means the entire export will succeed or that the result is machine-ready.

## Certification warning

The Autodesk engine may separately warn that this experimental post declares certification level 0 while the engine expects level 2. That warning is distinct from the fatal Next-NC diagnostics. The release does not change its declared certification level merely to hide the warning.

## Updating the post

Download the new `next-nc.cps` from the release and replace/re-import the copy used by your Fusion Post Library. A downloaded file alone does not update an already imported local/cloud copy. A precheck failure includes the Next-NC version; verify the configuration path in Fusion's log if you still see the old message.
