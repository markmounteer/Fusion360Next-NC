/* SPDX-License-Identifier: MIT
 * Fusion callbacks. Bundled after next-nc.js to produce a standalone CPS.
 */
description = "Next-NC - experimental AP238 XZ turning";
vendor = "Fusion360Next-NC";
vendorUrl = "https://github.com/markmounteer/Fusion360Next-NC";
legal = "Copyright (c) 2026 Mark Mounteer. MIT License.";
version = NextNC.version;
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
var nextOperationLabel = "";

function nextDiagnosticText(value) { return String(value).replace(/[\x00-\x1f\x7f]/g, " ").replace(/"/g, "'"); }
function nextLabel(section, index) {
  var name = section.hasParameter("operation-comment") ? section.getParameter("operation-comment") : "";
  var sectionTool = section.getTool();
  return "Operation \"" + nextDiagnosticText(name || "Unnamed operation") + "\" (section " + (index + 1) +
    ", tool T" + nextDiagnosticText(sectionTool.number) + ")";
}
function nextCompensation(section) {
  // Missing metadata is not evidence of In computer. Keep the runtime guard active.
  if (!section.hasParameter("operation:compensationType")) { return null; }
  var value = section.getParameter("operation:compensationType");
  var names = {computer: "In computer", control: "In control", wear: "Wear", inverseWear: "Inverse wear", off: "Off"};
  var known = Object.prototype.hasOwnProperty.call(names, value);
  return {value: value, known: known, name: known ? names[value] : "unrecognized value \"" + nextDiagnosticText(value) + "\""};
}
function nextCompensationFix() {
  return "In Fusion, edit this operation > Passes > Compensation Type > In computer, regenerate its toolpath, then post again. " +
    "Do not select Off just to bypass this check; Off removes compensation.";
}
function nextPositive(value) { return typeof value === "number" && isFinite(value) && value > 0 && value < 1e15; }
function nextSectionIssues(section) {
  var issues = [];
  if (section.getType() !== TYPE_TURNING || section.isMultiAxis()) {
    issues.push("[SECTION] Only fixed XZ turning is supported. Select fixed turning operations for this post.");
  }
  if (section.isOptional()) { issues.push("[OPTIONAL] Optional sections are unsupported. Make this operation non-optional or exclude it."); }
  if (section.spindle !== SPINDLE_PRIMARY) { issues.push("[SPINDLE] Secondary-spindle operations are unsupported. Use a primary-spindle setup."); }
  var wp = section.workPlane;
  if (!isSameDirection(wp.forward, new Vector(0, 0, 1)) || !isSameDirection(wp.right, new Vector(1, 0, 0))) {
    issues.push("[WORKPLANE] Rotated/mirrored work planes are unsupported. Use an unrotated turning work plane (+X right, +Z forward).");
  }
  var comp = nextCompensation(section);
  if (comp && comp.value !== "computer" && comp.value !== "off") {
    issues.push("[COMPENSATION] Compensation Type is " + comp.name + ". " +
      (comp.known ? "This requests controller-side compensation, which this post does not support. " : "This post cannot interpret that setting. ") +
      nextCompensationFix());
  }
  if (section.hasAnyCycle()) {
    issues.push("[CYCLE] This section contains a cycle. Canned cycles and synchronized threading/tapping are unsupported; exclude it or use a post that supports it.");
  }
  if (section.feedMode !== FEED_PER_MINUTE && section.feedMode !== FEED_PER_REVOLUTION) {
    issues.push("[FEED] Unsupported feed mode. Use feed per minute or feed per revolution.");
  }
  var sectionTool = section.getTool(), mode = sectionTool.getSpindleMode();
  if (mode === SPINDLE_CONSTANT_SURFACE_SPEED) {
    if (!nextPositive(sectionTool.surfaceSpeed)) { issues.push("[CSS_SPEED] Set a positive surface speed in the Fusion operation's Tool tab."); }
    if (!nextPositive(sectionTool.maximumSpindleSpeed)) { issues.push("[CSS_LIMIT] Set a positive maximum spindle speed for CSS in the Fusion operation's Tool tab."); }
  } else if (mode !== SPINDLE_CONSTANT_SPINDLE_SPEED) {
    issues.push("[SPINDLE_MODE] Only constant RPM or constant surface speed is supported. Review the Fusion operation's spindle settings.");
  }
  if ([COOLANT_OFF, COOLANT_FLOOD, COOLANT_MIST, COOLANT_THROUGH_TOOL].indexOf(sectionTool.coolant) < 0) {
    issues.push("[COOLANT] Unsupported coolant selection. Supported modes are Off, Flood, Mist, and Through tool.");
  }
  return issues;
}
function nextPrecheck() {
  var problems = [], affected = 0, count = getNumberOfSections();
  if (!count) { throw new Error("Next-NC precheck: no machining sections selected. Select a turning operation and post again."); }
  for (var i = 0; i < count; ++i) {
    var section = getSection(i), issues = nextSectionIssues(section);
    if (issues.length) {
      ++affected;
      problems.push(nextLabel(section, i) + ":\n  - " + issues.join("\n  - "));
    }
  }
  if (problems.length) {
    throw new Error("Next-NC " + NextNC.version + " precheck failed: " + affected + " of " + count + " section(s) need attention.\n\n" +
      problems.join("\n\n") + "\n\nNo STEP-NC program was written. Correct the listed settings and regenerate the affected toolpaths.");
  }
}

function nextGuard(fn) {
  if (nextFailed) { error("Next-NC: export has already failed."); return; }
  try { return fn(); } catch (e) { nextFailed = true; error(String(e.message || e)); }
}
function nextReject(message) {
  nextFailed = true;
  error("Next-NC: " + (nextOperationLabel ? nextOperationLabel + ": " : "") + message);
}
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
    nextPrecheck();
    nextProgram = new NextNC.Program({name: programName || "Fusion turning", units: unit === MM ? "mm" : "inch"});
  });
}
function onSection() {
  nextGuard(function () {
    nextOperationLabel = nextLabel(currentSection, getCurrentSectionId());
    var issues = nextSectionIssues(currentSection);
    if (issues.length) { throw new Error("Next-NC: " + nextOperationLabel + ":\n  - " + issues.join("\n  - ")); }
    setRotation(currentSection.workPlane);
    nextSetFeedMode(currentSection.feedMode);
    var mode = tool.getSpindleMode();
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
  if (radiusCompensation === RADIUS_COMPENSATION_OFF) { return; }
  var side = radiusCompensation === RADIUS_COMPENSATION_LEFT ? "left" :
    radiusCompensation === RADIUS_COMPENSATION_RIGHT ? "right" : "unrecognized mode " + radiusCompensation;
  var comp = nextCompensation(currentSection);
  var detail = !comp ? "Fusion did not supply Compensation Type metadata, so precheck could not detect this request. " :
    "Fusion reported Compensation Type = " + comp.name + ", but the motion requests controller-side compensation. " +
    "If the operation already shows In computer, regenerate it and check that you selected the regenerated operation. ";
  nextReject("[COMPENSATION] The toolpath requests " + side + " controller-side tool-nose compensation. " + detail + nextCompensationFix());
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
function onSectionEnd() { nextSection = undefined; nextOperationLabel = ""; }
function onClose() {
  nextGuard(function () {
    // Nothing is emitted before the entire program has been accepted.
    var output = nextProgram.toSTEP().split("\n");
    for (var i = 0; i < output.length - 1; ++i) { writeln(output[i]); }
  });
}
