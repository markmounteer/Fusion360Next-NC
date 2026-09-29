"use strict";
// Test-only consumer integration. These synthetic transitions are never suitable
// for a real job and must never become part of the CPS or public writer API.
const path = require("node:path"), assert = require("node:assert/strict");
const {execFileSync} = require("node:child_process");
const pin = require("../../scripts/translator-baseline.json");
function consumer() {
  const root = process.env.LINUXCNC_NEXTNC;
  assert.ok(root, "Set LINUXCNC_NEXTNC to the pinned translator checkout (see scripts/translator-baseline.json).");
  const resolved = path.resolve(root);
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], {cwd: resolved, encoding: "utf8"}).trim(), pin.commit);
  assert.equal(execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {cwd: resolved, encoding: "utf8"}).trim(), "", "Translator tracked files must match the pinned revision");
  assert.equal(require(path.join(resolved, "package.json")).version, pin.version);
  return {readProgram: require(path.join(resolved, "src/profile")).readProgram,
    template: require(path.join(resolved, "src/plan")).template,
    translate: require(path.join(resolved, "src/translate")).translate};
}
function checkTranslation(text, api = consumer()) {
  const program = api.readProgram(text), plan = api.template(program);
  const mill = program.model.machine === "mill", axes = mill ? ["z", "x", "y"] : ["x", "z"];
  const indices = {x: 0, y: 1, z: 2};
  for (const s of program.model.sections) {
    plan.tools[`${s.tool.number}:${s.tool.offset}`] = {tool: s.tool.number, offset: s.tool.offset || 1};
    plan.workOffsets[s.workOffset] = "G54";
  }
  // Arbitrary fixture coordinates: syntax/audit testing only, no clearance claim.
  const retract = () => axes.map(axis => ({[axis]: 100}));
  plan.sections = program.model.sections.map(s => ({mode: "retract", retract: retract(), approach: axes.map(axis => ({[axis]: s.start[indices[axis]]}))}));
  plan.end = retract();
  const out = api.translate(text, plan);
  for (const stage of ["part21", "profileShape", "semantics", "executionPlan", "completeness", "policy", "serialization"]) {
    assert.equal(out.report.validationCoverage.stages[stage].status, "passed", stage);
  }
  assert.equal(out.report.programFingerprint.value, program.report.programFingerprint.value);
  assert.equal(out.report.execution.coordinatesRounded, false);
  assert.equal(out.sourceMap.length, out.report.gcodeLines);
  assert.ok(out.gcode.endsWith("M2\n"));
  return {program, plan, out};
}
module.exports = {consumer, checkTranslation};
