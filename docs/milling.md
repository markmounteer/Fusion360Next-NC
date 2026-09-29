# XYZ milling profile (introduced in v0.2.0)

The post automatically selects `next-nc/milling-toolpath/0.1` for Fusion milling sections. It selects the unchanged turning profile for turning. Mixed machine types are rejected before motion; the section type is rechecked during export. No machine-type switch is added to post properties.

Milling is fixed-axis XYZ with an unrotated +Z tool axis. The workplan's coordinate property is `WCS; XYZ Cartesian; fixed +Z tool axis; Fusion tool reference point`. Operations use `MILLING_TYPE_OPERATION` and milling technology/function descriptions. The rest of the ordered workplan/workingstep/toolpath graph and unit encoding follows [the existing format](format.md).

Coordinates are physical Cartesian XYZ. Fusion's `tool.lengthOffset` is exported as the logical tool offset; the LinuxCNC consumer maps this to an existing H record. Neither application generates tool-table measurements. For turning, `tool.compensationOffset` remains the source.

Native arcs may be XY (+Z normal), XZ (+Y) or YZ (+X). Trimming sense preserves Fusion's CW/CCW flag; full circles remain bounded complete circles. A planar arc must keep its perpendicular coordinate constant. In the library:

```js
const p = new Program({machine: "mill", units: "mm"});
// Add a section with explicit XYZ entry, logical tool/offset, WCS, RPM and coolant.
// section.arc(end, center, clockwise, feed, fullCircle, "XY");
```

The optional arc plane defaults to XY for a mill and XZ for a lathe. Milling RPM is required; CSS is rejected. There is no change to feed values, cutting depths, compensation or operation order.

The Fusion adapter delegates helical approximation to `linearize()` at the tighter operation/post tolerance. All returned vertices are retained. It then requires the callback endpoint, allowing only coordinate-scaled floating-point roundoff (32 machine epsilons, capped per axis at one millionth of that tolerance); when needed it appends the exact supplied endpoint. Larger discrepancies fail. This endpoint allowance does not permit general path fitting or tolerance-based snapping. Native Autodesk bore samples exercise the roundoff case. Helices appear in the file as polylines, not additional unsupported STEP entities.

Since v0.3.0, Fusion expands fixed XYZ `drilling`, `counter-boring`, `chip-breaking` and `deep-drilling` into ordinary moves and dwells. The post preserves these callbacks and diagnoses failed/incomplete expansion; no STEP-NC or LinuxCNC canned cycle is emitted. See [integration and validation](translator-integration.md).

Rotary/indexed/multi-axis machining, tilted work planes, probing, other cycles, threading/tapping, controller compensation, optional sections and secondary spindles remain rejected. Helical boring as a resolved milling toolpath is supported; cycles requiring spindle stops or orientation are not. LinuxCNCNext-NC v0.5.0 consumes this profile and requires a machine-specific execution-plan/4 with reviewed XYZ transitions; v0.11.0 is the pinned integration-test baseline.

Inspection reports add machine/profile identity. Only milling decoded models add `machine: "mill"` and per-arc `plane`; legacy turning models/fingerprints retain their exact field layout. This profile is an experimental AP238 subset, not certified interoperability with arbitrary STEP-NC systems.
