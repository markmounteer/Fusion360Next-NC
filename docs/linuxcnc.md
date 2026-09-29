# LinuxCNC integration boundary

This repository produces files. It does not install a LinuxCNC interpreter, change a machine configuration, or implement motion control.

The separate public [LinuxCNCNext-NC](https://github.com/markmounteer/LinuxCNCNext-NC) repository now implements a bounded Next-NC-to-LinuxCNC G-code translator and file filter. It preserves the exported paths/process states, requires explicit tool/WCS mappings and reviewed entry/retract plans, and includes synthetic offline `rs274` interpreter tests. See that repository's validation record and setup guide. It does not install itself on a physical machine or establish machine readiness.

LinuxCNC normally executes RS274 G-code. It documents an optional `[TASK] INTERPRETER` shared-library setting and input filters. The translator takes the filter approach, so execution still uses the G-code interpreter. A native Next-NC interpreter would instead map the accepted AP238/profile content into LinuxCNC's canonical machining interface and retain LinuxCNC's trajectory planner, motion subsystem and HAL. See the [INI configuration reference](https://linuxcnc.org/docs/stable/html/config/ini-config.html) and [filter documentation](https://linuxcnc.org/docs/stable/html/gui/filter-programs.html).

## Required consumer work

1. Parse Part 21 and validate the AP238 subset, profile identifier, entity references, sequence ordering, units, curve geometry and process state. Reject unknown required behavior.
2. Resolve the logical tools, offsets and Fusion WCS numbers to the actual LinuxCNC configuration. Confirm the Fusion tool-reference convention, X-radius coordinates and active tool-table offsets agree.
3. Implement controlled section entry, tool change and program end. The file provides targets and process settings; it does not supply a machine-safe tool-change or home path.
4. Map lines, arcs, dwell, CSS with RPM cap, spindle direction, feed per revolution and coolant. Require the necessary spindle feedback for any mode that depends on it.
5. Integrate preview, error locations, stop/resume, abort, run-from-line/restart, MDI coexistence, tool-table changes and overrides. A parser that emits motions alone is insufficient.
6. Validate in simulation against a reference Fusion/G-code program before any operator-supervised machine acceptance.

Threading, tapping, turning cycles, unsupported milling cycles and multi-axis motion are rejected by this exporter. Since v0.3.0, four nonsynchronized milling drilling cycles use Fusion's native expansion into explicit moves/dwells; see [the integration contract](translator-integration.md). Synchronized threading must never be treated as an ordinary line.

## Proposed milestones

- **Exporter (this repository):** bounded, documented turning toolpaths with automated structural and callback tests.
- **Interoperability:** independent EXPRESS/schema validation and a known STEP-NC reader, then real Fusion turning fixtures for both unit systems.
- **Simulator:** read-only geometry/technology preview and comparison against the CAM result.
- **LinuxCNC prototype:** interpreter integration in a simulation configuration; no direct HAL motion implementation.
- **Machine acceptance:** setup-specific validation of references, offsets, tool changes, entry moves, CSS, stop/abort and recovery.

The first implementation targets the toolpath that Fusion already calculated. Moving machining strategy generation into LinuxCNC would be a substantially larger CAM implementation, beyond the role of a post processor.
