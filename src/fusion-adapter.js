/* SPDX-License-Identifier: MIT
 * Fusion callbacks. Bundled after next-nc.js to produce a standalone CPS.
 */
description = "Next-NC - experimental AP238 XZ turning";
vendor = "Fusion360Next-NC";
vendorUrl = "https://github.com/markmounteer/Fusion360Next-NC";
legal = "Copyright (c) 2026 Mark Mounteer. MIT License.";
// Autodesk's configuration format version, NOT the Next-NC release number.
version = "1.0";
certificationLevel = 0;
minimumRevision = 45917;
extension = "stpnc";
longDescription = "Next-NC " + NextNC.version + ". Experimental toolpath-level STEP-NC/AP238 exporter for single-spindle XZ turning. Requires a Next-NC-aware consumer; LinuxCNC cannot load this file directly. No controller or machine options are duplicated here.";
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
var nextRecentEvents = [];
var nextEventCount = 0;
var nextStartedUTC = "";
var nextSectionDiagnostics = [];
var nextLinearizedArcs = 0;

// Use the engine log: direct file access is restricted by Fusion's security
// level, and no callback can run when the engine rejects the global script.
function nextRead(read) {
  try { var value = read(); return value === undefined ? "unavailable" : value; }
  catch (e) { return "unavailable: " + String(e.message || e); }
}
function nextLog(message) {
  // Logging must never replace the original error or change export acceptance.
  try { log(message); } catch (e) { /* The engine still receives error(). */ }
}
function nextContext() {
  return {
    schema: "next-nc/diagnostic/1", release: NextNC.version, profile: NextNC.profile,
    configurationVersion: version, minimumRevision: minimumRevision, certificationLevel: certificationLevel,
    engine: nextRead(function () { return getVersion(); }),
    securityLevel: nextRead(function () { return getSecurityLevel(); }),
    configurationPath: nextRead(function () { return getConfigurationPath(); }),
    outputPath: nextRead(function () { return getOutputPath(); }),
    program: nextRead(function () { return programName; }), units: unit === MM ? "mm" : "inch",
    startedUTC: nextStartedUTC, sectionCount: nextRead(function () { return getNumberOfSections(); }),
    linearizedArcCount: nextLinearizedArcs
  };
}
function nextSnapshot(section, index, issues) {
  return nextRead(function () {
    var t = section.getTool(), comp = nextCompensation(section);
    return {label: nextLabel(section, index), section: index + 1, type: section.getType(),
      tool: t.number, toolOffset: t.compensationOffset, workOffset: section.workOffset,
      compensation: comp || "metadata missing; runtime guard active", feedMode: section.feedMode,
      strategy: nextRead(function () { return section.getStrategy(); }),
      entry: nextRead(function () { return nextPoint(section.getInitialPosition()); }),
      initialRPM: nextRead(function () { return section.getInitialSpindleSpeed(); }),
      operationTolerance: nextRead(function () { return section.getParameter("operation:tolerance"); }),
      spindleMode: t.getSpindleMode(), surfaceSpeed: t.surfaceSpeed, maximumRPM: t.maximumSpindleSpeed,
      clockwise: t.clockwise, coolant: t.coolant,
      workPlane: {forward: nextPoint(section.workPlane.forward), right: nextPoint(section.workPlane.right)},
      issues: issues};
  });
}
function nextFail(e) {
  if (nextFailed) { error("Next-NC: export has already failed; see the first diagnostic."); return; }
  nextFailed = true;
  var message = String(e.message || e);
  try {
    var report = nextContext();
    report.status = "failed";
    report.failedUTC = new Date().toISOString();
    report.error = message;
    report.callback = nextRecentEvents.length ? nextRecentEvents[nextRecentEvents.length - 1].callback : "unknown";
    report.operation = nextOperationLabel || "No active operation (see section diagnostics)";
    report.record = nextRead(function () { return getCurrentRecordId(); });
    report.ncLocation = nextRead(function () { return getCurrentNCLocation(); });
    report.spindle = nextSpindle;
    report.feedMode = nextFeedMode;
    report.stack = e.stack || "not supplied by engine";
    report.callbackCount = nextEventCount;
    report.recentEvents = nextRecentEvents;
    report.sections = nextSectionDiagnostics;
    report.sectionSnapshotLimit = 200;
    report.outputStatus = "FAILED. Do not use the output; serialization/output may be incomplete.";
    nextLog("NEXTNC DIAGNOSTIC BEGIN\n" + JSON.stringify(report, null, 2) + "\nNEXTNC DIAGNOSTIC END");
  } catch (reportError) {
    nextLog("Next-NC diagnostic assembly failed: " + String(reportError.message || reportError) + "; original error: " + message);
  }
  error(message + "\n\nNext-NC " + NextNC.version + ": see the detailed report in Fusion's full post log. " +
    "With the Windows collector installed, reports are archived at %LOCALAPPDATA%\\Fusion360Next-NC\\diagnostics\\latest-error.txt.");
}
function nextCallback(name, callback) {
  return function () {
    if (nextFailed) { error("Next-NC: export has already failed; see the first diagnostic."); return; }
    ++nextEventCount;
    nextRecentEvents.push({callback: name, arguments: Array.prototype.slice.call(arguments),
      record: nextRead(function () { return getCurrentRecordId(); })});
    if (nextRecentEvents.length > 12) { nextRecentEvents.shift(); }
    try { return callback.apply(this, arguments); }
    catch (e) { if (nextFailed) { throw e; } nextFail(e); }
  };
}

function nextDiagnosticText(value) { return String(value).replace(/[\x00-\x1f\x7f]/g, " ").replace(/"/g, "'"); }
function nextLabel(section, index) {
  var name = nextRead(function () { return section.hasParameter("operation-comment") ? section.getParameter("operation-comment") : ""; });
  var number = nextRead(function () { return section.getTool().number; });
  return "Operation \"" + nextDiagnosticText(name || "Unnamed operation") + "\" (section " + (index + 1) +
    ", tool T" + nextDiagnosticText(number) + ")";
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
function nextInteger(value, minimum) {
  return typeof value === "number" && isFinite(value) && value >= minimum && value < 1e15 && Math.floor(value) === value;
}
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
  if (!nextInteger(sectionTool.number, 1)) { issues.push("[TOOL_NUMBER] Set a positive integer tool number in Fusion's tool definition."); }
  if (!nextInteger(sectionTool.compensationOffset, 0)) { issues.push("[TOOL_OFFSET] Set a nonnegative integer compensation offset in Fusion's tool definition."); }
  if (!nextInteger(section.workOffset, 0)) { issues.push("[WORK_OFFSET] Set a nonnegative integer WCS offset in the Fusion setup. Offset 0 remains unspecified and needs an explicit consumer mapping."); }
  if ([true, false, 0, 1].indexOf(sectionTool.clockwise) < 0) { issues.push("[DIRECTION] Fusion did not supply an explicit spindle direction. Review the tool/operation and regenerate it."); }
  var initial = section.getInitialPosition();
  if (!initial || [initial.x, initial.y, initial.z].some(function (v) { return typeof v !== "number" || !isFinite(v) || Math.abs(v) >= 1e15; })) {
    issues.push("[ENTRY] Fusion supplied an invalid initial position. Regenerate this operation's toolpath.");
  }
  if (section.hasParameter("operation:tolerance") && !nextPositive(section.getParameter("operation:tolerance"))) {
    issues.push("[TOLERANCE] Fusion's operation tolerance must be a positive finite value. Review the operation and regenerate its toolpath.");
  }
  if (mode === SPINDLE_CONSTANT_SURFACE_SPEED) {
    if (!nextPositive(sectionTool.surfaceSpeed)) { issues.push("[CSS_SPEED] Set a positive surface speed in the Fusion operation's Tool tab."); }
    if (!nextPositive(sectionTool.maximumSpindleSpeed)) { issues.push("[CSS_LIMIT] Set a positive maximum spindle speed for CSS in the Fusion operation's Tool tab."); }
  } else if (mode === SPINDLE_CONSTANT_SPINDLE_SPEED) {
    var initialRPM = section.getInitialSpindleSpeed();
    if (typeof initialRPM !== "number" || !nextPositive(Math.abs(initialRPM))) { issues.push("[RPM] Set a positive spindle RPM in the Fusion operation's Tool tab and regenerate the toolpath."); }
  } else {
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
    var section = undefined, issues;
    try { section = getSection(i); issues = nextSectionIssues(section); }
    catch (e) { issues = ["[METADATA] Fusion section metadata could not be read: " + nextDiagnosticText(e.message || e) + ". Regenerate this operation and check the full diagnostic log."]; }
    if (nextSectionDiagnostics.length < 200) { nextSectionDiagnostics.push(nextSnapshot(section, i, issues)); }
    if (issues.length) {
      ++affected;
      problems.push(nextLabel(section, i) + ":\n  - " + issues.join("\n  - "));
    }
  }
  if (problems.length) {
    throw new Error("Next-NC " + NextNC.version + " precheck failed: " + affected + " of " + count + " section(s) need attention.\n\n" +
      problems.join("\n\n") + "\n\nNo STEP-NC program was written. Correct the listed settings and regenerate the affected toolpaths.");
  }
  nextLog("NEXTNC PRECHECK " + JSON.stringify({status: "passed", sectionsChecked: count,
    sections: nextSectionDiagnostics, sectionSnapshotLimit: 200,
    validation: "Fusion source metadata only; machine/tool-table compatibility and clearance are not checked."}));
}

function nextGuard(fn) {
  if (nextFailed) { error("Next-NC: export has already failed."); return; }
  try { return fn(); } catch (e) { if (nextFailed) { throw e; } nextFail(e); }
}
function nextReject(message) {
  nextFail(new Error("Next-NC: " + (nextOperationLabel ? nextOperationLabel + ": " : "") + message));
}
function nextPoint(p) { return [p.x, p.y, p.z]; }
function nextBoolean(value, label) {
  // Native callbacks can supply numeric flags even though the API says Boolean.
  // Normalize only the explicit 0/1 encodings; truthiness would hide bad input.
  if (value === true || value === 1) { return true; }
  if (value === false || value === 0) { return false; }
  throw new Error("Next-NC: " + label + " must be true/false or numeric 0/1; received " +
    nextDiagnosticText(value) + " (" + typeof value + ").");
}
function nextArcTolerance() {
  // Fusion owns the machining tolerance. Never loosen a tighter operation value.
  var limit = tolerance;
  if (hasParameter("operation:tolerance")) {
    var operationTolerance = getParameter("operation:tolerance");
    if (!nextPositive(operationTolerance)) { throw new Error("Next-NC: invalid Fusion operation tolerance for arc linearization."); }
    limit = Math.min(limit, operationTolerance);
  }
  return limit;
}
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
    nextStartedUTC = new Date().toISOString();
    nextLog("NEXTNC START " + JSON.stringify(nextContext()));
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
      clockwise: nextBoolean(tool.clockwise, "Fusion spindle direction"), maximumRPM: tool.maximumSpindleSpeed};
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
    clockwise = nextBoolean(clockwise, "Fusion onCircular clockwise flag");
    var fullCircle = nextBoolean(isFullCircle(), "Fusion full-circle flag");
    try { nextSection.arc([x, y, z], [cx, cy, cz], clockwise, nextFeed(feed), fullCircle); }
    catch (e) {
      if (e.code !== "ARC_RADII" || fullCircle) { throw e; }
      var limit = nextArcTolerance(), remaining = limit - e.radialDifference;
      if (!(remaining > 0) || !canLinearize()) {
        throw new Error("Next-NC: arc endpoint radius difference " + e.radialDifference + " exceeds the available linearization budget " +
          limit + " or Fusion cannot linearize this record. Review/regenerate this operation; no arc geometry was changed.");
      }
      // The strict writer has not appended the rejected arc or advanced position.
      // Ask Fusion to generate the approximation; do not invent a new arc center.
      linearize(remaining);
      if (nextSection.position[0] !== x || nextSection.position[2] !== z) {
        throw new Error("Next-NC: Fusion arc linearization did not reach the supplied endpoint; export stopped.");
      }
      ++nextLinearizedArcs;
      nextLog("NEXTNC ARC LINEARIZED " + JSON.stringify({operation: nextOperationLabel,
        record: getCurrentRecordId(), radialDifference: e.radialDifference, tolerance: remaining, units: unit === MM ? "mm" : "inch"}));
    }
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
    nextLog("NEXTNC OUTPUT WRITTEN " + JSON.stringify({release: NextNC.version, callbacks: nextEventCount,
      sections: getNumberOfSections(), lines: output.length - 1, linearizedArcs: nextLinearizedArcs,
      summary: nextProgram.lastExport}));
  });
}

// Explicit entry-point wrapping also catches failures outside nextGuard.
onOpen = nextCallback("onOpen", onOpen);
onSection = nextCallback("onSection", onSection);
onRapid = nextCallback("onRapid", onRapid);
onLinear = nextCallback("onLinear", onLinear);
onCircular = nextCallback("onCircular", onCircular);
onDwell = nextCallback("onDwell", onDwell);
onFeedMode = nextCallback("onFeedMode", onFeedMode);
onSpindleSpeed = nextCallback("onSpindleSpeed", onSpindleSpeed);
onRadiusCompensation = nextCallback("onRadiusCompensation", onRadiusCompensation);
onToolCompensation = nextCallback("onToolCompensation", onToolCompensation);
onCycle = nextCallback("onCycle", onCycle);
onCyclePoint = nextCallback("onCyclePoint", onCyclePoint);
onCyclePath = nextCallback("onCyclePath", onCyclePath);
onLinear5D = nextCallback("onLinear5D", onLinear5D);
onRapid5D = nextCallback("onRapid5D", onRapid5D);
onPassThrough = nextCallback("onPassThrough", onPassThrough);
onManualNC = nextCallback("onManualNC", onManualNC);
onOrientateSpindle = nextCallback("onOrientateSpindle", onOrientateSpindle);
onMachineCommand = nextCallback("onMachineCommand", onMachineCommand);
onSectionSpecialCycle = nextCallback("onSectionSpecialCycle", onSectionSpecialCycle);
onSpecialCycle = nextCallback("onSpecialCycle", onSpecialCycle);
onPower = nextCallback("onPower", onPower);
onLiveAlignment = nextCallback("onLiveAlignment", onLiveAlignment);
onCommand = nextCallback("onCommand", onCommand);
onSectionEnd = nextCallback("onSectionEnd", onSectionEnd);
onClose = nextCallback("onClose", onClose);
