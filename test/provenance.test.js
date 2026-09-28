"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), crypto = require("node:crypto");
const {Program} = require("../src/next-nc"), {inspect, compare} = require("../lib/inspect");
function fixture(machine, units) {
  const p = new Program({machine, units});
  for (const name of ["First", "Shared"]) {
    const s = p.addSection({name, start: [3, 0, 0], tool: {number: 1, offset: 2}, workOffset: 1,
      spindle: {mode: "rpm", speed: 600, clockwise: true}, coolant: "flood"});
    const feed = {mode: "perMinute", value: 50}, end = machine === "mill" ? [0, 2, 0] : [0, 0, -2];
    s.linear([2, 0, 0], feed); s.arc(end, [0, 0, 0], true, feed, false);
    s.arc(end, [0, 0, 0], false, feed, true); s.dwell(0.5);
  }
  return p.toSTEP();
}
function checkLocations(value, text) {
  if (!value || typeof value !== "object") return;
  if (value.record) {
    const line = text.split(/\r?\n/)[value.sourceLine - 1];
    assert.ok(line.slice(value.sourceColumn - 1).startsWith(value.record + "="), JSON.stringify(value));
  }
  Object.values(value).forEach(child => checkLocations(child, text));
}
test("source sidecars retain owning use, geometry, process and exact input identity for both machines/units", () => {
  for (const machine of ["lathe", "mill"]) for (const units of ["mm", "inch"]) {
    const text = fixture(machine, units), a = inspect(text), [first, second] = a.provenance.sections;
    assert.equal(a.provenance.inputSHA256, crypto.createHash("sha256").update(text).digest("hex"));
    checkLocations(a.provenance, text);
    assert.notEqual(first.operation.record, second.operation.record);
    assert.notEqual(first.paths[0].toolpath.record, second.paths[0].toolpath.record);
    assert.equal(first.paths[0].curve.record, second.paths[0].curve.record);
    assert.equal(first.paths[0].vertices.length, 2);
    assert.ok(first.process.spindle.items[0].unit.record);
    assert.ok(first.paths[0].process.feed.items[0].unit.record);
    assert.ok(first.paths[1].arc.start.record && first.paths[1].arc.end.record);
    assert.ok(first.paths[2].arc.start.derivation && !first.paths[2].arc.start.record);
    assert.ok(first.paths[3].dwell.items[0].record);
    const changed = text.replace(/#(\d+)/g, (_, n) => "#" + (Number(n) + 10000)).replace(/\n#/g, "\n  #").replace(/\n/g, "\r\n");
    const b = inspect(changed); checkLocations(b.provenance, changed);
    assert.deepEqual(a.model, b.model); assert.deepEqual(a.report.programFingerprint, b.report.programFingerprint);
    assert.equal(compare(text, changed).sameProgram, true);
    assert.notEqual(a.provenance.inputSHA256, b.provenance.inputSHA256);
    assert.notEqual(first.operation.record, b.provenance.sections[0].operation.record);
  }
});
