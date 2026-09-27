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
const executable = process.env.AUTODESK_POST;
if (!executable || !fs.existsSync(executable)) throw new Error("Set AUTODESK_POST to your installed Autodesk post.exe.");
const root = path.resolve(__dirname, "..");
const commit = "c95cce0a6e9f5f48e163a7e6d26a9d005fde85e5";
const cache = path.join(root, ".cache", "autodesk", commit);
const cases = [
  ["face", "decb11eef33e02d0a6928d99f78380c6af20df2e96983c77043a5ac2065fc12a"],
  ["profile with compensation", "22610053be4759494b659675a297b948f798cfa869347fd960ab509128dd031a"]
];
async function main() {
  fs.mkdirSync(cache, {recursive: true});
  for (const [name, checksum] of cases) {
    const file = path.join(cache, name + ".cnc");
    if (!fs.existsSync(file)) {
      const url = `https://raw.githubusercontent.com/Autodesk/cam-posteditor/${commit}/vs-code-extension/res/CNC%20files/Turning/${encodeURIComponent(name)}.cnc`;
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
  function post(name, cpsSource, fixture, expected) {
    const cps = path.join(temporary, name + ".cps"), out = path.join(temporary, name + ".stpnc");
    const logPath = path.join(temporary, name + ".log");
    fs.writeFileSync(cps, cpsSource);
    const result = spawnSync(executable, ["--noeditor", "--nointeraction", "--nobackup", "--security", "1000",
      "--log", logPath, cps, path.join(cache, fixture + ".cnc"), out], {encoding: "utf8", timeout: 30000});
    if (result.error) throw result.error;
    const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "";
    assert.equal(result.status, expected, log + result.stdout + result.stderr);
    return {log, output: fs.existsSync(out) ? fs.readFileSync(out, "utf8") : ""};
  }
  try {
    const old = post("bad-version", source.replace('version = "1.0";', "version = NextNC.version;"), "face", 500);
    assert.match(old.log, /Post configuration is not compatible with this version/);
    assert.doesNotMatch(old.log, /NEXTNC START/);
    const good = post("face", source, "face", 0);
    assert.match(good.log, /Post processing completed successfully/);
    assert.match(good.log, /NEXTNC OUTPUT WRITTEN/);
    assert.ok(parse(good.output).all("MACHINING_TOOLPATH").length > 0);
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
    console.log("PASS: actual Autodesk posting: incompatible-version regression, successful facing, compensation precheck and runtime diagnostic.");
    console.log("Fixtures: Autodesk sample turning files; not the user's Fusion job, GUI, or a machine test.");
  } finally {
    assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporary).startsWith("next-nc-posting-"));
    fs.rmSync(temporary, {recursive: true, force: true});
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
