"use strict";
// Requires a separately installed Autodesk post.exe; never redistributed here.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {spawnSync} = require("node:child_process");
const assert = require("node:assert/strict");
const {parse} = require("../test/support/part21");
const executable = process.env.AUTODESK_POST;
if (!executable || !fs.existsSync(executable)) throw new Error("Set AUTODESK_POST to your installed Autodesk post.exe.");
const root = path.resolve(__dirname, "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "next-nc-engine-"));
function run(args, expected = 0) {
  const result = spawnSync(executable, ["--noeditor", "--nointeraction", "--nobackup", "--log", "stdout", ...args], {encoding: "utf8", cwd: temporary});
  if (result.error) throw result.error;
  assert.equal(result.status, expected, result.stdout + result.stderr);
  return result.stdout + result.stderr;
}
function interrogationDescription(cps) {
  const nativeOutput = run(["--interrogate", cps]);
  const jsonLine = nativeOutput.split(/\r?\n/).find(line => line.startsWith('{"interrogationRevision"'));
  assert.ok(jsonLine, "Native engine did not return interrogation JSON");
  return JSON.parse(jsonLine).longDescription;
}
try {
  const cps = path.join(root, "posts/next-nc.cps");
  const metadata = run(["--interrogate", cps]);
  assert.match(metadata, /"extension":"stpnc"/); assert.match(metadata, /"capabilities":"TURNING"/);
  const runtime = path.join(temporary, "runtime.cps");
  // Interrogation evaluates top-level JS in the native engine. Put synthetic output
  // in metadata so the independent reader can check it without a licensed CAM fixture.
  const driver = `
description = "Next-NC synthetic runtime test";
extension = "stpnc";
capabilities = CAPABILITY_INTERMEDIATE;
setCodePage("ascii");
function syntheticOutput() {
  var p = new NextNC.Program({name: "Synthetic native runtime", units: "mm"});
  var s = p.addSection({name: "Synthetic turning", tool: {number: 1, offset: 1}, workOffset: 1,
    start: [10,0,0], spindle: {mode: "css", speed: 80000, maximumRPM: 1800, clockwise: true}, coolant: "off"});
  s.linear([10,0,-5], {mode: "perRevolution", value: 0.1});
  s.arc([8,0,-7], [8,0,-5], false, {mode: "perRevolution", value: 0.1}, false);
  s.dwell(0.25);
  return p.toSTEP();
}
longDescription = syntheticOutput();
`;
  fs.writeFileSync(runtime, fs.readFileSync(path.join(root, "src/next-nc.js"), "utf8") + driver);
  const doc = parse(interrogationDescription(runtime));
  assert.equal(doc.all("MACHINING_TOOLPATH").length, 3);
  assert.equal(doc.all("CIRCLE").length, 1);
  const diagnosticPost = path.join(temporary, "diagnostics.cps");
  const diagnosticDriver = `
function syntheticDiagnostic() {
  var params = {"operation-comment": "Synthetic face", "operation:compensationType": "control"};
  var t = {number: 7, getSpindleMode: function () { return SPINDLE_CONSTANT_SURFACE_SPEED; },
    surfaceSpeed: 80000, maximumSpindleSpeed: 0, coolant: COOLANT_OFF};
  var s = {hasParameter: function (name) { return Object.prototype.hasOwnProperty.call(params, name); },
    getParameter: function (name) { return params[name]; }, getTool: function () { return t; },
    getType: function () { return TYPE_TURNING; }, isMultiAxis: function () { return false; },
    isOptional: function () { return false; }, hasAnyCycle: function () { return false; },
    spindle: SPINDLE_PRIMARY, feedMode: FEED_PER_REVOLUTION,
    workPlane: {forward: new Vector(0,0,1), right: new Vector(1,0,0)}};
  return nextLabel(s, 1) + ": " + nextSectionIssues(s).join("\\n");
}
longDescription = syntheticDiagnostic();
`;
  fs.writeFileSync(diagnosticPost, fs.readFileSync(cps, "utf8") + diagnosticDriver);
  const diagnosis = interrogationDescription(diagnosticPost);
  assert.match(diagnosis, /Synthetic face.*section 2, tool T7/);
  assert.match(diagnosis, /\[COMPENSATION\].*In control/);
  assert.match(diagnosis, /Passes > Compensation Type > In computer/);
  assert.match(diagnosis, /\[CSS_LIMIT\]/);
  console.log("PASS: native Autodesk CPS interrogation, writer and diagnosis helpers (synthetic metadata harness).");
  console.log("Not tested: Fusion GUI posting or controller execution.");
} finally {
  // Verify the exact mkdtemp directory remains within the intended temporary parent.
  assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(temporary).startsWith("next-nc-engine-"));
  fs.rmSync(temporary, {recursive: true, force: true});
}
