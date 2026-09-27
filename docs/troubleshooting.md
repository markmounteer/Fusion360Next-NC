# Posting diagnostics

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
