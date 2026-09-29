"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const {engine} = require("./support/fusion-engine");
const {inspect} = require("../lib/inspect");
function millCycle(type, units = "mm") {
  const e = engine(), c = e.c;
  c.unit = units === "mm" ? c.MM : c.IN;
  c.currentSection.getType = () => c.TYPE_MILLING;
  c.currentSection.hasAnyCycle = () => true;
  c.currentSection.feedMode = c.FEED_PER_MINUTE;
  c.currentSection.parameters["operation:cycleType"] = type;
  c.tool.lengthOffset = 5;
  c.cycleType = type;
  c.cycle = {clearance: 5, retract: 2, stock: 0, depth: 3, feedrate: 100};
  // A synthetic expansion service. Actual Autodesk expansion is tested separately.
  c.expandCyclePoint = (x, y, z) => {
    c.onRapid(x, y, 5); c.onRapid(x, y, 2);
    c.onLinear(x, y, z, 100);
    if (type === "counter-boring") c.onDwell(0.25);
    c.onRapid(x, y, 5);
  };
  return e;
}
test("four allowlisted mill cycles preserve expanded XYZ, feeds and dwell in both units", () => {
  for (const units of ["mm", "inch"]) for (const type of ["drilling", "counter-boring", "chip-breaking", "deep-drilling"]) {
    const {c, output, logs} = millCycle(type, units);
    c.onOpen(); c.onSection(); c.onCycle();
    c.onCyclePoint(1, 2, -3); c.onCyclePoint(4, 6, -7); c.onCycleEnd();
    c.onSectionEnd(); c.onClose();
    const decoded = inspect(output.join("\n") + "\n");
    assert.equal(decoded.model.units, units);
    assert.deepEqual(decoded.model.sections[0].tool, {number: 1, offset: 5, description: "Synthetic tool"});
    const paths = decoded.model.sections[0].paths;
    assert.deepEqual(paths.filter(p => p.kind === "linear").map(p => [p.points, p.feed]), [
      [[[1, 2, 2], [1, 2, -3]], {value: 100, mode: "perMinute"}],
      [[[4, 6, 2], [4, 6, -7]], {value: 100, mode: "perMinute"}]
    ]);
    assert.deepEqual(paths.at(-1).points.at(-1), [4, 6, 5]);
    assert.equal(paths.filter(p => p.kind === "dwell").length, type === "counter-boring" ? 2 : 0);
    const summary = JSON.parse(logs.find(l => l.startsWith("NEXTNC OUTPUT WRITTEN ")).slice(22));
    assert.equal(summary.expandedCyclePoints, 2); assert.deepEqual(summary.expandedCycleTypes, [type]);
    assert.equal(Object.keys(c.properties).length, 0);
  }
});
test("unsupported cycles fail both early metadata and runtime checks, without output", () => {
  for (const type of ["tapping", "left-tapping", "right-tapping", "boring", "stop-boring", "probing", "thread-milling", "unknown"]) {
    const early = millCycle(type);
    assert.throws(() => early.c.onOpen(), /\[CYCLE\]/); assert.equal(early.output.length, 0);
    const runtime = millCycle(type); delete runtime.c.currentSection.parameters["operation:cycleType"];
    runtime.c.onOpen(); runtime.c.onSection();
    assert.throws(() => runtime.c.onCycle(), /\[CYCLE\]/);
    assert.throws(() => runtime.c.onClose(), /already failed/); assert.equal(runtime.output.length, 0);
  }
});
test("cycle lifecycle and expansion failures retain context and cannot serialize", () => {
  const cases = [
    c => { c.cycle.stopSpindle = true; c.onCycle(); },
    c => { c.expandCyclePoint = undefined; c.onCycle(); },
    c => { c.onCyclePoint(1, 2, -3); },
    c => { c.onCycle(); c.onCycle(); },
    c => { c.onCycle(); c.onCycleEnd(); },
    c => { c.onCycle(); c.onSectionEnd(); },
    c => { c.onCycle(); c.onClose(); },
    c => { c.onCycle(); c.cycleType = "tapping"; c.onCyclePoint(1, 2, -3); },
    c => { c.onCycle(); c.expandCyclePoint = () => {}; c.onCyclePoint(1, 2, -3); },
    c => { c.onCycle(); c.expandCyclePoint = () => c.onRapid(1, 2, 5); c.onCyclePoint(1, 2, -3); },
    c => { c.onCycle(); c.expandCyclePoint = () => c.onCommand(c.COMMAND_STOP_SPINDLE); c.onCyclePoint(1, 2, -3); },
    c => { c.onCycle(); c.expandCyclePoint = () => { c.onLinear(1, 2, -3, 100); c.onCommand(c.COMMAND_END); }; c.onCyclePoint(1, 2, -3); },
    c => { c.onCycle(); c.expandCyclePoint = () => c.onLinear(1, 2, NaN, 100); c.onCyclePoint(1, 2, -3); }
  ];
  for (const run of cases) {
    const {c, output, logs} = millCycle("drilling"); c.onOpen(); c.onSection();
    assert.throws(() => run(c)); assert.throws(() => c.onClose(), /already failed/); assert.equal(output.length, 0);
    const report = JSON.parse(logs.find(l => l.startsWith("NEXTNC DIAGNOSTIC BEGIN\n")).split("\n").slice(1, -1).join("\n"));
    assert.match(report.operation, /Synthetic Fusion operation/);
    assert.ok(report.callback); assert.equal(report.expandedCyclePoints, 0);
  }
});
test("oversized output is rejected before writing any bytes", () => {
  const {c, output} = engine(); c.onOpen(); c.onSection(); c.onLinear(12, 0, 0, 0.1);
  c.nextProgram.toSTEP = () => "A".repeat(32 * 1024 * 1024 + 1);
  assert.throws(() => c.onClose(), /32 MiB/); assert.equal(output.length, 0);
});
