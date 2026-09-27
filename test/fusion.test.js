"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {parse} = require("./support/part21");
function engine(overrides = {}) {
  const output = [];
  const constants = ["MM", "IN", "CAPABILITY_TURNING", "PLANE_ZX", "PLANE_XY", "TYPE_TURNING", "SPINDLE_PRIMARY",
    "SPINDLE_CONSTANT_SURFACE_SPEED", "SPINDLE_CONSTANT_SPINDLE_SPEED", "FEED_PER_MINUTE", "FEED_PER_REVOLUTION", "COOLANT_OFF", "COOLANT_FLOOD", "COOLANT_MIST", "COOLANT_THROUGH_TOOL",
    "RADIUS_COMPENSATION_OFF", "COMMAND_START_SPINDLE", "COMMAND_COOLANT_ON", "COMMAND_COOLANT_OFF", "COMMAND_STOP_SPINDLE",
    "COMMAND_SPINDLE_CLOCKWISE", "COMMAND_SPINDLE_COUNTERCLOCKWISE", "COMMAND_END"];
  const c = Object.fromEntries(constants.map((name, index) => [name, index + 1]));
  Object.assign(c, {
    setCodePage() {}, spatial: n => n, toRad: n => n * Math.PI / 180,
    Vector: function (x, y, z) { Object.assign(this, {x, y, z}); },
    isSameDirection: (a, b) => ["x", "y", "z"].every(k => Math.abs(a[k] - b[k]) < 1e-9),
    setRotation() {}, getFramePosition: p => p, getCircularPlane: () => c.PLANE_ZX,
    isHelical: () => false, isFullCircle: () => false, hasParameter: () => true,
    getParameter: () => "Synthetic Fusion operation", getCurrentSectionId: () => 0,
    getCommandStringId: n => String(n), error: message => { throw new Error(message); },
    writeln: line => output.push(line), programName: "Synthetic callback test", spindleSpeed: 1200
  });
  c.unit = c.MM; c.radiusCompensation = c.RADIUS_COMPENSATION_OFF;
  c.currentSection = {getType: () => c.TYPE_TURNING, isMultiAxis: () => false, isOptional: () => false,
    spindle: c.SPINDLE_PRIMARY, feedMode: c.FEED_PER_REVOLUTION, workOffset: 1,
    workPlane: {forward: {x: 0, y: 0, z: 1}, right: {x: 1, y: 0, z: 0}}, getInitialPosition: () => ({x: 12, y: 0, z: 2})};
  c.tool = {getSpindleMode: () => c.SPINDLE_CONSTANT_SPINDLE_SPEED, number: 1, compensationOffset: 1,
    comment: "Synthetic tool", clockwise: true, surfaceSpeed: 80000, maximumSpindleSpeed: 1800, coolant: c.COOLANT_OFF};
  Object.assign(c, overrides); vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../posts/next-nc.cps"), "utf8"), c);
  return {c, output};
}
test("Fusion callback flow emits complete AP238 only after onClose", () => {
  const {c, output} = engine(); c.onOpen(); c.onSection(); c.onRapid(10, 0, 2); c.onLinear(10, 0, 0, 0.1);
  c.onCircular(false, 8, 0, 0, 8, 0, -2, 0.1); c.onDwell(0.3); c.onSectionEnd();
  assert.equal(output.length, 0); c.onClose();
  const doc = parse(output.join("\n") + "\n");
  assert.equal(doc.all("MACHINING_TOOLPATH").length, 4);
  assert.equal(Object.keys(c.properties).length, 0);
});
test("Fusion CSS speed remains length/minute and is not incorrectly scaled twice", () => {
  const {c, output} = engine(); c.tool.getSpindleMode = () => c.SPINDLE_CONSTANT_SURFACE_SPEED;
  c.onOpen(); c.onSection(); c.onLinear(12, 0, 0, 0.1); c.onClose();
  const doc = parse(output.join("\n") + "\n");
  assert.ok(doc.all("MEASURE_REPRESENTATION_ITEM").some(e => e.args[0] === "surface speed" && e.args[1].args[0] === -80000));
});
test("work offsets and tools survive multiple sections without manufactured connecting moves", () => {
  const {c, output} = engine(); c.onOpen(); c.onSection(); c.onLinear(12, 0, 0, 0.1); c.onSectionEnd();
  c.tool.number = 3; c.tool.compensationOffset = 4; c.currentSection.workOffset = 2;
  c.onSection(); c.onLinear(11, 0, 0, 0.1); c.onSectionEnd(); c.onClose();
  const doc = parse(output.join("\n") + "\n");
  assert.deepEqual(doc.all("MACHINING_TOOL").map(e => e.args[0]), ["1", "3"]);
  assert.equal(doc.all("POLYLINE").length, 2);
});
for (const [name, mutate, callback] of [
  ["milling", c => { c.currentSection.getType = () => -1; }, "onSection"],
  ["multi axis", c => { c.currentSection.isMultiAxis = () => true; }, "onSection"],
  ["secondary spindle", c => { c.currentSection.spindle = -1; }, "onSection"],
  ["optional section", c => { c.currentSection.isOptional = () => true; }, "onSection"],
  ["rotated setup", c => { c.currentSection.workPlane.right.x = -1; }, "onSection"],
  ["threading", () => {}, "onCycle"],
  ["manual NC", () => {}, "onManualNC"],
  ["dual compensation", () => {}, "onToolCompensation"],
  ["machine command", () => {}, "onMachineCommand"],
  ["special cycle", () => {}, "onSpecialCycle"],
  ["live alignment", () => {}, "onLiveAlignment"],
  ["controller compensation", c => { c.radiusCompensation = 5; }, "onRadiusCompensation"],
  ["passthrough", () => {}, "onPassThrough"]
]) {
  test(`rejects ${name} without a completed program`, () => {
    const {c, output} = engine(); c.onOpen(); mutate(c);
    assert.throws(() => c[callback](), /Next-NC/);
    assert.throws(() => c.onClose(), /already failed/); assert.equal(output.length, 0);
  });
}
test("unsupported coolant, inverse feed and command changes fail explicitly", () => {
  for (const run of [c => { c.tool.coolant = -1; c.onSection(); }, c => c.onFeedMode(-1), c => c.onCommand(c.COMMAND_STOP_SPINDLE)]) {
    const {c, output} = engine(); c.onOpen(); assert.throws(() => run(c), /Next-NC/); assert.equal(output.length, 0);
  }
});
test("mid-section spindle changes preserve RPM and don't mutate prior motion", () => {
  const {c, output} = engine(); c.onOpen(); c.onSection(); c.onLinear(12, 0, 0, 0.1);
  c.onSpindleSpeed(600); c.onLinear(12, 0, -2, 0.1); c.onClose();
  const speeds = parse(output.join("\n") + "\n").all("MEASURE_REPRESENTATION_ITEM").filter(e => e.args[0] === "rotational speed").map(e => e.args[1].args[0]);
  assert.ok(speeds.includes(-1200)); assert.ok(speeds.includes(-600));
});
