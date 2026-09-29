# Fusion post and LinuxCNC translator integration

Fusion360Next-NC v0.3.0 uses the existing turning and fixed-axis XYZ milling
profiles accepted by LinuxCNCNext-NC v0.11.0. The writer's only change is its
release identifier. Existing decoded programs and fingerprints are unchanged.
The translator does not need a schema change or new machine settings.

## Added milling support

The CPS delegates these fixed XYZ milling cycles to Autodesk's
[`expandCyclePoint`](https://cam.autodesk.com/posts/reference/classPostProcessor.html):

| Fusion cycle identifier | Exported representation |
| --- | --- |
| `drilling` | Explicit approach, feed plunge and retract moves |
| `counter-boring` | Explicit moves and requested positive dwell |
| `chip-breaking` | Fusion-expanded pecks and retracts |
| `deep-drilling` | Fusion-expanded pecks, full retracts and requested dwell |

Fusion supplies depth, feeds, pecks and clearance. The post retains the returned
motion sequence and never supplies its own peck distances or clearance policy.
It leaves Autodesk's optional machine-parameter defaults untouched. The cycle
names and expansion semantics are documented in Autodesk's
[cycle reference](https://cam.autodesk.com/posts/reference/cycles.html).

Available cycle-type metadata is checked before posting. If it is missing,
the runtime checks the actual cycle identifier before expanding it. Unexpected
commands, spindle-stop requests, missing/nested/unfinished cycles, and expansion
without a cutting move stop the export. Diagnostics include the current cycle,
available parameters and completed point count. Success logs list expanded
types and total points. A zero dwell remains zero; no dwell is invented.

This does not implement turning cycles, tapping/thread synchronization, probing,
boring with spindle stops/orientation, arbitrary cycles or multi-axis drilling.
Expanded drilling uses the existing mill toolpath profile, not new STEP-NC cycle
entities. There are still zero user-defined post properties.

## Existing translator capabilities retained

The post already supplies units, logical tools/offsets/WCS, exact operation
boundaries, RPM/CSS and CSS caps, direction, feed mode, coolant, dwell, full
circles and supported principal-plane arcs. Tests now exercise those outputs
through the pinned translator, including its post-M6 state restoration and
three mandatory execution audits.

Fusion owns CAM paths and compensation. The translator's reviewed execution
plan owns tool/WCS mappings and entry, retract, continuation or link policy.
LinuxCNC owns configured offsets and machine behavior. The CPS does not generate
a supposedly safe plan, guess tool-table contents or launch the translator.
An export over the reader's 32 MiB input limit is rejected before writing.

## Use

1. Import the updated `posts/next-nc.cps` into Fusion's Post Library.
2. Post one XZ turning or fixed XYZ milling setup. Supported drilling operations
   require no new post setting.
3. Use LinuxCNCNext-NC v0.11.0 to inspect the export, generate/review its execution
   plan, and preflight the candidate output using its existing workflow.
4. Keep a plan only when its program fingerprint matches the new decoded program.
   A newly included drilling operation changes that fingerprint.

Successful posting does not certify physical clearance or machine readiness.
This remains an experimental offline translation workflow.

## Reproducible evidence

`scripts/translator-baseline.json` pins consumer commit
`6ada457997eb9dba83edffcf68df99e99a68e25f` (v0.11.0). The test helper verifies the
commit and clean tracked files. It is a development-only dependency; the CPS
remains standalone. CI checks both operating systems on Node 20/22/24.

```powershell
$env:LINUXCNC_NEXTNC = 'C:\dev\LinuxCNCNext-NC' # checkout at the pinned revision
npm run test:translator
$env:AUTODESK_POST = 'path\to\your\installed\post.exe'
npm run test:posting
```

The native suite downloads hash-pinned public Autodesk samples, never user jobs.
With both environment variables supplied, every successful native sample also
passes translator inspection, synthetic-plan binding, ordered completeness,
independent policy and final-text serialization checks. Test-only plans use
arbitrary fixture coordinates; they are never produced by the CPS or suitable
for a machine. The test does not execute the resulting G-code.

Local validation with Autodesk engine 5.413.5:

- 78 Node test groups pass, including cycle acceptance/rejection, failure
  diagnostics, callback ordering and the output-size guard.
- Four CPS-to-translator scenarios pass: lathe/mill, each in mm/inch, with feed
  modes, arc directions, full circles, tool/offset changes, coolant and dwell.
- All four native drilling samples pass. Their ordered move/dwell counts are
  9, 9, 131 and 183 respectively; each exactly matches the native callback trace.
- The public counter-boring fixture requests zero dwell. A separate, explicitly
  synthetic native test sets dwell to 0.25 s and preserves both requested dwells.
- Native turning face/profile and milling face/bore/toolchange samples pass;
  tapping and controller compensation are rejected without complete output.
- Ten successful native outputs pass the v0.11.0 translator audits.

Native samples are metric. Inch coverage uses synthetic CPS callbacks, not a
native inch CAM input. No Fusion GUI repost of the user's job, LinuxCNC native
interpreter run, hardware execution or full AP238 certification is claimed.

The separate step-nc-adapters lexical/API plan in the translator repository
remains planned. This release uses capabilities already implemented in v0.11.0.
