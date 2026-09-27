"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {parse} = require("./support/part21");
function engine(overrides = {}) {
  const output = [], logs = [];
  const constants = ["MM", "IN", "CAPABILITY_TURNING", "PLANE_ZX", "PLANE_XY", "TYPE_TURNING", "SPINDLE_PRIMARY",
    "SPINDLE_CONSTANT_SURFACE_SPEED", "SPINDLE_CONSTANT_SPINDLE_SPEED", "FEED_PER_MINUTE", "FEED_PER_REVOLUTION", "COOLANT_OFF", "COOLANT_FLOOD", "COOLANT_MIST", "COOLANT_THROUGH_TOOL",
    "RADIUS_COMPENSATION_OFF", "RADIUS_COMPENSATION_LEFT", "RADIUS_COMPENSATION_RIGHT", "COMMAND_START_SPINDLE", "COMMAND_COOLANT_ON", "COMMAND_COOLANT_OFF", "COMMAND_STOP_SPINDLE",
    "COMMAND_SPINDLE_CLOCKWISE", "COMMAND_SPINDLE_COUNTERCLOCKWISE", "COMMAND_END"];
  const c = Object.fromEntries(constants.map((name, index) => [name, index + 1]));
  Object.assign(c, {
    setCodePage() {}, spatial: n => n, toRad: n => n * Math.PI / 180,
    Vector: function (x, y, z) { Object.assign(this, {x, y, z}); },
    isSameDirection: (a, b) => ["x", "y", "z"].every(k => Math.abs(a[k] - b[k]) < 1e-9),
    setRotation() {}, getFramePosition: p => p, getCircularPlane: () => c.PLANE_ZX,
    isHelical: () => false, isFullCircle: () => false,
    hasParameter: name => c.currentSection.hasParameter(name), getParameter: name => c.currentSection.getParameter(name),
    getCurrentSectionId: () => 0, getNumberOfSections: () => c.sections.length, getSection: i => c.sections[i],
    getCommandStringId: n => String(n), error: message => { throw new Error(message); },
    log: message => logs.push(message), getVersion: () => "5.413.5", getSecurityLevel: () => 1000,
    getConfigurationPath: () => "synthetic/next-nc.cps", getOutputPath: () => "synthetic/1001.stpnc",
    getCurrentRecordId: () => 542, getCurrentNCLocation: () => "Synthetic record 542",
    writeln: line => output.push(line), programName: "Synthetic callback test", spindleSpeed: 1200
  });
  c.unit = c.MM; c.radiusCompensation = c.RADIUS_COMPENSATION_OFF;
  c.currentSection = {getType: () => c.TYPE_TURNING, isMultiAxis: () => false, isOptional: () => false,
    parameters: {"operation-comment": "Synthetic Fusion operation", "operation:compensationType": "computer"},
    hasParameter(name) { return Object.hasOwn(this.parameters, name); }, getParameter(name) { return this.parameters[name]; },
    getTool: () => c.tool, hasAnyCycle: () => false,
    spindle: c.SPINDLE_PRIMARY, feedMode: c.FEED_PER_REVOLUTION, workOffset: 1,
    workPlane: {forward: {x: 0, y: 0, z: 1}, right: {x: 1, y: 0, z: 0}}, getInitialPosition: () => ({x: 12, y: 0, z: 2})};
  c.tool = {getSpindleMode: () => c.SPINDLE_CONSTANT_SPINDLE_SPEED, number: 1, compensationOffset: 1,
    comment: "Synthetic tool", clockwise: true, surfaceSpeed: 80000, maximumSpindleSpeed: 1800, coolant: c.COOLANT_OFF};
  c.sections = [c.currentSection];
  Object.assign(c, overrides); vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../posts/next-nc.cps"), "utf8"), c);
  return {c, output, logs};
}
function failureReport(logs) {
  const report = logs.find(line => line.startsWith("NEXTNC DIAGNOSTIC BEGIN\n"));
  assert.ok(report, "Failure must include the detailed report");
  return JSON.parse(report.split("NEXTNC DIAGNOSTIC BEGIN\n")[1].split("\nNEXTNC DIAGNOSTIC END")[0]);
}
test("Autodesk configuration version is independent of the release", () => {
  const {c} = engine(); assert.equal(c.version, "1.0"); assert.equal(c.NextNC.version, require("../package.json").version);
});
test("precheck diagnostic contains all affected operations and engine context", () => {
  const {c, logs, output} = engine(); addSection(c, "Failing face", "control", 7);
  assert.throws(() => c.onOpen(), /precheck failed/);
  const report = failureReport(logs);
  assert.equal(report.engine, "5.413.5"); assert.equal(report.securityLevel, 1000);
  assert.equal(report.callback, "onOpen"); assert.equal(report.record, 542);
  assert.equal(report.sections.length, 2); assert.equal(report.sections[1].tool, 7);
  assert.match(report.sections[1].issues[0], /COMPENSATION/);
  assert.equal(report.configurationVersion, "1.0"); assert.ok(report.stack);
  assert.equal(output.length, 0);
});
test("runtime report preserves first error and a bounded recent callback trace", () => {
  const {c, logs} = engine(); c.onOpen(); c.onSection();
  for (let i = 0; i < 30; ++i) c.onLinear(12, 0, -i, 0.1);
  assert.throws(() => c.onLinear(12, 5, -31, 0.1));
  const report = failureReport(logs);
  assert.equal(report.callback, "onLinear"); assert.equal(report.recentEvents.length, 12);
  assert.deepEqual(report.recentEvents.at(-1).arguments, [12, 5, -31, 0.1]);
  assert.match(report.operation, /Synthetic Fusion operation/); assert.equal(report.spindle.speed, 1200);
  assert.throws(() => c.onClose(), /already failed/);
  assert.equal(logs.filter(s => s.startsWith("NEXTNC DIAGNOSTIC BEGIN")).length, 1);
});
test("diagnostic failures do not replace a machining error or allow output", () => {
  const {c, output} = engine({log() { throw Error("Log unavailable"); }, getCurrentRecordId() { throw Error("No record"); }});
  c.onOpen(); c.onSection(); assert.throws(() => c.onCycle(), /Canned cycles/);
  assert.throws(() => c.onClose(), /already failed/); assert.equal(output.length, 0);
});
test("successful export logs its identity without a failure report", () => {
  const {c, logs} = engine(); c.onOpen(); c.onSection(); c.onLinear(12, 0, 0, 0.1); c.onClose();
  assert.ok(logs.some(s => s.startsWith("NEXTNC START ")));
  assert.ok(logs.some(s => s.startsWith("NEXTNC OUTPUT WRITTEN ")));
  assert.equal(logs.filter(s => s.startsWith("NEXTNC DIAGNOSTIC BEGIN")).length, 0);
});
function addSection(c, name, compensation, toolNumber) {
  const section = {...c.currentSection, parameters: {"operation-comment": name}};
  if (compensation !== undefined) section.parameters["operation:compensationType"] = compensation;
  const sectionTool = {...c.tool, number: toolNumber};
  section.getTool = () => sectionTool;
  c.sections.push(section); return section;
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
test("Fusion numeric and Boolean arc directions retain both STEP senses", () => {
  for (const [flag, clockwise] of [[0, false], [1, true], [false, false], [true, true]]) {
    const {c, output} = engine(); c.onOpen(); c.onSection(); c.onRapid(10, 0, 0);
    c.onCircular(flag, 8, 0, 0, 8, 0, -2, 0.1);
    assert.equal(c.nextSection.paths.at(-1).clockwise, clockwise);
    c.onClose(); const doc = parse(output.join("\n") + "\n");
    assert.equal(doc.all("CIRCLE")[0].args[2], 2);
    assert.equal(doc.all("TRIMMED_CURVE")[0].args[4].symbol, clockwise ? ".F." : ".T.");
  }
});
test("Fusion numeric full-circle flags preserve complete circles", () => {
  for (const flag of [0, 1]) {
    const {c, output} = engine({isFullCircle: () => 1}); c.onOpen(); c.onSection(); c.onRapid(10, 0, 0);
    c.onCircular(flag, 8, 0, 0, 10, 0, 0, 0.1); c.onClose();
    const curve = parse(output.join("\n") + "\n").all("TRIMMED_CURVE")[0];
    assert.equal(curve.args[3][0].args[0], 2 * Math.PI);
    assert.equal(curve.args[4].symbol, flag ? ".F." : ".T.");
  }
  const {c, output} = engine({isFullCircle: () => 0}); c.onOpen(); c.onSection(); c.onRapid(10, 0, 0);
  c.onCircular(0, 8, 0, 0, 8, 0, -2, 0.1); c.onClose();
  assert.equal(parse(output.join("\n") + "\n").all("TRIMMED_CURVE")[0].args[5].symbol, ".CARTESIAN.");
});
test("invalid Fusion arc flags fail explicitly without a completed program", () => {
  for (const value of [undefined, null, -1, 2, "0", "1", "false", NaN, {}]) {
    for (const field of ["clockwise", "full-circle"]) {
      const {c, output, logs} = engine(field === "full-circle" ? {isFullCircle: () => value} : {});
      c.onOpen(); c.onSection(); c.onRapid(10, 0, 0);
      assert.throws(() => c.onCircular(field === "clockwise" ? value : 0, 8, 0, 0, 8, 0, -2, 0.1), /must be true\/false or numeric 0\/1/);
      assert.equal(failureReport(logs).callback, "onCircular");
      assert.throws(() => c.onClose(), /already failed/); assert.equal(output.length, 0);
    }
  }
});
test("rounding mismatch delegates to Fusion with the tighter remaining tolerance in mm and inches", () => {
  for (const scale of [1, 1 / 25.4]) {
    const {c, output, logs} = engine({spatial: n => n * scale});
    if (scale !== 1) c.unit = c.IN;
    const end = [8, 0, -2.00001 * scale];
    c.currentSection.parameters["operation:tolerance"] = 0.001 * scale;
    let usedTolerance;
    c.canLinearize = () => true;
    c.linearize = requested => { usedTolerance = requested; c.onLinear(...end, 0.1); };
    c.onOpen(); c.onSection(); c.onRapid(8 + 2 * scale, 0, 0);
    c.onCircular(0, 8, 0, 0, ...end, 0.1);
    assert.ok(usedTolerance > 0 && usedTolerance < 0.001 * scale);
    assert.ok(Math.abs(usedTolerance - 0.00099 * scale) < 1e-12);
    assert.equal(c.nextLinearizedArcs, 1); assert.ok(logs.some(s => s.startsWith("NEXTNC ARC LINEARIZED ")));
    assert.equal(c.nextSection.paths.at(-1).feed.value, 0.1);
    assert.deepEqual(Array.from(c.nextSection.position), end);
    c.onClose(); assert.equal(parse(output.join("\n") + "\n").all("CIRCLE").length, 0);
  }
});
test("arc fallback rejects excessive mismatch, unavailable linearization, and invalid operation tolerance", () => {
  for (const scenario of ["large mismatch", "tight operation", "unavailable", "invalid tolerance", "missing endpoint"]) {
    const {c, output} = engine(); let invoked = false;
    c.canLinearize = () => scenario !== "unavailable";
    c.linearize = () => { invoked = true; };
    if (scenario === "tight operation") c.currentSection.parameters["operation:tolerance"] = 0.0000001;
    if (scenario === "invalid tolerance") c.currentSection.parameters["operation:tolerance"] = 0;
    c.onOpen(); c.onSection(); c.onRapid(10, 0, 0);
    assert.throws(() => c.onCircular(0, 8, 0, 0, 8, 0, scenario === "large mismatch" ? -3 : -2.00001, 0.1), /linearization|linearize/);
    assert.equal(invoked, scenario === "missing endpoint"); assert.equal(c.nextLinearizedArcs, 0);
    assert.throws(() => c.onClose(), /already failed/); assert.equal(output.length, 0);
  }
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
test("precheck reports every affected section, including operations after a valid one", () => {
  const {c, output} = engine();
  addSection(c, "Face1 (3)", "control", 7);
  addSection(c, "Finish OD", "wear", 9);
  addSection(c, "Finish ID", "inverseWear", 10);
  assert.throws(() => c.onOpen(), error => {
    assert.match(error.message, /3 of 4 section\(s\)/);
    assert.match(error.message, /"Face1 \(3\)" \(section 2, tool T7\)/);
    assert.match(error.message, /"Finish OD" \(section 3, tool T9\)/);
    assert.match(error.message, /"Finish ID" \(section 4, tool T10\)/);
    for (const name of ["In control", "Wear", "Inverse wear"]) assert.ok(error.message.includes(name));
    assert.match(error.message, /Passes > Compensation Type > In computer/);
    assert.match(error.message, /regenerate/);
    assert.match(error.message, /No STEP-NC program was written/);
    return true;
  });
  assert.equal(c.nextProgram, undefined); assert.equal(output.length, 0);
  assert.throws(() => c.onClose(), /already failed/);
});
test("precheck accepts In computer and intentional Off without modifying operation parameters", () => {
  const {c, output} = engine(); addSection(c, "Reference move", "off", 2);
  const original = JSON.stringify(c.sections.map(s => s.parameters));
  c.onOpen(); assert.equal(JSON.stringify(c.sections.map(s => s.parameters)), original);
  c.onSection(); c.onRadiusCompensation(); c.onLinear(12, 0, 0, 0.1); c.onClose();
  assert.equal(parse(output.join("\n") + "\n").all("MACHINING_WORKINGSTEP").length, 1);
});
test("missing compensation metadata remains guarded at runtime with an actionable diagnosis", () => {
  const {c, output} = engine(); delete c.currentSection.parameters["operation:compensationType"];
  c.onOpen(); c.onSection(); c.onLinear(12, 0, 0, 0.1);
  c.radiusCompensation = c.RADIUS_COMPENSATION_LEFT;
  assert.throws(() => c.onRadiusCompensation(), error => {
    assert.match(error.message, /Synthetic Fusion operation/);
    assert.match(error.message, /left controller-side tool-nose compensation/);
    assert.match(error.message, /did not supply Compensation Type metadata/);
    assert.match(error.message, /precheck could not detect/);
    assert.match(error.message, /Passes > Compensation Type > In computer/); return true;
  });
  assert.equal(output.length, 0); assert.throws(() => c.onClose(), /already failed/);
});
test("runtime explains contradictory metadata and retains the right-compensation guard", () => {
  const {c, output} = engine(); c.onOpen(); c.onSection(); c.radiusCompensation = c.RADIUS_COMPENSATION_RIGHT;
  assert.throws(() => c.onRadiusCompensation(), error => {
    assert.match(error.message, /right controller-side/); assert.match(error.message, /reported Compensation Type = In computer/);
    assert.match(error.message, /selected the regenerated operation/); return true;
  });
  assert.equal(output.length, 0);
});
test("unknown compensation values are diagnosed rather than treated as In computer", () => {
  for (const value of ["futureMode", "toString", "__proto__", 2, null, ""]) {
    const {c} = engine(); c.currentSection.parameters["operation:compensationType"] = value;
    assert.throws(() => c.onOpen(), /unrecognized value/);
  }
});
test("precheck aggregates compensation, cycles, CSS cap, and coolant issues together", () => {
  const {c} = engine(); const section = addSection(c, "Combined issues", "control", 4);
  section.hasAnyCycle = () => true;
  const tool = section.getTool(); tool.getSpindleMode = () => c.SPINDLE_CONSTANT_SURFACE_SPEED;
  tool.maximumSpindleSpeed = 0; tool.coolant = -1;
  assert.throws(() => c.onOpen(), error => {
    for (const code of ["COMPENSATION", "CYCLE", "CSS_LIMIT", "COOLANT"]) assert.ok(error.message.includes(`[${code}]`));
    assert.match(error.message, /1 of 2 section/); return true;
  });
});
test("precheck gives distinct section identities for duplicate or missing names", () => {
  const {c} = engine(); addSection(c, "Repeated", "control", 3); addSection(c, "Repeated", "control", 3);
  const unnamed = addSection(c, "", "control", 4); delete unnamed.parameters["operation-comment"];
  assert.throws(() => c.onOpen(), error => {
    assert.match(error.message, /"Repeated" \(section 2, tool T3\)/);
    assert.match(error.message, /"Repeated" \(section 3, tool T3\)/);
    assert.match(error.message, /"Unnamed operation" \(section 4, tool T4\)/); return true;
  });
});
test("section start rechecks changed metadata and empty selection has an actionable error", () => {
  const {c} = engine(); c.onOpen(); c.currentSection.parameters["operation:compensationType"] = "control";
  assert.throws(() => c.onSection(), /Compensation Type is In control/);
  const empty = engine(); empty.c.sections = [];
  assert.throws(() => empty.c.onOpen(), /no machining sections selected/); assert.equal(empty.output.length, 0);
});
