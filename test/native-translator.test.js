"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),os=require("node:os"),{execFileSync,spawnSync}=require("node:child_process");
const {postedFixture}=require("./support/posted-fixture"),{inspect}=require("../lib/inspect");
const pin=require("../scripts/native-translator-baseline.json");
assert.ok(process.env.NEXTNC_NATIVE_ROOT,"Set NEXTNC_NATIVE_ROOT to the built, pinned Rust compiler checkout");
const root=path.resolve(process.env.NEXTNC_NATIVE_ROOT);
assert.equal(execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim(),pin.commit);
assert.equal(execFileSync("git",["status","--porcelain","--untracked-files=no"],{cwd:root,encoding:"utf8"}).trim(),"");
const binary=path.join(root,"target","debug","nextnc-native"+(process.platform==="win32"?".exe":""));
for(const machine of ["lathe","mill"])for(const units of ["mm","inch"]){
  test(`${machine}/${units}: current generated CPS agrees exactly with the pinned Rust source decoder`,()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),"nextnc-native-interop-"));
    try{
      const text=postedFixture(machine,units),file=path.join(dir,"input.stpnc");fs.writeFileSync(file,text);
      const result=spawnSync(binary,["inspect",file],{encoding:"utf8",maxBuffer:8*1024*1024});
      assert.equal(result.status,0,result.stderr||String(result.error));
      const decoded=JSON.parse(result.stdout),expected=inspect(text);
      assert.equal(decoded.executable,false);assert.deepEqual(decoded.program.model,expected.model);
      assert.deepEqual(decoded.program.report.programFingerprint,expected.report.programFingerprint);
      assert.ok(decoded.program.model.sections[0].paths.some(p=>p.feed?.mode==="perRevolution"));
      assert.ok(decoded.program.model.sections[0].paths.some(p=>p.kind==="dwell"));
      assert.equal(decoded.program.model.sections[1].initialSpindle.clockwise,false);
      assert.equal(decoded.program.model.sections[1].initialCoolant,"mist");
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
  });
}
