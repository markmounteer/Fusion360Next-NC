"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const {Program} = require("../src/next-nc"), {parse} = require("../lib/part21");
const {inspectDocument} = require("../lib/inspect"), {ValidationError} = require("../lib/validation-error");
function fixture(machine, units) {
  const p = new Program({machine, units, name: "Geometry diagnostics"});
  const start = [12, 0, 3], center = [10, 0, 3], end = machine === "mill" ? [10, 2, 3] : [10, 0, 1];
  const spec = {tool: {number: 2, offset: 4}, workOffset: 1, start, spindle: {mode: "rpm", speed: 600, clockwise: true}, coolant: "off"};
  for (const name of ["First use", "Shared use"]) p.addSection({name, ...spec}).arc(end, center, false, {mode: "perMinute", value: 50}, false);
  return {doc: parse(p.toSTEP()), start, end};
}
const entity = (doc, type) => [...doc.records].find(([, parts]) => parts.some(p => p.type === type));
test("lathe/mill radius diagnostics carry owning use, source location and numeric threshold in both units", () => {
  for (const machine of ["lathe", "mill"]) for (const units of ["mm", "inch"]) {
    const {doc, start, end} = fixture(machine, units), [id, parts] = entity(doc, "CIRCLE");
    parts[0].args[2] = 3;
    assert.throws(() => inspectDocument(doc), error => {
      assert.ok(error instanceof ValidationError);
      const c = error.context;
      assert.equal(c.rule, "ARC_RADIUS"); assert.equal(c.stage, "geometry");
      assert.equal(c.operation, "First use"); assert.equal(c.section, 1); assert.equal(c.path, 1);
      assert.equal(c.record, "#" + id); assert.equal(c.circleRecord, c.record);
      assert.equal(c.sourceLine, doc.locations.get(id).sourceLine); assert.ok(c.curveRecord && c.pathRecord);
      assert.equal(c.units, units); assert.equal(c.machine, machine);
      assert.deepEqual(c.start, start); assert.deepEqual(c.end, end);
      assert.deepEqual(c.measuredRadii, [2, 2]); assert.equal(c.declaredRadius, 3);
      assert.equal(c.threshold, 3e-6); assert.equal(c.mismatch, 1); return true;
    });
  }
});
test("radius and join boundaries preserve existing thresholds in mm/inch for both machines", () => {
  for (const machine of ["lathe", "mill"]) for (const units of ["mm", "inch"]) {
    for (const multiplier of [0.99, 1.01]) {
      const {doc} = fixture(machine, units), trim = entity(doc, "TRIMMED_CURVE")[1][0].args;
      const end = doc.get(trim[3][0])[0].args[1]; end[machine === "mill" ? 1 : 2] += (machine === "mill" ? 1 : -1) * 2e-6 * multiplier;
      if (multiplier < 1) inspectDocument(doc); else assert.throws(() => inspectDocument(doc), e => e.context.rule === "ARC_RADIUS");
    }
    for (const multiplier of [0.99, 1.01]) {
      const {doc} = fixture(machine, units);
      const op = [...doc.records].filter(([,p]) => p[0].type === (machine === "mill" ? "MILLING_TYPE_OPERATION" : "TURNING_TYPE_OPERATION"))[1][0];
      const property = [...doc.records].find(([,p]) => p[0].type === "ACTION_PROPERTY" && p[0].args[0] === "next-nc entry point" && p[0].args[2].ref === op)[0];
      const association = doc.all("ACTION_PROPERTY_REPRESENTATION").find(e => e.args[2].ref === property);
      const representation = structuredClone(doc.get(association.args[3]));
      doc.records.set(999998, representation); association.args[3] = {ref: 999998};
      const args = representation[0].args;
      // Only this operation's entry changes; its trimmed curve is shared with
      // the earlier valid operation. Location must refer to the failing use.
      doc.records.set(999999, [{type: "CARTESIAN_POINT", args: ["", [12 + 1e-9 * multiplier, 0, 3]]}]);
      args[1] = [{ref: 999999}];
      if (multiplier < 1) inspectDocument(doc); else assert.throws(() => inspectDocument(doc), e => {
        assert.equal(e.context.rule, "PATH_CONTINUITY"); assert.equal(e.context.section, 2);
        assert.equal(e.context.operation, "Shared use"); assert.equal(e.context.path, 1);
        assert.deepEqual(e.context.sourceStart, [12, 0, 3]); assert.equal(e.context.threshold, 1e-9);
        assert.ok(e.context.maximumDelta > e.context.threshold); return true;
      });
    }
  }
});
test("invalid normals retain their direction record; programmer failures remain unexpected", () => {
  for (const machine of ["lathe", "mill"]) {
    const {doc} = fixture(machine, "mm"), axis = entity(doc, "AXIS2_PLACEMENT_3D")[1][0].args;
    doc.get(axis[2])[0].args[1] = [0, -1, 0];
    assert.throws(() => inspectDocument(doc), e => e.context.rule === "ARC_PLANE" && e.context.record === "#" + axis[2].ref);
  }
  const {doc} = fixture("mill", "mm"), fault = new TypeError("injected implementation failure");
  doc.records.get = () => { throw fault; };
  assert.throws(() => inspectDocument(doc), e => e === fault);
});
