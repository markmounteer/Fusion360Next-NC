"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
function engine(overrides = {}) {
  const output = [], logs = [];
  const constants = ["MM", "IN", "CAPABILITY_MILLING", "TYPE_MILLING", "PLANE_YZ", "CAPABILITY_TURNING", "PLANE_ZX", "PLANE_XY", "TYPE_TURNING", "SPINDLE_PRIMARY",
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
    getInitialSpindleSpeed: () => c.spindleSpeed, getStrategy: () => "turningProfile",
    spindle: c.SPINDLE_PRIMARY, feedMode: c.FEED_PER_REVOLUTION, workOffset: 1,
    workPlane: {forward: {x: 0, y: 0, z: 1}, right: {x: 1, y: 0, z: 0}}, getInitialPosition: () => ({x: 12, y: 0, z: 2})};
  c.tool = {getSpindleMode: () => c.SPINDLE_CONSTANT_SPINDLE_SPEED, number: 1, compensationOffset: 1,
    comment: "Synthetic tool", clockwise: true, surfaceSpeed: 80000, maximumSpindleSpeed: 1800, coolant: c.COOLANT_OFF};
  c.sections = [c.currentSection];
  Object.assign(c, overrides); vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../../posts/next-nc.cps"), "utf8"), c);
  return {c, output, logs};
}
module.exports = {engine};
