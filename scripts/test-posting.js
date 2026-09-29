"use strict";
// Actual native posting, beyond --interrogate. Autodesk sample data is downloaded
// from a pinned upstream commit into an ignored cache; never bundled in releases.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const {spawnSync} = require("node:child_process");
const {parse} = require("../test/support/part21");
const {inspect} = require("../lib/inspect");
const executable = process.env.AUTODESK_POST;
if (!executable || !fs.existsSync(executable)) throw new Error("Set AUTODESK_POST to your installed Autodesk post.exe.");
const root = path.resolve(__dirname, "..");
const commit = "c95cce0a6e9f5f48e163a7e6d26a9d005fde85e5";
const cache = path.join(root, ".cache", "autodesk", commit);
const cases = [
  ["face", "decb11eef33e02d0a6928d99f78380c6af20df2e96983c77043a5ac2065fc12a"],
  ["profile no compensation", "db1cd6082845e2bcf0c53b37cf92527ff69309fb3b51e1fd6ed2fbea310198fc"],
  ["profile with compensation", "22610053be4759494b659675a297b948f798cfa869347fd960ab509128dd031a"],
  ["mill-face", "c6a5792912b1806ddf330e8060cefb6e3a97a5d8a0e1479bf30483b72b8954b7", "Milling/2D/face"],
  ["mill-bore", "ff2eab89951df4a302612d75dad1fdca38bee45fc84e81d9efbd699a1fa92f01", "Milling/2D/bore"],
  ["mill-toolchange", "8406eb9225d8b51b5ce7c6bc0ec79ab496dcce8db826f2815f71f1eb80d122f7", "Milling/2D/toolchange"],
  ["mill-Rapid out", "d9af1261a0a54a7a6192ef50ca08d82a8f5c55e85759459e8df62d06c2f0ea40", "Milling/Drilling/Rapid out"],
  ["mill-dwell and rapid out", "066090e05c0949ca19533aefd198cd3e07e0af098a7da190cd0abf388214773d", "Milling/Drilling/dwell and rapid out"],
  ["mill-chip breaking", "30c76060259e51ad4ad4c885bb7d28cce03897b509abd40e68dca00fe970ec40", "Milling/Drilling/chip breaking"],
  ["mill-deep drilling", "14379b236cafa167cd0d1a019429c1a92d3820280a0b1bda90b071fa4cee7d56", "Milling/Drilling/deep drilling"],
  ["mill-tapping", "01b3fb196823dfc9155d84d9faaf7fb85e00ce22a89204cce60ead40997416c2", "Milling/Drilling/tapping"]
];
async function main() {
  fs.mkdirSync(cache, {recursive: true});
  for (const [name, checksum, location] of cases) {
    const file = path.join(cache, name + ".cnc");
    if (!fs.existsSync(file)) {
      const fixturePath = (location || "Turning/" + name).split("/").map(encodeURIComponent).join("/");
      const url = `https://raw.githubusercontent.com/Autodesk/cam-posteditor/${commit}/vs-code-extension/res/CNC%20files/${fixturePath}.cnc`;
      const response = await fetch(url, {signal: AbortSignal.timeout(30000)});
      assert.ok(response.ok, `Sample download failed: ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), checksum);
      fs.writeFileSync(file, bytes);
    }
    assert.equal(crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"), checksum);
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "next-nc-posting-"));
  const source = fs.readFileSync(path.join(root, "posts/next-nc.cps"), "utf8");
  const bridge = process.env.LINUXCNC_NEXTNC ? require("../test/support/translator") : null;
  const consumer = bridge ? bridge.consumer() : null;
  if (!bridge) console.log("NOT CHECKED: translator integration; set LINUXCNC_NEXTNC to the pinned checkout to enable it.");
  function post(name, cpsSource, fixture, expected) {
    const cps = path.join(temporary, name + ".cps"), out = path.join(temporary, name + ".stpnc");
    const logPath = path.join(temporary, name + ".log");
    fs.writeFileSync(cps, cpsSource);
    const result = spawnSync(executable, ["--noeditor", "--nointeraction", "--nobackup", "--security", "1000",
      "--log", logPath, cps, path.join(cache, fixture + ".cnc"), out], {encoding: "utf8", timeout: 30000});
    if (result.error) throw result.error;
    const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "";
    assert.equal(result.status, expected, log + result.stdout + result.stderr);
    const output = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "";
    if (expected === 0 && bridge) {
      const checked = bridge.checkTranslation(output, consumer);
      console.log(`PASS: ${name}: translator completeness, policy and serialization audits (${checked.out.report.gcodeLines} lines).`);
    }
    return {log, output};
  }
  try {
    const trace = `
var traceRapid = onRapid, traceLinear = onLinear, traceDwell = onDwell;
onRapid = function (x,y,z) { log("TEST EXPANDED " + JSON.stringify({kind:"rapid",end:[x,y,z]})); traceRapid(x,y,z); };
onLinear = function (x,y,z,f) { log("TEST EXPANDED " + JSON.stringify({kind:"linear",end:[x,y,z],feed:f})); traceLinear(x,y,z,f); };
onDwell = function (t) { log("TEST EXPANDED " + JSON.stringify({kind:"dwell",seconds:t})); traceDwell(t); };
`;
    for (const [fixture, type] of [["mill-Rapid out", "drilling"], ["mill-dwell and rapid out", "counter-boring"], ["mill-chip breaking", "chip-breaking"], ["mill-deep drilling", "deep-drilling"]]) {
      const result = post(fixture, source + trace, fixture, 0), decoded = inspect(result.output);
      const summaries = [...result.log.matchAll(/NEXTNC CYCLE EXPANDED (\{[^\r\n]+\})/g)].map(m => JSON.parse(m[1]));
      assert.ok(summaries.length); assert.ok(summaries.every(s => s.cycle.type === type && s.cycle.points > 0));
      assert.equal(decoded.model.sections.length, 1);
      let position = decoded.model.sections[0].start;
      const callbacks = [...result.log.matchAll(/TEST EXPANDED (\{[^\r\n]+\})/g)].map(m => JSON.parse(m[1])).filter(event => {
        if (event.kind === "dwell") return true;
        const changed = event.end.some((n, i) => n !== position[i]); position = event.end; return changed;
      });
      const paths = decoded.model.sections[0].paths;
      const actual = paths.flatMap(p => p.kind === "dwell" ? [{kind: "dwell", seconds: p.seconds}] : p.points.slice(1).map(end => ({kind: p.kind, end, ...(p.feed ? {feed: p.feed.value} : {})})));
      assert.deepEqual(actual, callbacks, "Every native expanded move, feed and dwell must survive in order");
      const cuts = actual.filter(e => e.kind === "linear").length;
      assert.ok(cuts >= 2);
      if (type === "counter-boring" && summaries.some(s => s.cycle.parameters.dwell > 0)) assert.ok(actual.some(e => e.kind === "dwell"));
      if (type === "chip-breaking" || type === "deep-drilling") assert.ok(cuts > summaries.reduce((n,s) => n + s.cycle.points, 0));
      console.log(`PASS: actual Autodesk ${type}: ${callbacks.length} ordered moves/dwells exactly preserved.`);
    }
    // The published counter-boring sample requests zero dwell. Exercise a
    // positive dwell separately with an explicit test-only parameter override.
    const dwellDriver = '\nvar nativeCycle = onCycle; onCycle = function () { cycle.dwell = 0.25; nativeCycle(); };\n';
    const dwellResult = post("synthetic-positive-dwell", source + dwellDriver, "mill-dwell and rapid out", 0);
    const dwells = inspect(dwellResult.output).model.sections.flatMap(s => s.paths.filter(p => p.kind === "dwell"));
    assert.equal(dwells.length, 2); assert.ok(dwells.every(p => p.seconds === 0.25));
    const tapping = post("reject-tapping", source, "mill-tapping", 500);
    assert.match(tapping.log, /\[CYCLE\]/); assert.doesNotMatch(tapping.output, /END-ISO-10303-21/);
    for (const fixture of ["mill-face", "mill-bore", "mill-toolchange"]) {
      const result = post(fixture, source, fixture, 0), decoded = inspect(result.output);
      assert.equal(decoded.report.machine, "mill");
      assert.ok(decoded.report.paths > 0); assert.ok(decoded.report.bounds.max[1] !== decoded.report.bounds.min[1]);
      if (fixture === "mill-bore") assert.match(result.log, /NEXTNC HELIX LINEARIZED/);
      console.log(`PASS: actual Autodesk ${fixture}: ${decoded.report.sections} sections, ${decoded.report.paths} paths.`);
    }
    const old = post("bad-version", source.replace('version = "1.0";', "version = NextNC.version;"), "face", 500);
    assert.match(old.log, /Post configuration is not compatible with this version/);
    assert.doesNotMatch(old.log, /NEXTNC START/);
    const good = post("face", source, "face", 0);
    assert.match(good.log, /Post processing completed successfully/);
    assert.match(good.log, /NEXTNC OUTPUT WRITTEN/);
    assert.ok(parse(good.output).all("MACHINING_TOOLPATH").length > 0);
    assert.ok(inspect(good.output).report.paths > 0);
    const summary = JSON.parse(good.log.match(/NEXTNC OUTPUT WRITTEN (\{[^\r\n]+\})/)[1]);
    assert.equal(summary.summary.entities, parse(good.output).records.size);
    assert.deepEqual(summary.summary.curveDefinitions, inspect(good.output).report.curveDefinitions);
    assert.ok(summary.summary.reusedValues > 0);
    const oldArc = post("bad-arc-flag", source + '\nnextBoolean = function (value) { return value; };\n', "profile no compensation", 500);
    assert.match(oldArc.log, /arc direction must be explicit/);
    // Trace native callback types and senses without modifying them.
    const arcTrace = '\nvar originalCircular = onCircular; onCircular = function () { log("TEST ARC FLAG " + typeof arguments[0] + " " + arguments[0]); originalCircular.apply(this, arguments); };\n';
    const profile = post("profile", source + arcTrace, "profile no compensation", 0);
    assert.match(profile.log, /TEST ARC FLAG number 0/);
    assert.match(profile.log, /NEXTNC ARC LINEARIZED/);
    assert.match(profile.log, /Post processing completed successfully/);
    const profileDoc = parse(profile.output);
    const inspected = inspect(profile.output);
    assert.equal(inspected.report.curveDefinitions.arcs, profileDoc.all("TRIMMED_CURVE").length);
    assert.ok(profileDoc.all("CIRCLE").length > 0);
    assert.ok(profileDoc.all("TRIMMED_CURVE").some(e => e.args[4].symbol === ".T."));
    assert.ok(profileDoc.all("TRIMMED_CURVE").every(e => e.args[4].symbol === ".T."));
    const arcCount = (profile.log.match(/TEST ARC FLAG number 0/g) || []).length;
    const linearizedCount = (profile.log.match(/NEXTNC ARC LINEARIZED/g) || []).length;
    assert.equal(inspected.report.arcs, arcCount - linearizedCount);
    const rejected = post("compensation", source, "profile with compensation", 500);
    assert.match(rejected.log, /\[COMPENSATION\]/);
    const report = JSON.parse(rejected.log.match(/NEXTNC DIAGNOSTIC BEGIN\r?\n([\s\S]*?)\r?\nNEXTNC DIAGNOSTIC END/)[1]);
    assert.equal(report.callback, "onOpen"); assert.equal(report.configurationVersion, "1.0");
    assert.equal(report.sections[0].compensation.value, "control"); assert.ok(report.engine);
    assert.doesNotMatch(rejected.output, /END-ISO-10303-21/);
    // The same failure remains identifiable after native callback dispatch begins.
    const runtime = post("runtime", source + '\nnextPrecheck = function () {}; nextSectionIssues = function () { return []; };\n', "profile with compensation", 500);
    assert.match(runtime.log, /NEXTNC DIAGNOSTIC BEGIN/);
    assert.match(runtime.log, /onRadiusCompensation/);
    assert.doesNotMatch(runtime.output, /END-ISO-10303-21/);
    console.log("PASS: actual Autodesk posting: version and numeric-arc regressions, successful facing/profile with native CCW arcs, bounded arc linearization, compensation precheck/runtime diagnostics.");
    console.log("Fixtures: Autodesk sample turning files; not the user's Fusion job, GUI, or a machine test.");
  } finally {
    assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporary).startsWith("next-nc-posting-"));
    fs.rmSync(temporary, {recursive: true, force: true});
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
