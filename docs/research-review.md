# Applying the TurnSTEP paper

Suh et al., [STEP-compliant CNC system for turning: Data model, architecture, and implementation](https://doi.org/10.1016/j.cad.2006.02.006), *Computer-Aided Design* 38 (2006), 677–688, describes a much broader system than the current Next-NC toolpath profile. It includes machining features, stock, tools, nonlinear plans, multiple turrets and monitored execution. Its historical standards/status statements should be read in their 2006 context.

The useful near-term principle is separation of responsibility: neutral authoring, machine-specific adaptation/verification and execution (pp. 681–685; Figs. 7, 16–17). Fusion already supplies CAM paths and process decisions. LinuxCNC owns machine control. The post should diagnose invalid or unsupported source data before serialization without duplicating either system's settings.

Version 0.1.6 therefore adds early tool/offset/WCS identity, entry-coordinate, initial RPM, direction and supplied-tolerance checks. It reports all affected sections, continues after metadata-read failures, and logs successful source facts. These checks do not certify machine suitability. No extra post options or changes to machining decisions were introduced.

The companion LinuxCNCNext-NC 0.4.0 translator adds offline preflight against an optional snapshot of the existing LinuxCNC tool table and detailed generated-line/segment/workingstep traceability. The latter takes inspiration from the paper's execution-to-workingstep mapping (pp. 685–686), but remains a diagnostic map rather than live execution monitoring.

The paper does not justify reconstructing machining features from toolpaths, guessing stock/fixtures, changing feeds, reordering cutting operations, applying tolerance blending automatically, or implementing unsupervised tool-breakage recovery. Those need additional authoritative geometry, process dependencies, tool data and live sensing. The multi-turret scheduling example does not predict a cycle-time saving on a single-spindle lathe. The current AP238 profile remains unchanged and has not become a general ISO 14649 or AP238 implementation.

The user-supplied paper and its full OCR are retained locally; only this original implementation summary and DOI citation are published.
