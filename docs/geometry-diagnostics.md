# Shared reader diagnostics

The independent reader now attaches `stage`, `rule`, the owning operation/section
and path, STEP record and source line/column to geometry failures. Arc radius
failures include plane, units, endpoints, center, declared and measured radii,
mismatch and the actual acceptance threshold. Continuity failures include the
previous source exit, previous commanded exit, next source start and threshold.
Shared geometry is diagnosed in the context of the operation that uses it.

Only `NextNCValidationError` identifies an expected parser/inspector rejection.
Consumers can wrap that error while retaining its context; unexpected exceptions
remain implementation failures. The CLI prints this context with its error.

The matching LinuxCNCNext-NC consumer archives these details and displays
correction guidance in its HTML report. Review/regenerate source geometry in
Fusion; execution-plan edits cannot repair malformed curves. No geometry
tolerances, accepted machine profiles, decoded fingerprints or CPS behavior
changed in this reader update. Tests cover XZ turning and XYZ milling, mm/inch,
shared-geometry provenance, invalid normals and values on both sides of the
existing radius/join thresholds.

## Successful source provenance

`inspect()` and `inspectDocument()` also return a `provenance` sidecar with schema
`next-nc/source-provenance/1`. It identifies each workingstep, operation, tool,
entry/mapping property and toolpath use, with record IDs and one-based source
line/column. Polyline vertices, arc definitions/endpoints and process/dwell
properties retain their actual source references. Full-circle endpoints are
marked as derived from center, radius and reference direction.

The sidecar is outside the semantic `model` and its fingerprint. Shared geometry
retains separate owning uses; renumbering or reformatting a file changes its
provenance without changing its decoded program. `inputSHA256` identifies the
UTF-8 text supplied to `parse`, before CRLF normalization. An in-memory edited
parser document must not be represented as that original input; reserialize and
parse it before using source identities as evidence.

The LinuxCNC consumer includes the sidecar and per-command references in local
diagnostic reports. No Fusion post properties or generated toolpaths change.
