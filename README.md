# Fusion360Next-NC

[![Tests](https://github.com/markmounteer/Fusion360Next-NC/actions/workflows/ci.yml/badge.svg)](https://github.com/markmounteer/Fusion360Next-NC/actions/workflows/ci.yml)

An experimental Autodesk Fusion post processor and JavaScript library for **toolpath-level STEP-NC/AP238**, for a single-spindle XZ lathe or fixed-axis XYZ mill.

**Next-NC is the project name.** The output is an ISO 10303-21 text file using the AP238 `INTEGRATED_CNC_SCHEMA`, with a small, documented Next-NC execution profile. It is not G-code, and stock LinuxCNC cannot execute it directly. The separate [LinuxCNCNext-NC translator](https://github.com/markmounteer/LinuxCNCNext-NC) provides an experimental G-code input-filter bridge with explicit machine/setup plans. A native STEP-NC interpreter remains unimplemented. AP238 conformance and third-party interoperability have not been certified or independently validated.

## Get the post

Download [posts/next-nc.cps](posts/next-nc.cps). It is a standalone file; Node.js is not needed to use it in Fusion.

1. Open Fusion's **Post Library** and select **My Posts → Local**.
2. Import `next-nc.cps` and select **Next-NC - experimental AP238 XZ turning / XYZ milling** when posting.
3. Use XZ turning or fixed-axis XYZ milling operations, the primary spindle, an unrotated work plane, and compensation **In computer**. Export each machine type separately.
4. Post to a new `.stpnc` file for inspection and development. Do not send it to a machine expecting G-code.

See Autodesk's [Post Library instructions](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/MFG-ADD-POST-PROCESSOR-TO-LIBRARY.htm).

**0.3.0 adds Fusion-expanded milling drilling cycles and automated compatibility checks against LinuxCNCNext-NC v0.11.0.** Plain drilling, dwell drilling (`counter-boring`), chip breaking and deep drilling become explicit moves/dwells using Fusion's cycle settings. Existing turning/milling profiles and geometry semantics remain unchanged. No new post properties are added. [Translator integration and validation](docs/translator-integration.md).

Milling uses a separate profile, tool length-offset identity, all three principal arc planes and tolerance-controlled helix linearization by Fusion. Its existing profile requires LinuxCNCNext-NC v0.5.0 or newer; v0.11.0 is the tested consumer baseline. [Milling contract](docs/milling.md).

Prechecking runs before any toolpath is processed. It checks logical tool/WCS identifiers, initial coordinates, RPM, direction and supplied tolerance across selected sections, and continues diagnosing later sections if one section's metadata cannot be read. Successful prechecks log source facts as well. There are still zero post properties; the [translator](https://github.com/markmounteer/LinuxCNCNext-NC) owns optional checking against your existing LinuxCNC tool table. See the [research rationale](docs/research-review.md).

Exact geometry sharing and export comparison from 0.1.5 remain included. Every move, feed, process state and operation stays distinct. Update the imported CPS; the existing Windows diagnostic collector does not need reinstalling.

## What it exports

| Supported | Details |
| --- | --- |
| Ordered turning or milling sections | Logical tools, Fusion work-offset numbers, tool-offset numbers, section entry points |
| Rapid and cutting lines | All vertices preserved; adjacent moves with identical process state share a polyline |
| Circular arcs | Lathe XZ; mill XY/XZ/YZ. Analytic circles and bounded trims, both directions, full circles |
| Milling helices | Fusion linearizes with the tighter operation/post tolerance; all returned vertices retained |
| Milling drilling | Fusion expands drilling, counter-boring, chip-breaking and deep-drilling; ordered moves, feeds and dwell retained |
| Units | Millimetres or inches, explicit STEP units |
| Feed | Length/minute or length/revolution |
| Spindle | Constant RPM; lathe CSS with Fusion's maximum RPM |
| Coolant and dwell | Off, flood, mist, through tool; dwell in seconds |

There are **zero user-defined post properties**. Fusion supplies machining decisions. The controller consumer owns machine limits, tool changes, offset application, entry/retract policy, parking, overrides and motion planning.

The post rejects turning cycles, unsupported milling cycles, threading/tapping, controller cutter compensation, dual tool compensation, optional sections, secondary spindles, rotated setups, multi-axis motion, Manual NC, pass-through commands and explicit machine commands. Only the four documented milling cycles are expanded by Fusion. No canned-cycle entities or LinuxCNC G81/G83 instructions are emitted. An error prevents the writer from emitting a complete program; exports over the consumer's 32 MiB limit fail before output.

The post buffers the program until it is accepted, so memory use grows with toolpath size. Geometry is a toolpath, not a reconstruction of Fusion's design, stock, fixtures or feature-based machining intent.

## Precheck and diagnostics

Version **0.1.2** fixes the 0.1.1 engine compatibility regression and adds detailed failure reports. The precheck checks every selected section before processing motion. It lists affected operation names, section numbers and tools together, with instructions to correct unsupported compensation, cycles, work planes, section types, feed modes, spindle settings and coolant. No extra post options are needed.

On Windows, install the local diagnostic collector from the release's `diagnostics-windows.zip` (or run `scripts/install-diagnostics.ps1`). It saves reports automatically to **`%LOCALAPPDATA%\Fusion360Next-NC\diagnostics\latest-error.txt`**, including engine startup errors that happen before the post can run. Reports include the original engine log, version/path/checksum evidence, an explanation, and available operation/tool/callback details. Collection is local only and starts at sign-in. See [installation, report contents and removal](docs/troubleshooting.md#automatic-windows-log-archive).

For example, **In control**, **Wear** or **Inverse wear** compensation produces a diagnostic directing you to **Edit operation → Passes → Compensation Type → In computer**, then regenerate and repost. The post does not change the Fusion job or remove compensation automatically.

If Fusion omits compensation metadata, the precheck cannot determine that setting. The runtime guard remains active and explains the detected compensation request, the operation involved and why the early check could not catch it. See [troubleshooting](docs/troubleshooting.md) for an example and the limits of prechecking.

## Library

Requires Node.js 20 or later for development, with no npm dependencies.

```sh
git clone https://github.com/markmounteer/Fusion360Next-NC.git
cd Fusion360Next-NC
npm test
npm run check:build
npm run example
```

```js
const {Program} = require('./src/next-nc');
const program = new Program({name: 'Example', units: 'mm'});
const section = program.addSection({
  name: 'Outside turning',
  tool: {number: 1, offset: 1, description: 'OD tool'},
  workOffset: 1,
  start: [12, 0, 2],
  spindle: {mode: 'css', speed: 80000, maximumRPM: 1800, clockwise: true},
  coolant: 'off'
});
section.rapid([10, 0, 2]);
section.linear([10, 0, -10], {value: 0.1, mode: 'perRevolution'});
const stepText = program.toSTEP();
```

`speed` in CSS mode uses **program length units per minute**: `80000` mm/min means 80 m/min; `1200` inch/min means 100 ft/min. Positions use physical **X radius**, not diameter. The explicit `start` is an entry target; the exporter does not know the machine's current position or invent a safe path to that target.

The [synthetic example](examples/turning.stpnc), [format contract](docs/format.md), [LinuxCNC integration plan](docs/linuxcnc.md), and [validation record](docs/validation.md) explain the current boundary.

## Inspect an export

```sh
npm run inspect -- path/to/program.stpnc path/to/new-report.json
npm run inspect -- path/to/new.stpnc --compare path/to/previous.stpnc
```

This read-only command checks the Next-NC profile, entity references, operation/path order, continuity **within** each operation, explicit geometry/feed/spindle units, feeds, CSS caps and arc geometry. It reports operation/tool/offset information, motion counts and coordinate bounds including arc extrema. Omit the second path to print the report only; existing files are never overwritten. Inspection works on previous Next-NC exports as well as the compact 0.1.4 format.

`--compare` validates both files and compares the decoded program exactly, without a rounding tolerance. It ignores the export timestamp, writer version, entity numbering and shared-record layout. Changes to names, units, tooling, offsets, ordered geometry, feeds, spindle or coolant state are reported with the first differing field and before/after values. Exit code 3 means valid but different programs; 0 means the comparison matched. Reports also include a versioned SHA-256 fingerprint of the decoded program.

The inspector is independent of the writer, requires Node.js, and is not embedded in the CPS. It does not validate the full AP238 EXPRESS schema, stock/tool clearance, transitions between operations or controller readiness. Smaller files reduce storage and record duplication; they do not imply shorter machining time. See [inspection details](docs/format.md#local-inspection).

## Development

Edit `src/next-nc.js` and `src/fusion-adapter.js`, then run `npm run build`. Commit the generated `posts/next-nc.cps` too. CI checks that the source and post match, runs tests on Node 20/22/24, and checks the reproducible example.

To exercise the writer in Autodesk's installed JavaScript runtime, set `AUTODESK_POST` to your `post.exe` and run `npm run test:autodesk`. Run `npm run test:posting` for actual engine posting against checksum-pinned Autodesk sample turning and milling inputs (downloaded to `.cache`, not redistributed). This verifies the compatibility gate, numeric arc flags, successful facing/profile output, arc rounding fallback, precheck/runtime rejection, milling facing/bore/toolchange, and native helix linearization. `npm run test:collector` checks the Windows log collector. These do not test the Fusion GUI or a machine.

## License and provenance

MIT, for this repository's original code. Autodesk Fusion and its post engine are separate products and are not distributed here. No Autodesk post source, proprietary STEP SDK, machine configuration, private job or customer CAD is included. The standards/API references are recorded in [docs/references.md](docs/references.md).

## Architecture research update

See [the architecture review and resulting improvements](docs/architecture-research.md) for the three-paper review, stronger input checks and indexed interpretation. The separate milling profile was added in v0.2.0; existing turning model semantics and fingerprints remain unchanged.
