/* SPDX-License-Identifier: MIT
 * Fusion callbacks. Bundled after next-nc.js to produce a standalone CPS.
 */
description = "Next-NC - experimental AP238 XZ turning";
vendor = "Fusion360Next-NC";
vendorUrl = "https://github.com/markmounteer/Fusion360Next-NC";
legal = "Copyright (c) 2026 Mark Mounteer. MIT License.";
certificationLevel = 0;
minimumRevision = 45917;
extension = "stpnc";
longDescription = "Experimental toolpath-level STEP-NC/AP238 exporter for single-spindle XZ turning. Requires a Next-NC-aware consumer; LinuxCNC cannot load this file directly. No controller or machine options are duplicated here.";
capabilities = CAPABILITY_TURNING;
setCodePage("ascii");
properties = {};
tolerance = spatial(0.002, MM);
minimumChordLength = spatial(0.001, MM);
minimumCircularRadius = spatial(0.001, MM);
maximumCircularRadius = spatial(100000, MM);
minimumCircularSweep = toRad(0.001);
maximumCircularSweep = 2 * Math.PI;
allowHelicalMoves = false;
allowSpiralMoves = false;
allowedCircularPlanes = 1 << PLANE_ZX;

var nextProgram;
var nextSection;
var nextFeedMode;
var nextSpindle;
var nextFailed = false;

function nextGuard(fn) {
  if (nextFailed) { error("Next-NC: export has already failed."); return; }
  try { return fn(); } catch (e) { nextFailed = true; error(String(e.message || e)); }
}
function nextReject(message) { nextFailed = true; error("Next-NC: " + message); }
function nextPoint(p) { return [p.x, p.y, p.z]; }
function nextFeed(value) { return {value: value, mode: nextFeedMode}; }
function nextSetFeedMode(mode) {
  if (mode === FEED_PER_MINUTE) { nextFeedMode = "perMinute"; }
  else if (mode === FEED_PER_REVOLUTION) { nextFeedMode = "perRevolution"; }
  else { nextReject("Inverse-time and unrecognized feed modes are unsupported."); }
}
function nextCoolant(mode) {
  if (mode === COOLANT_OFF) { return "off"; }
  if (mode === COOLANT_FLOOD) { return "flood"; }
  if (mode === COOLANT_MIST) { return "mist"; }
  if (mode === COOLANT_THROUGH_TOOL) { return "through tool"; }
  throw new Error("Next-NC: unsupported coolant mode " + mode);
}
function nextNeedSection() { if (!nextSection) { throw new Error("Next-NC: event outside a machining section"); } }
function onOpen() {
  nextGuard(function () {
    nextProgram = new NextNC.Program({name: programName || "Fusion turning", units: unit === MM ? "mm" : "inch"});
  });
}
function onSection() {
  nextGuard(function () {
    if (currentSection.getType() !== TYPE_TURNING || currentSection.isMultiAxis()) {
      throw new Error("Next-NC: only fixed XZ turning sections are supported.");
    }
    if (currentSection.isOptional()) { throw new Error("Next-NC: optional sections are unsupported."); }
    if (currentSection.spindle !== SPINDLE_PRIMARY) { throw new Error("Next-NC: secondary spindle is unsupported."); }
    // The initial profile deliberately excludes rotated/mirrored setups.
    var wp = currentSection.workPlane;
    if (!isSameDirection(wp.forward, new Vector(0, 0, 1)) || !isSameDirection(wp.right, new Vector(1, 0, 0))) {
      throw new Error("Next-NC: use an unrotated turning work plane (+X right, +Z forward).");
    }
    setRotation(wp);
    nextSetFeedMode(currentSection.feedMode);
    var mode = tool.getSpindleMode();
    if (mode !== SPINDLE_CONSTANT_SURFACE_SPEED && mode !== SPINDLE_CONSTANT_SPINDLE_SPEED) {
      throw new Error("Next-NC: unsupported spindle mode.");
    }
    var css = mode === SPINDLE_CONSTANT_SURFACE_SPEED;
    nextSpindle = {mode: css ? "css" : "rpm", speed: css ? tool.surfaceSpeed : Math.abs(spindleSpeed),
      clockwise: tool.clockwise, maximumRPM: tool.maximumSpindleSpeed};
    nextSection = nextProgram.addSection({
      name: hasParameter("operation-comment") ? getParameter("operation-comment") : "Turning " + (getCurrentSectionId() + 1),
      tool: {number: tool.number, offset: tool.compensationOffset, description: tool.comment || ""},
      workOffset: currentSection.workOffset,
      start: nextPoint(getFramePosition(currentSection.getInitialPosition())),
      spindle: nextSpindle, coolant: nextCoolant(tool.coolant)
    });
  });
}
function onRapid(x, y, z) { nextGuard(function () { nextNeedSection(); nextSection.rapid([x, y, z]); }); }
function onLinear(x, y, z, feed) { nextGuard(function () { nextNeedSection(); nextSection.linear([x, y, z], nextFeed(feed)); }); }
function onCircular(clockwise, cx, cy, cz, x, y, z, feed) {
  nextGuard(function () {
    nextNeedSection();
    if (getCircularPlane() !== PLANE_ZX || isHelical()) { throw new Error("Next-NC: only planar XZ arcs are supported."); }
    nextSection.arc([x, y, z], [cx, cy, cz], clockwise, nextFeed(feed), isFullCircle());
  });
}
function onDwell(seconds) { nextGuard(function () { nextNeedSection(); nextSection.dwell(seconds); }); }
function onFeedMode(mode) { nextSetFeedMode(mode); }
function onSpindleSpeed(speed) {
  nextGuard(function () {
    nextNeedSection();
    if (nextSpindle.mode !== "rpm") { throw new Error("Next-NC: in-section CSS changes are unsupported; start a new operation."); }
    nextSpindle.speed = Math.abs(speed); nextSection.setSpindle(nextSpindle);
  });
}
function onRadiusCompensation() {
  if (radiusCompensation !== RADIUS_COMPENSATION_OFF) { nextReject("Choose compensation In computer in Fusion; controller compensation is unsupported."); }
}
function onToolCompensation() { nextReject("Dual tool compensation changes are unsupported."); }
function onCycle() { nextReject("Canned cycles and spindle-synchronized threading are not implemented."); }
function onCyclePoint() { nextReject("Cycle motion is unsupported."); }
function onCyclePath() { nextReject("Cycle paths are unsupported."); }
function onLinear5D() { nextReject("Multi-axis motion is unsupported."); }
function onRapid5D() { nextReject("Multi-axis motion is unsupported."); }
function onPassThrough() { nextReject("Pass-through NC is unsupported."); }
function onManualNC() { nextReject("Manual NC instructions are unsupported in this profile."); }
function onOrientateSpindle() { nextReject("Spindle orientation is unsupported."); }
function onMachineCommand() { nextReject("Machine-specific commands are unsupported."); }
function onSectionSpecialCycle() { nextReject("Special cycles are unsupported."); }
function onSpecialCycle() { nextReject("Special cycles are unsupported."); }
function onPower() { nextReject("Power-control instructions are unsupported."); }
function onLiveAlignment() { nextReject("Live part alignment is unsupported."); }
function onCommand(command) {
  if (command !== COMMAND_END) { nextReject("Unsupported command: " + getCommandStringId(command) + ". Set spindle and coolant in the Fusion operation."); }
}
function onSectionEnd() { nextSection = undefined; }
function onClose() {
  nextGuard(function () {
    // Nothing is emitted before the entire program has been accepted.
    var output = nextProgram.toSTEP().split("\n");
    for (var i = 0; i < output.length - 1; ++i) { writeln(output[i]); }
  });
}
