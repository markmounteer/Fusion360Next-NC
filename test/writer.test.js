"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {Program, stepString, stepReal} = require("../src/next-nc");
const {parse} = require("./support/part21");
function sample(options = {}, spec = {}) {
  const program = new Program({name: "Test", units: "mm", timestamp: "2026-09-27T00:00:00Z", ...options});
  const section = program.addSection({name: "Outside", tool: {number: 7, offset: 3, description: "OD"},
    workOffset: 1, start: [12, 0, 2], spindle: {mode: "rpm", speed: 1200, clockwise: true}, coolant: "off", ...spec});
  return {program, section};
}
const f = {value: 0.1, mode: "perRevolution"};
test("complete AP238 graph, section sequence, logical tool and profile properties", () => {
  const {program, section} = sample(); section.linear([12, 0, -10], f);
  const text = program.toSTEP(), doc = parse(text);
  assert.match(text, /FILE_SCHEMA\(\('INTEGRATED_CNC_SCHEMA'\)\)/);
  assert.equal(doc.all("MACHINING_PROJECT").length, 1);
  assert.equal(doc.all("MACHINING_WORKINGSTEP").length, 1);
  assert.equal(doc.all("MACHINING_TOOL")[0].args[0], "7");
  assert.ok(doc.all("ACTION_PROPERTY").some(e => e.args[0] === "next-nc tool offset"));
  assert.ok(doc.all("DESCRIPTIVE_REPRESENTATION_ITEM").some(e => e.args[1] === "next-nc/turning-toolpath/0.1"));
  const sequence = doc.all("MACHINING_PROCESS_SEQUENCE_RELATIONSHIP")[0];
  assert.equal(sequence.args[4], 1);
  assert.equal(doc.get(sequence.args[2])[0].type, "MACHINING_WORKPLAN");
  assert.equal(doc.get(sequence.args[3])[0].type, "MACHINING_WORKINGSTEP");
  const features = doc.all("MACHINING_FEATURE_PROCESS"); assert.equal(features.length, 1);
  assert.equal(doc.all("PROPERTY_PROCESS")[0].args[0], "machining");
});
test("linear compaction preserves every vertex, rapid state, and feed changes", () => {
  const {program, section} = sample();
  section.rapid([11, 0, 2]); section.rapid([10, 0, 2]);
  section.linear([10, 0, 0], f); section.linear([10, 0, -5], f);
  section.linear([10, 0, -10], {value: 0.2, mode: "perRevolution"});
  const doc = parse(program.toSTEP());
  assert.equal(doc.all("MACHINING_TOOLPATH").length, 3);
  assert.deepEqual(doc.all("POLYLINE").map(e => e.args[1].length), [3, 3, 2]);
  assert.equal(doc.all("MACHINING_TOOLPATH_SPEED_PROFILE_REPRESENTATION").length, 1);
  const vertices = doc.all("POLYLINE")[1].args[1].map(ref => doc.get(ref)[0].args[1]);
  assert.deepEqual(vertices, [[10, 0, 2], [10, 0, 0], [10, 0, -5]]);
});
test("clockwise spindle sign, CSS speed and mandatory cap survive in standard representations", () => {
  const {program, section} = sample({}, {spindle: {mode: "css", speed: 80000, maximumRPM: 1800, clockwise: true}});
  section.linear([12, 0, 0], f);
  const doc = parse(program.toSTEP());
  const measures = doc.all("MEASURE_REPRESENTATION_ITEM");
  assert.ok(measures.some(e => e.args[0] === "surface speed" && e.args[1].args[0] === -80000));
  assert.ok(measures.some(e => e.args[0] === "maximum rotational speed" && e.args[1].args[0] === 1800));
  assert.ok(doc.all("MACHINING_FEED_SPEED_REPRESENTATION").some(e => e.args[0] === "feed per revolution"));
  assert.throws(() => sample({}, {spindle: {mode: "css", speed: 1, clockwise: true}}), /maximum RPM/);
});
test("inch geometry and CSS use explicit inch and inch/minute units", () => {
  const {program, section} = sample({units: "inch"}, {start: [0.5, 0, 0.1], spindle: {mode: "css", speed: 1200, maximumRPM: 1000, clockwise: false}});
  section.linear([0.5, 0, -1], {mode: "perMinute", value: 2});
  const doc = parse(program.toSTEP());
  assert.ok(doc.all("CONVERSION_BASED_UNIT").some(e => e.args[0] === "inch"));
  assert.ok(doc.all("LENGTH_MEASURE_WITH_UNIT").some(e => e.args[0].args[0] === 25.4));
  assert.ok(doc.all("MEASURE_REPRESENTATION_ITEM").some(e => e.args[0] === "surface speed" && e.args[1].args[0] === 1200));
  assert.ok(doc.all("CARTESIAN_POINT").some(e => e.args[1][0] === 0.5));
});
test("XZ arcs retain radius, endpoints, normal and both senses", () => {
  const {program, section} = sample({}, {start: [10, 0, 0]});
  section.arc([8, 0, -2], [8, 0, 0], false, f, false);
  section.arc([10, 0, 0], [8, 0, 0], true, f, false);
  const doc = parse(program.toSTEP());
  assert.deepEqual(doc.all("CIRCLE").map(e => e.args[2]), [2, 2]);
  assert.deepEqual(doc.all("TRIMMED_CURVE").map(e => e.args[4].symbol), [".T.", ".F."]);
  for (const circle of doc.all("CIRCLE")) {
    const axis = doc.get(circle.args[1])[0];
    assert.deepEqual(doc.get(axis.args[2])[0].args[1], [0, 1, 0]);
  }
});
test("full circles remain bounded curves and zero-length lines alone are omitted", () => {
  const {program, section} = sample({}, {start: [10, 0, 0]});
  section.linear([10, 0, 0], f);
  section.arc([10, 0, 0], [8, 0, 0], true, f, true);
  const doc = parse(program.toSTEP());
  assert.equal(doc.all("MACHINING_TOOLPATH").length, 1);
  const trim = doc.all("TRIMMED_CURVE")[0];
  assert.equal(trim.args[3][0].args[0], 2 * Math.PI);
  assert.equal(trim.args[5].symbol, ".PARAMETER.");
});
test("dwell, spindle changes and coolant changes remain ordered", () => {
  const {program, section} = sample();
  section.linear([12, 0, 0], f); section.dwell(0.25);
  section.setSpindle({mode: "rpm", speed: 700, clockwise: false}); section.setCoolant("mist");
  section.linear([12, 0, -5], f);
  const doc = parse(program.toSTEP());
  assert.deepEqual(doc.all("MACHINING_TOOLPATH").map(e => e.args[1]), ["cutter location trajectory", "feedstop", "cutter location trajectory"]);
  assert.ok(doc.all("MEASURE_REPRESENTATION_ITEM").some(e => e.args[0] === "dwell" && e.args[1].type === "TIME_MEASURE" && e.args[1].args[0] === 0.25));
  assert.ok(doc.all("MEASURE_REPRESENTATION_ITEM").some(e => e.args[0] === "rotational speed" && e.args[1].args[0] === 700));
});
test("nonfinite data, invalid modes, off-plane points, inconsistent arcs, empty programs fail", () => {
  assert.throws(() => new Program({units: "cm"}), /units/);
  assert.throws(() => new Program({units: "mm"}).toSTEP(), /no sections/);
  const {program, section} = sample();
  assert.throws(() => program.toSTEP(), /contains no motion/);
  assert.throws(() => section.linear([1, 2, 3], f), /Y=0/);
  assert.throws(() => section.linear([NaN, 0, 3], f), /finite/);
  assert.throws(() => section.linear([1, 0, 3], {mode: "inverseTime", value: 1}), /feed mode/);
  assert.throws(() => section.linear([1, 0, 3], {mode: "perMinute", value: 0}), /positive/);
  assert.throws(() => section.arc([20, 0, 3], [1, 0, 0], true, f, false), /radii/);
  assert.throws(() => section.setCoolant("air"), /unsupported coolant/);
});
test("STEP strings and reals resist injection and retain precision", () => {
  assert.equal(stepString("O'Brien"), "'O''Brien'");
  assert.equal(stepString("a\\b"), "'a\\\\b'");
  assert.equal(stepString("é"), "'\\X2\\00E9\\X0\\'");
  assert.equal(stepString("😀"), "'\\X2\\D83DDE00\\X0\\'");
  assert.throws(() => stepString("\uD800"), /surrogate/);
  assert.equal(stepReal(1e-12), "1.E-12"); assert.equal(stepReal(-0), "0.");
  const {program, section} = sample({name: "O'Brien\n#999=EVIL();é"}); section.linear([12, 0, 0], f);
  const doc = parse(program.toSTEP()); assert.equal(doc.all("EVIL").length, 0);
  assert.equal(doc.all("MACHINING_PROJECT").length, 1);
});
test("independent reader rejects missing references and truncation", () => {
  const {program, section} = sample(); section.linear([12, 0, 0], f);
  assert.throws(() => parse(program.toSTEP().replace("#1=", "#999999=")), /Missing reference/);
  assert.throws(() => parse(program.toSTEP().slice(0, -5)), /Incomplete/);
});
module.exports = {sample};
