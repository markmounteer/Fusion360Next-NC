# Validation record

Version 0.1.0, 2026-09-27.

## Verified locally

- Node.js 24.13.1: writer and synthetic Fusion callback tests.
- Deterministic generation of `posts/next-nc.cps` from the two source files.
- Independent test reader checks Part 21 syntax for the emitted subset, all entity references, curve endpoints, circle sense, explicit units, path order, feed/CSS values, and profile records.
- Autodesk CAM Post Processor **5.413.5** successfully interrogates the actual CPS as a turning post with `.stpnc` output and no user-defined properties.
- That same Autodesk engine executes the writer on a synthetic line/arc/dwell/CSS program during interrogation. The returned STEP text is parsed and checked independently by the test reader. This exercises Autodesk's JavaScript runtime, including `Date`, array operations and serialization.

The synthetic callback tests exercise `onOpen`, section metadata, linear/rapid/arc motion, dwell, speed changes, section completion and final output. Failure tests cover unsupported machining and invalid numeric inputs. These tests have no machine connection and use invented tooling and dimensions.

## Not yet verified

- End-to-end posting of a real Fusion turning job through the Fusion GUI/CAM exporter.
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

For native runtime checks, point `AUTODESK_POST` at an existing licensed installation's `post.exe`, then run `npm run test:autodesk`. The script creates a temporary synthetic CPS, evaluates the writer through interrogation metadata, checks the result and removes its own temporary directory. It does not redistribute the Autodesk executable or claim a CAM input-file integration test.
