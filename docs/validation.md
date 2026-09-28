# Validation record

Version 0.1.5, 2026-09-28 UTC.

## Verified locally

- Node.js 24.13.1: 56 writer, synthetic Fusion callback and independent-inspector tests, including both numeric/Boolean arc directions, full-circle flags, rejection of ambiguous flags, strict independent-writer validation, mm/inch tolerance-bounded native linearization delegation, excessive mismatch and incomplete-linearization rejection, configuration-version separation, structured failure context, bounded event history, first-error preservation and logging failure isolation.
- Exact value sharing preserves repeated motion and separate operations with different feed, coolant and work-offset states. Tests retain nearby but unequal points, verify fresh caches per serialization, and reconcile export statistics with decoded output.
- Shared-curve tests preserve repeated arcs with different cutting states, distinguish opposite senses and full-circle trims, share identical rapid/cutting geometry without merging actions, and retain radii differing by 1e-12. Native sample tests count ordered arc uses independently of shared curve definitions.
- Comparison tests ignore metadata, renumbered references and duplicate point definitions, but detect exact changes to feed, coordinates, offsets, spindle direction and coolant. Both inputs are validated; CLI tests distinguish matching, differing, invalid and malformed-command outcomes.
- Independent inspector tests cover mm/inch units, CSS/RPM, Unicode names, dwell, feeds and state changes, both arc senses, full circles and interior arc extrema. Mutation tests reject broken references, truncation, duplicate sequence positions, missing cutting feeds, invalid units, off-plane points, discontinuities and corrupt arcs. CLI tests check reporting and refusal to overwrite files.
- Deterministic generation of `posts/next-nc.cps` from the two source files.
- Independent reader and inspector check Part 21 syntax for the emitted subset, entity references, curve endpoints, circle sense, explicit units, path order, within-operation continuity, feed/CSS values, and profile records. They are also applied to native facing/profile outputs; successful export statistics are reconciled with the resulting graph.
- Autodesk CAM Post Processor **5.413.5** successfully interrogates the actual CPS as a turning post with `.stpnc` output and no user-defined properties.
- That same Autodesk engine executes the writer on a synthetic line/arc/dwell/CSS program during interrogation. The returned STEP text is parsed and checked independently by the test reader. This exercises Autodesk's JavaScript runtime, including `Date`, array operations and serialization.
- The engine also runs the actual CPS's diagnostic helpers with synthetic section metadata, checking operation/tool identification, compensation guidance and an invalid CSS cap. Automated callback tests cover aggregation across sections, missing/contradictory metadata, unknown settings, duplicate names, repeated validation at section start and rejection before creating the program buffer.
- Actual native posting on Autodesk engine **5.413.5**, with `--security 1000`: reproduces the incompatible-version failure before `onOpen`, posts Autodesk's facing sample successfully, parses that STEP output independently, rejects the compensated-profile sample during precheck, and checks the detailed runtime report with precheck deliberately bypassed in a temporary test-only CPS.
- Native posting also reproduces the numeric arc-direction failure with Autodesk's uncompensated profile sample, then exports the complete corrected sample. The native sample supplies numeric `0` CCW arcs; clockwise/full-circle coverage is synthetic. Two arcs require the native rounding fallback; all other sampled arcs remain analytic. The independent reader checks the analytic arc count and sense.
- Windows PowerShell 5.1 collector tests: dedicated-log filtering, raw-byte preservation and SHA-256, compatibility diagnosis, structured report extraction, deduplication, latest-error retention after success, timestamp ordering, incomplete-to-complete logs, locked-file retry, and automatic collection by a hidden watcher.

Privately supplied 0.1.3 and 0.1.4 exports pass the profile checks, and their matching engine logs report successful posting. The actual 0.1.4 Fusion export exactly matches the previously predicted serialization apart from the timestamp. Replaying the new export through the saved 0.1.4 writer reproduces its complete text after CRLF normalization; serializing with 0.1.5 gives an exactly equal decoded model with fewer curve definitions. All three decoded models have the same program fingerprint. Private exports and comparison artifacts remain local and are not published as fixtures.

The synthetic callback tests exercise `onOpen`, section metadata, linear/rapid/arc motion, dwell, speed changes, section completion and final output. Failure tests cover unsupported machining and invalid numeric inputs. These tests have no machine connection and use invented tooling and dimensions.

## Not yet verified

- Reposting the user's actual Fusion job with 0.1.5 through the GUI/CAM exporter. A supplied successful 0.1.4 export has been inspected and reserialized; this does not replace a fresh Fusion repost. Native 0.1.5 posting uses official samples because the user's CAM input is not available for replay.
- Full EXPRESS types, inverse constraints, global rules or ISO AP238 conformance. The test reader is a structural subset reader, not an EXPRESS validator.
- Acceptance by an independent STEP-NC implementation.
- Geometry comparison against a real Fusion simulation, large-job performance or machine execution.
- LinuxCNC interpreter behavior, because no interpreter is implemented here.

Do not infer controller compatibility or machine readiness from successful post interrogation or unit tests. This release is a development preview.

## Reproduce

```sh
npm run build
npm run check:build
npm test
npm run example
```

For native runtime checks, point `AUTODESK_POST` at an existing licensed installation's `post.exe`, then run `npm run test:autodesk` and `npm run test:posting`. The latter downloads only Autodesk's public `Turning/face.cnc`, `Turning/profile no compensation.cnc` and `Turning/profile with compensation.cnc` fixtures from [cam-posteditor commit c95cce0](https://github.com/Autodesk/cam-posteditor/tree/c95cce0a6e9f5f48e163a7e6d26a9d005fde85e5/vs-code-extension/res/CNC%20files/Turning) into ignored `.cache`. SHA-256 values are pinned in the test; these files and the Autodesk executable are not redistributed. Temporary test CPS files are removed afterwards. Run `npm run test:collector` on Windows for the separate collector suite. CI runs the Node suites and Windows collector tests; native Autodesk tests require a local engine installation.
