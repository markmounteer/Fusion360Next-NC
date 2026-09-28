"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const {Program, stepString} = require("../src/next-nc");
const {inspect, compare} = require("../lib/inspect");
const {parse} = require("../lib/part21");
const feed = {mode: "perRevolution", value: 0.1};
function sample(units = "mm") {
  const p = new Program({name: "O'Brien\\X2\\é😀", units});
  const s = p.addSection({name: "Turning", tool: {number: 2, offset: 4, description: "OD"}, workOffset: 1,
    start: [2, 0, 0], spindle: {mode: "css", speed: 1000, maximumRPM: 1700, clockwise: true}, coolant: "off"});
  return {p, s};
}
// Corrupt a specific record without depending on writer-assigned record numbers.
function change(text, type, transform, index = 0) {
  const record = [...parse(text).records].filter(([, parts]) => parts.some(e => e.type === type))[index];
  assert.ok(record, "record for mutation");
  const prefix = "#" + record[0] + "=";
  return text.split("\n").map(line => line.startsWith(prefix) ? transform(line) : line).join("\n");
}
test("independent inspection preserves units, Unicode, execution order, feeds and state changes", () => {
  for (const units of ["mm", "inch"]) {
    const {p, s} = sample(units);
    s.rapid([3, 0, 0]); s.linear([3, 0, -2], feed);
    s.dwell(0.25); s.setSpindle({mode: "rpm", speed: 700, clockwise: false}); s.setCoolant("mist");
    s.linear([4, 0, -2], {mode: "perMinute", value: 20});
    const {model, report} = inspect(p.toSTEP());
    assert.equal(model.name, p.name); assert.equal(model.units, units);
    assert.equal(stepString(model.name), stepString(p.name));
    assert.deepEqual(model.sections[0].paths.map(v => v.kind), ["rapid", "linear", "dwell", "linear"]);
    assert.deepEqual(model.sections[0].paths[3].spindle, {mode: "rpm", speed: 700, clockwise: false});
    assert.equal(model.sections[0].paths[3].coolant, "mist");
    assert.deepEqual(report.operations[0].feeds, [feed, {value: 20, mode: "perMinute"}]);
    assert.deepEqual(report.bounds, {min: [2, 0, -2], max: [4, 0, 0]});
    assert.equal(report.rapidSegments, 1); assert.equal(report.cuttingSegments, 2);
  }
});
test("arc bounds include interior extrema, both senses and full circles", () => {
  for (const clockwise of [false, true]) {
    const {p, s} = sample();
    s.arc([0, 0, 2], [0, 0, 0], clockwise, feed, false);
    const result = inspect(p.toSTEP());
    assert.equal(result.model.sections[0].paths[0].clockwise, clockwise);
    assert.deepEqual(result.report.bounds, clockwise ? {min: [0, 0, 0], max: [2, 0, 2]} : {min: [-2, 0, -2], max: [2, 0, 2]});
    s.arc([0, 0, 2], [0, 0, 0], clockwise, feed, true);
    const full = inspect(p.toSTEP());
    assert.equal(full.model.sections[0].paths[1].fullCircle, true);
    assert.deepEqual(full.report.bounds, {min: [-2, 0, -2], max: [2, 0, 2]});
  }
});
test("interning reuses exact values while keeping repeated motion, sections and process states distinct", () => {
  const {p, s} = sample();
  s.linear([3, 0, 0], feed); s.rapid([2, 0, 0]);
  s.linear([3, 0, 0], {value: 0.2, mode: "perRevolution"}); s.rapid([2, 0, 0]);
  s.linear([3 + 1e-12, 0, 0], feed);
  p.addSection({name: "Separate", tool: s.tool, workOffset: 2, start: [2, 0, 0], spindle: s.initialSpindle, coolant: "flood"}).linear([3, 0, 0], feed);
  const text = p.toSTEP(), result = inspect(text), doc = parse(text);
  assert.equal(doc.all("CARTESIAN_POINT").length, 3);
  assert.equal(doc.all("POLYLINE").length, 3);
  assert.equal(doc.all("MACHINING_WORKINGSTEP").length, 2);
  assert.equal(doc.all("MACHINING_TOOLPATH").length, 6);
  assert.equal(doc.all("MACHINING_TOOLPATH_SPEED_PROFILE_REPRESENTATION").length, 1);
  assert.equal(result.model.sections[0].paths[2].feed.value, 0.2);
  assert.equal(result.model.sections[1].workOffset, 2);
  assert.equal(result.model.sections[1].paths[0].coolant, "flood");
  assert.equal(p.lastExport.entities, doc.records.size);
  assert.equal(p.lastExport.paths, result.report.paths); assert.ok(p.lastExport.reusedValues > 0);
  assert.equal(p.toSTEP(), text, "repeated serialization must use a fresh cache");
  const other = sample(); other.s.linear([3, 0, 0], feed);
  assert.equal(inspect(other.p.toSTEP()).report.sections, 1);
});
test("inspection rejects missing references, broken sequences, feeds, units and discontinuities", () => {
  const {p, s} = sample(); s.linear([3, 0, 0], feed); s.rapid([4, 0, 0]);
  const text = p.toSTEP();
  assert.throws(() => inspect(text.replace("#1=", "#999999=")), /Missing reference/);
  assert.throws(() => inspect(text.slice(0, -10)), /Incomplete/);
  assert.throws(() => inspect(change(text, "MACHINING_TOOLPATH_SEQUENCE_RELATIONSHIP", line => line.replace(/,2\.\);$/, ",1.);"), 1)), /sequence/);
  assert.throws(() => inspect(change(text, "ACTION_PROPERTY", line => line.replace("'feedrate'", "'unknown'"), [...parse(text).all("ACTION_PROPERTY")].findIndex(p => p.args[0] === "feedrate"))), /no feed/);
  assert.throws(() => inspect(text.replace("TIME_MEASURE(60.)", "TIME_MEASURE(59.)")), /unit conversion/);
  assert.throws(() => inspect(change(text, "CARTESIAN_POINT", line => line.replace("(2.,0.,0.)", "(2.,1.,0.)"))), /XZ point/);
  const doc = parse(text), poly = doc.all("POLYLINE")[1];
  assert.throws(() => inspect(change(text, "POLYLINE", line => line.replace("#" + poly.args[1][0].ref, "#" + poly.args[1][1].ref), 1)), /discontinuity/);
});
test("shared curves preserve repeated arcs, opposite senses, full circles and cutting state", () => {
  const {p, s} = sample();
  for (const [i, clockwise] of [false, false, true].entries()) {
    s.setSpindle({mode: "rpm", speed: 600 + i * 100, clockwise: i !== 1});
    s.setCoolant(i === 1 ? "flood" : "off");
    s.arc([0, 0, -2], [0, 0, 0], clockwise, {mode: "perRevolution", value: 0.1 + i * 0.01}, false);
    s.rapid([2, 0, 0]);
  }
  s.arc([2, 0, 0], [0, 0, 0], false, feed, true);
  s.arc([2, 0, 0], [0, 0, 0], true, feed, true);
  const text = p.toSTEP(), doc = parse(text), result = inspect(text);
  assert.equal(doc.all("CIRCLE").length, 1);
  assert.equal(doc.all("AXIS2_PLACEMENT_3D").length, 1);
  assert.equal(doc.all("TRIMMED_CURVE").length, 4);
  assert.equal(result.report.arcs, 5); assert.equal(result.report.paths, 8);
  assert.deepEqual(p.lastExport.curveDefinitions, result.report.curveDefinitions);
  const arcs = result.model.sections[0].paths.filter(p => p.kind === "arc");
  assert.deepEqual(arcs.map(p => p.clockwise), [false, false, true, false, true]);
  assert.deepEqual(arcs.map(p => p.fullCircle), [false, false, false, true, true]);
  assert.deepEqual(arcs.slice(0, 3).map(p => p.spindle.speed), [600, 700, 800]);
  assert.equal(arcs[1].coolant, "flood"); assert.equal(arcs[1].feed.value, 0.11);
});
test("identical rapid and cutting curves remain separate moves and unequal arcs stay distinct", () => {
  const {p, s} = sample();
  s.rapid([3, 0, 0]); s.rapid([2, 0, 0]); // one ordered polyline, with both vertices retained
  s.linear([3, 0, 0], feed); s.linear([2, 0, 0], feed);
  let result = inspect(p.toSTEP());
  assert.equal(result.report.curveDefinitions.polylines, 1);
  assert.deepEqual(result.model.sections[0].paths.map(p => p.kind), ["rapid", "linear"]);
  assert.equal(result.model.sections[0].paths[0].feed, null);
  assert.deepEqual(result.model.sections[0].paths[1].feed, {value: 0.1, mode: "perRevolution"});
  s.arc([0, 0, -2], [0, 0, 0], false, feed, false); s.rapid([2 + 1e-12, 0, 0]);
  s.arc([0, 0, -(2 + 1e-12)], [0, 0, 0], false, feed, false);
  const doc = parse(p.toSTEP()); assert.equal(doc.all("CIRCLE").length, 2);
  assert.notEqual(doc.all("CIRCLE")[0].args[2], doc.all("CIRCLE")[1].args[2]);
});
test("comparison ignores export metadata, entity IDs and sharing but detects exact program changes", () => {
  const {p, s} = sample(); s.linear([3, 0, 0], feed); const baseline = p.toSTEP();
  const metadata = baseline.replace(p.timestamp, "2020-01-01T00:00:00Z").replace(/Fusion360Next-NC 0\.1\.\d+/, "Fusion360Next-NC 99.0.0");
  assert.equal(compare(baseline, metadata).sameProgram, true);
  // This fixture has no '#' inside string values, so renumbering references is unambiguous.
  const renumbered = baseline.replace(/#(\d+)/g, (_, id) => "#" + (Number(id) + 1000));
  assert.equal(compare(baseline, renumbered).sameProgram, true);
  // Give the line its own duplicate point definition, with identical coordinates.
  const doc = parse(baseline), id = doc.all("POLYLINE")[0].args[1][0].ref;
  const pointLine = baseline.split("\n").find(line => line.startsWith("#" + id + "="));
  const duplicated = change(baseline, "POLYLINE", line => line.replace("#" + id + ",", "#99999,"))
    .replace("\nENDSEC;\nEND-ISO", "\n" + pointLine.replace("#" + id + "=", "#99999=") + "\nENDSEC;\nEND-ISO");
  assert.equal(compare(baseline, duplicated).sameProgram, true);
  const variants = [
    [() => { s.paths[0].feed.value += 1e-12; }, "program.sections[0].paths[0].feed.value"],
    [() => { s.paths[0].points[1][0] += 1e-12; }, "program.sections[0].paths[0].points[1][0]"],
    [() => { s.workOffset = 2; }, "program.sections[0].workOffset"],
    [() => { s.paths[0].spindle.clockwise = false; }, "program.sections[0].paths[0].spindle.clockwise"],
    [() => { s.paths[0].coolant = "mist"; }, "program.sections[0].paths[0].coolant"]
  ];
  for (const [mutate, expected] of variants) {
    const before = p.toSTEP(); mutate(); const diff = compare(before, p.toSTEP());
    assert.equal(diff.sameProgram, false); assert.equal(diff.firstDifference.path, expected);
    assert.notEqual(diff.beforeFingerprint.value, diff.afterFingerprint.value);
  }
  assert.throws(() => compare(baseline, baseline.slice(0, -5)), /Incomplete/);
});
test("inspection rejects arc radius, frame and direction corruption", () => {
  const {p, s} = sample(); s.arc([0, 0, -2], [0, 0, 0], false, feed, false); const text = p.toSTEP();
  assert.throws(() => inspect(change(text, "CIRCLE", line => line.replace(/,2\.\);$/, ",3.);"))), /radius mismatch/);
  assert.throws(() => inspect(change(text, "DIRECTION", line => line.replace("(0.,1.,0.)", "(0.,0.,1.)"))), /XZ frame/);
  assert.throws(() => inspect(change(text, "TRIMMED_CURVE", line => line.replace(".T.", ".U."))), /explicit/);
});
test("CLI writes a new local report, rejects invalid data and never overwrites an existing file", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "next-nc-inspect-"));
  try {
    const input = path.join(directory, "input.stpnc"), output = path.join(directory, "report.json");
    const {p, s} = sample(); s.linear([3, 0, 0], feed); const text = p.toSTEP(); fs.writeFileSync(input, text);
    const cli = path.resolve(__dirname, "../scripts/inspect.js");
    let result = spawnSync(process.execPath, [cli, input, output], {encoding: "utf8"});
    assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(fs.readFileSync(output)).sections, 1);
    result = spawnSync(process.execPath, [cli, input, "--compare", input], {encoding: "utf8"});
    assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).comparison.sameProgram, true);
    const changed = path.join(directory, "changed.stpnc"); s.workOffset = 3; fs.writeFileSync(changed, p.toSTEP());
    result = spawnSync(process.execPath, [cli, changed, "--compare", input], {encoding: "utf8"});
    assert.equal(result.status, 3, result.stderr); assert.equal(JSON.parse(result.stdout).comparison.firstDifference.path, "program.sections[0].workOffset");
    for (const args of [[], [input, "--compare"], [input, "--unknown"], [input, "--compare", input, "--compare", input]]) {
      result = spawnSync(process.execPath, [cli, ...args], {encoding: "utf8"}); assert.equal(result.status, 2, result.stderr);
    }
    result = spawnSync(process.execPath, [cli, input, input], {encoding: "utf8"});
    assert.equal(result.status, 1); assert.equal(fs.readFileSync(input, "utf8"), text);
    fs.writeFileSync(input, "incomplete"); result = spawnSync(process.execPath, [cli, input], {encoding: "utf8"});
    assert.equal(result.status, 1); assert.match(result.stderr, /unsupported schema/);
  } finally { fs.rmSync(directory, {recursive: true, force: true}); }
});
