# Next-NC turning toolpath profile 0.1

Status: experimental. Profile identifier: `next-nc/turning-toolpath/0.1`.

This is an AP238 AIM toolpath export, written as ISO 10303-21 Part 21 text with `FILE_SCHEMA(('INTEGRATED_CNC_SCHEMA'))`. It uses the common AP238 machining entities documented by STEP Tools. It is a CC1-style toolpath representation, **not a claim of complete CC1 conformance**. No independent EXPRESS validator or third-party STEP-NC interpreter has accepted the files yet.

## Entity mapping

| Meaning | Representation |
| --- | --- |
| Program | `MACHINING_PROJECT`, product definition and associated `MACHINING_WORKPLAN` |
| Ordered operation | `MACHINING_WORKINGSTEP` with description `machining`, and numbered `MACHINING_PROCESS_SEQUENCE_RELATIONSHIP` |
| Turning operation | `TURNING_TYPE_OPERATION`, connected by `MACHINING_OPERATION_RELATIONSHIP` |
| Toolpath-only feature | `INSTANCED_FEATURE`, `MACHINING_FEATURE_PROCESS`, `PROPERTY_PROCESS`, association to the workpiece |
| Logical tool | `MACHINING_TOOL` referencing the operation through `usage`; numeric tool number in `name` |
| Motion order | `MACHINING_TOOLPATH_SEQUENCE_RELATIONSHIP` with a positive, one-based real sequence number |
| Lines | `POLYLINE`, at least two `CARTESIAN_POINT` references |
| Arcs | `TRIMMED_CURVE` on `CIRCLE`, with `AXIS2_PLACEMENT_3D` |
| Rapid | `MACHINING_TOOLPATH_SPEED_PROFILE_REPRESENTATION` with descriptive value `rapid` |
| Feed and spindle | `MACHINING_TECHNOLOGY` and its standard feed/spindle representations |
| Coolant | `MACHINING_FUNCTIONS` with `coolant` and, when enabled, `coolant type` |
| Dwell | `MACHINING_TOOLPATH` description `feedstop`, with a `TIME_MEASURE` in seconds |

Workingsteps use the general `machining` classification because only a toolpath feature is supplied. The exporter does not invent the before/after feature sequence required by feature-based `turning` workingsteps. Tools are generic logical `cutting tool` resources, **not complete `turning cutting tool` assemblies**: holder dimensions and the standard turning-tool body properties are not fabricated. Actual tool geometry and offsets must be resolved against a controller tool table before execution.

## Coordinates and arcs

All coordinates use the selected program units in the Fusion setup WCS. X is a physical radial coordinate, Y is zero, and Z is axial. These are Fusion's programmed tool reference positions with compensation calculated in Fusion. An interpreter must apply a compatible tool-table reference convention; it must not add nose-radius compensation again.

Only an unrotated work plane is accepted: right is +X, forward is +Z. Secondary-spindle and mirrored/rotated setups are outside this profile. Values of Y within 1e-9 program units are normalized to zero; larger values are rejected. Coordinates are serialized without decimal truncation.

Arc axes are +Y, the normal of the ZX plane. `sense_agreement=.T.` means counterclockwise about +Y; `.F.` means clockwise. Endpoints specify partial-arc trims. Full circles use parameter trims 0 and 2π so that the resulting curve is bounded and retains a full revolution. Helices and spirals are not advertised by the CPS; the Autodesk kernel may linearize them before callbacks. Every callback point is still checked for Y=0.

Consecutive rapid or linear moves with identical feed, spindle and coolant state share a polyline. Every vertex remains present. Consistent arcs remain analytic. Since 0.1.3, a partial arc whose endpoint radii differ beyond the writer's numerical threshold can use Fusion's native linearizer, bounded by the existing post tolerance (0.002 mm) or a tighter supplied operation tolerance, with the radial mismatch deducted from that budget. Larger inconsistencies are rejected; generated endpoints must match the supplied endpoint. The log records these fallbacks and their tolerance. Compaction does not authorize blending, removal of clearance moves, faster feeds, path reordering or looser machining tolerances. A polyline is not an instruction to stop at each vertex; path planning remains the consumer's job.

## Feeds and spindle

Each cutting path has an explicit feed representation. Feed per minute uses a length/time derived unit. Feed per revolution uses a length/revolution derived unit. No RPM conversion is performed on feed per revolution.

Constant RPM uses a `spindle speed` representation with `rotational speed`. CSS uses a `cutting speed` representation with `surface speed` and `maximum rotational speed`. The maximum RPM must be positive; missing caps are rejected. CSS is expressed in the same length/minute units as Fusion's `tool.surfaceSpeed`, with **no metres/feet conversion needed**. The STEP unit graph carries the scale.

AP238 spindle speeds use the right-handed sign convention documented by STEP Tools: positive counterclockwise, negative clockwise. Fusion's direction boolean is converted explicitly. The maximum RPM is an unsigned magnitude. A consumer must apply that cap during CSS, including near X=0, and reject unsupported spindle modes.

## Next-NC execution properties

These are legal generic `ACTION_PROPERTY`/representation records, but their **names and meanings are project extensions**, not standardized AP238 offset or controller semantics. A generic STEP-NC reader may ignore them. It must not be assumed to execute this profile correctly.

| Attached to | Property | Meaning |
| --- | --- | --- |
| Workplan | `next-nc profile` | Required exact profile version identifier |
| Workplan | `next-nc coordinates` | Human-readable coordinate/reference convention |
| Operation | `next-nc tool offset` | Fusion compensation-offset integer, as a descriptive string |
| Operation | `next-nc work offset` | Fusion work-offset integer, as a descriptive string; 0 remains unspecified |
| Operation | `next-nc entry point` | Explicit initial section point, with length-unit geometric context |

Tool numbers and offset numbers are identities, not physical coordinates. Work offset 0 must not silently become LinuxCNC's current WCS. Work-offset mapping, tool/offset compatibility and any unspecified value need explicit resolution by the consumer before execution.

A section starts at its recorded entry point. No motion connects the previous section's endpoint to that entry point. A consumer must perform a validated transition, including tool change, offset selection, entry approach, and spindle/coolant sequencing. It must also implement a defined program-end stop. Connecting section points with a straight rapid is not a valid default.

## Errors and limitations

The CPS first prechecks every selected section's metadata and reports all affected operations together. Missing compensation metadata is not treated as proof of In computer; runtime validation still rejects controller-side compensation. See [diagnostics](troubleshooting.md).

The CPS buffers everything and writes only from `onClose` after successful serialization. A caught validation failure latches a failed state. A host may still create an empty or `.failed` output; only a complete, successfully posted document is an export. Buffering uses O(number of vertices) memory; large-job limits have not been benchmarked.

The program has no stock B-rep, part B-rep, fixtures, geometric tool assembly, feed optimization or feature-level toolpath generation. It does not promise smaller files than G-code: STEP entities are verbose, although adjacent lines and common technology records are shared. Better runtime efficiency would require measured changes to CAM toolpaths or controller planning, not a file-format change alone.

## Shared values in 0.1.4

Within one document, identical serialized immutable values reuse an entity reference: points, directions, descriptive/measure items, representations, resource types and derived-unit elements. The cache key includes the complete serialized record, including referenced units and representation contexts. No coordinate rounding or geometric tolerance is used to merge values. Each serialization starts with a fresh cache.

Operations, workingsteps, toolpaths, curves, properties and relationships retain separate identities. Equal coordinates do not merge different moves, remove repeated operations or override differing feed/spindle/coolant state. Consumers must follow the sequence relationships and resolve references; counting point definitions does not count motion vertices.

`Program.lastExport`, available after `toSTEP()`, reports entity count, reused value records, sections, paths, arcs, straight rapid/cutting segments and dwells. Straight segment counts exclude arcs; an N-vertex polyline contains N−1 straight segments. The Fusion adapter includes these counts in the `NEXTNC OUTPUT WRITTEN` log entry, alongside native arc-linearization counts.

## Local inspection

`npm run inspect -- input.stpnc [new-report.json]` uses a separate Part 21 subset reader and execution-profile decoder. It checks references, ordered workingsteps/paths, tool and offset identities, positive feed/spindle measures, mm/inch and time/revolution unit definitions, rapid classification, XZ geometry, arc frames/radii/senses and path continuity within each operation. Orphan/repeated operations and paths are rejected. Arc endpoint residuals use the writer's existing numerical threshold: the greater of 1e-7 program units and radius × 1e-6. Continuity permits 1e-9 program units for numerical reconstruction of full circles.

The JSON report includes full-precision values, per-operation feed and initial spindle settings, counts and overall coordinate bounds, including intermediate arc extrema. Bounds combine the numeric coordinates of all sections; different work offsets are not transformed into a common machine frame. They are not machine-travel or clearance checks. Section entry transitions remain the consumer's responsibility.

The command is read-only and never uploads data. The optional report must be a new file. It returns exit code 0 when the implemented checks pass, 1 on a validation/file error, or 2 for incorrect arguments. It intentionally supports the emitted Next-NC subset rather than arbitrary AP238 files. Passing it does not establish full EXPRESS conformance, third-party interoperability, fidelity to an unavailable Fusion simulation or safe machining.
