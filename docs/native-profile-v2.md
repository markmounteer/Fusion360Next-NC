# Native profile revision 2

The native CPS emits `next-nc/turning-toolpath/0.2` or
`next-nc/milling-toolpath/0.2`. These are experimental Next-NC profiles inside a
Part 21/AP238-shaped graph, not a claim of general ISO STEP-NC conformance.
The JavaScript writer's default remains revision 1 for existing API clients;
`new Program({..., profileRevision: 2})` selects the native profile explicitly.
There is no Fusion post option to downgrade or discard native semantics.

Revision 2 requires three descriptive properties:

| Owner | Property | Value |
| --- | --- | --- |
| Workplan | `next-nc required capabilities` | Sorted, duplicate-free JSON array, exactly matching requirements derived from the complete job |
| Operation | `next-nc tolerance` | JSON `{value, provenance}`; positive value in source length units with `fusion:operation:tolerance` or `source-declared`, or null with `missing` |
| Toolpath | `next-nc movement` | Explicit movement class, including `unspecified` when not supplied |

Tolerance is CAM intent, not automatic permission for extra fit or blend error.
Missing tolerance never becomes the post's linearization tolerance or a controller
default. Movement classes are rapid, cutting, finish-cutting, lead-in, lead-out,
link-transition, link-direct, ramp-helix, ramp-profile, ramp-zig-zag, ramp, plunge,
predrill, extended, reduced and high-feed. A change prevents path compaction.

Circular/helical native paths carry `next-nc circular motion`, a descriptive JSON
object with exactly `start`, `end`, `center`, `plane`, `clockwise`, `sweepRadians`
and `axialRise`. They have no `basic curve`: a helix must never masquerade as an
AP238 planar CIRCLE. Source lengths retain the declared mm/inch units. Sweep is
positive total radians, direction is explicit Boolean, and signed axial rise is
independent of direction. The center is an axis point at the start axial height.
Right-handed bases are XY=(X,Y), XZ=(Z,X), YZ=(Y,Z). The writer/reader limit a
single record to 10000 revolutions; the Fusion engine is configured to split
records above 1000 revolutions while preserving analytic geometry.

The native callback's supplied sweep and exact endpoints are retained. See
[Autodesk's circular callback API](https://cam.autodesk.com/posts/reference/classPostProcessor.html).
The non-helical radius-mismatch fallback remains explicitly logged and bounded
by the existing CAM/post linearization allowance. Helices never use that fallback.

The pinned legacy JavaScript translator supports revision 1 only and must reject
revision 2, including revision-2 properties smuggled under an old profile label.
Its G-code path is not the native consumer. The implemented
[Rust compiler](https://github.com/markmounteer/LinuxCNCNext-NC/blob/main/docs/native-compiler.md)
accepts revision 1 and revision 2 and prepares audited native command bundles.
The task adapter is implemented in the separate custom LinuxCNC controller
repository. Standalone compiler commands do not move a machine; native execution
requires that controller integration, compatible installed components and a
reviewed setup. These implementations do not establish physical acceptance or
general STEP-NC conformance.

Requirements include linear, planar-arc, helix, multiple-turns, completion,
spindle, tool-change, tool-offset, coolant, dwell, feed-per-revolution and CSS as
applicable. A requirement is not installed capability evidence. Through-tool
coolant remains unsupported by the current target and the CPS diagnoses it before
export. It never substitutes Flood or Mist. Feed/revolution and CSS survive as
dimensioned intent; runtime admission still requires synchronization support.

Revision-1 decoded fingerprints are unchanged. Revision-2 fingerprints use
`next-nc/decoded-program/2` and include tolerance, movement, sweep, rise and required
capabilities. Changing any of them invalidates a plan bound to the old fingerprint.
Objects are decoded in a fixed field order regardless of JSON property order.
Native circular models retain the seven source fields; computed radius and other
floating-point metrics stay outside the fingerprint because math libraries may
round those derived values differently. Revision-1 declared circle radius is
still a source field and its fingerprint is unchanged.

Validation commands: `npm test`, `npm run check:build`, and
`npm run test:posting` with `AUTODESK_POST` pointing to the installed post engine.
Set `NEXTNC_POST_EVIDENCE` to preserve native outputs/logs/inspection results.
The native test compares every retained circular callback's start, end, center,
plane, direction, total sweep, axial rise and feed with the independently decoded
output. Fixture tests cover both units, both senses, three planes and multiple
turns; synthetic fixtures are not a physical machine clearance test.

CI keeps two explicit interoperability lanes. `npm run test:translator` checks
that the retained revision-1 writer API still passes the pinned legacy execution
audits and that native CPS output is rejected, even with a forged old profile
label. `npm run test:native-translator` compares current generated CPS callback
output with the pinned Rust decoder in both machines and units. It requires
`NEXTNC_NATIVE_ROOT` and the commit in `scripts/native-translator-baseline.json`.
The native lane is pinned to Rust compiler main checkpoint
`41e89aadee32d590bb12f8e82b03e051dbdbe5b5`. It checks complete ordered source
models and fingerprints for lathe/mill in mm/inch. Its use of `inspect` does not
test native command compilation or execution, even though those implementations
exist separately. The commit pin and CI checkout must change together when
updating this compatibility checkpoint.
