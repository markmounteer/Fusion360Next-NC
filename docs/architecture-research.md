# Architecture research applied in 0.1.7

The post continues to export Fusion's ordered XZ toolpaths. LinuxCNC remains responsible for trajectory planning, machine I/O and motion control. These changes add source checks and make the separate offline reader more efficient; they do not add CAM or machine options to the post.

## Evidence and decisions

| Source | Relevant result | Application and limit |
| --- | --- | --- |
| Liu, Zhang and Newman (2006), [10.1080/09511920600623690](https://doi.org/10.1080/09511920600623690), pp. 518–521 | Separate interpretation, planning, simulation and CNC kernel; validate and reconstruct relationships before execution; internal G-code kernel is retained. | Parse the complete document, index relationships by type and owner, and reject disconnected execution records. This is an application of the architecture, not the paper's code or a general EXPRESS implementation. |
| Minhat et al. (2009), [10.1016/j.rcim.2008.03.021](https://doi.org/10.1016/j.rcim.2008.03.021), pp. 563–568 | Layered data, buffering and physical execution; simulation uses the control model. Function-block applications were manually constructed in the prototype (p. 564). | Keep post, format reader and LinuxCNC backend separate; retain native engine and offline interpreter tests. Do not replace LinuxCNC's motion/I/O layers with the paper's Java/parallel-port prototype. |
| Álvares et al. (2020), [10.1109/ACCESS.2020.3017561](https://doi.org/10.1109/ACCESS.2020.3017561), pp. 152597–152609 | Several adapters connect CAM, STEP-NC and G-code; LinuxCNC's filter translates ISO 14649 input. Simulation requires machine/stock/tool geometry. Physical trials report significant dimensional/geometrical errors (p. 152608). | Preserve ordered toolpath semantics and validate adapter boundaries. This does not establish native general AP238 support, collision checking or accuracy on a turning machine. |

The papers were reviewed in full from user-supplied PDFs. Their full text, figure images and private machining files are not included in this repository. The current format remains `next-nc/turning-toolpath/0.1`, an experimental toolpath subset. Feature recognition, arbitrary workingstep reordering and autonomous process planning need additional data and a separately validated design.

## Implemented changes

- Fusion precheck identifies requested axis substitution, tailstock control and part-catcher control before writing output. Initial Y outside the existing zero-plane allowance is reported alongside other operation issues. Diagnostic snapshots include these values.
- Optional metadata access accepts only explicit Boolean or numeric 0/1 flags. Older engines without these optional accessors retain the existing runtime guards. Autodesk's `hasDynamicWorkOffset()` indicates that metadata is defined; it is logged with the actual value and is not alone grounds for rejection. Native sample posting exposed this distinction.
- The standalone Part 21 reader parses the three emitted header records and their attribute types, instead of accepting schema names found inside arbitrary text. It rejects duplicate headers, empty/duplicate complex components, excessive nesting and missing references, with record/line/column context where available. The input bound is 32 MiB and the nesting bound is 64.
- Entity-type, tool-owner and execution-relationship indexes replace repeated whole-document scans. The inspector rejects unused technology/functions records, detached execution relationships and invalid tool associations. Sharing geometry and using state records from multiple supported owners remain possible.
- `inspectDocument` lets the translator validate and decode the same parsed document once. It is an internal API for a document returned by this reader, not a validation bypass for caller-invented objects.

Section metadata APIs: [Autodesk Section reference](https://cam.autodesk.com/posts/reference/classSection.html). Controller adapter boundary: [LinuxCNC filter documentation](https://linuxcnc.org/docs/stable/html/gui/filter-programs.html).

## Bounded performance experiment

Windows, Node 24.13.1; synthetic alternating rapid/linear paths; one warmup and median of three measured runs, alternating old/new execution order. Times include parsing plus inspection. Baseline: Fusion360Next-NC 0.1.6 (`6c9247d`). Every decoded model and report compared exactly equal.

| Paths | STEP bytes | Old median ms | New median ms |
| ---: | ---: | ---: | ---: |
| 1,000 | 847,560 | 69.3 | 71.9 |
| 4,000 | 3,448,560 | 832.6 | 276.9 |
| 8,000 | 6,972,754 | 2,843.4 | 610.2 |

The smaller input was slightly slower. Large-input gains come from indexed relationship lookup; these measurements are host/workload specific and say nothing about machining cycle time. Structural validation is stricter, while valid machining semantics remain unchanged.
