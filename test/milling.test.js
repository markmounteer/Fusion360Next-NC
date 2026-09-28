"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const {Program} = require("../src/next-nc"), {inspect} = require("../lib/inspect");
const spec = {name: "XYZ contour", tool: {number: 2, offset: 5}, workOffset: 1, start: [2, 1, -1], spindle: {mode: "rpm", speed: 1000, clockwise: true}, coolant: "flood"};
test("milling graph, units, arc planes and swept bounds round-trip through independent reader", () => {
  for (const units of ["mm", "inch"]) for (const clockwise of [true, false]) {
    const p = new Program({units, machine: "mill"}), s = p.addSection(spec), f = {mode: "perMinute", value: 80};
    for (const [plane, center] of [["XY", [1, 1, -1]], ["XZ", [1, 1, -1]], ["YZ", [2, 0, -1]]]) s.arc(spec.start, center, clockwise, f, true, plane);
    const text = p.toSTEP(), out = inspect(text);
    assert.match(text, /MILLING_TYPE_OPERATION/); assert.doesNotMatch(text, /TURNING_TYPE_OPERATION/);
    assert.equal(out.report.profile, "next-nc/milling-toolpath/0.1"); assert.equal(out.report.machine, "mill");
    assert.deepEqual(out.model.sections[0].paths.map(p => [p.plane, p.clockwise, p.fullCircle]), [["XY", clockwise, true], ["XZ", clockwise, true], ["YZ", clockwise, true]]);
    assert.deepEqual(out.report.bounds, {min: [0, -1, -2], max: [2, 2, 0]});
    assert.throws(() => inspect(text.replaceAll("milling-toolpath", "turning-toolpath")), /coordinate|operation|turning/);
    assert.throws(() => inspect(text.replaceAll("MILLING_TYPE_OPERATION", "TURNING_TYPE_OPERATION")), /MILLING_TYPE_OPERATION|tool owner/);
  }
});
test("unsupported machine, helix geometry, oblique plane and CSS cannot enter mill profile", () => {
  assert.throws(() => new Program({units: "mm", machine: "router5axis"}), /machine/);
  const p = new Program({units: "mm", machine: "mill"}), s = p.addSection(spec), f = {mode: "perMinute", value: 80};
  assert.throws(() => s.arc([1, 2, 0], [1, 1, -1], false, f, false, "XY"), /planar/);
  assert.throws(() => s.arc([1, 2, -1], [1, 1, -1], false, f, false, "AB"), /plane/);
  assert.throws(() => s.setSpindle({mode: "css", speed: 1000, maximumRPM: 2000, clockwise: true}), /constant RPM/);
});
