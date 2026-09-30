"use strict";
const test=require("node:test"), assert=require("node:assert/strict");
const {Program}=require("../src/next-nc"), {inspect}=require("../lib/inspect");
const {engine}=require("./support/fusion-engine");
const tau=2*Math.PI;
function program({plane="XY",machine="mill",units="mm",cw=false,sweep=tau,rise=0,tolerance={value:0.002,provenance:"fusion:operation:tolerance"}}={}) {
  const frame={XY:[0,1,2],XZ:[2,0,1],YZ:[1,2,0]}[plane], [u,v,n]=frame;
  const start=[0,0,0], end=[0,0,0], center=[0,0,0]; start[u]=2;
  end[u]=2*Math.cos(sweep); end[v]=2*Math.sin(sweep)*(cw?-1:1); end[n]=rise;
  const p=new Program({machine,units,profileRevision:2,name:"Revision two",timestamp:"2026-09-30T00:00:00Z"});
  const s=p.addSection({name:"test",start,tool:{number:1,offset:1},workOffset:1,spindle:{mode:"rpm",speed:1000,clockwise:true},coolant:"off",tolerance});
  s.setMovement(rise?"ramp-helix":"cutting"); s.circular(end,center,cw,{value:120,mode:machine==="lathe"?"perRevolution":"perMinute"},plane,sweep);
  return p;
}
test("revision two preserves both senses, planes, units, partial/full/multiple turns and signed helical rise",()=>{
  for(const machine of ["lathe","mill"]) for(const units of ["mm","inch"]) for(const plane of machine==="mill"?["XY","XZ","YZ"]:["XZ"])
    for(const cw of [false,true]) for(const sweep of [Math.PI/2,tau,2.5*tau]) for(const rise of machine==="mill"?[0,-3,3]:[0]) {
      const p=program({machine,units,plane,cw,sweep,rise}), decoded=inspect(p.toSTEP()), path=decoded.model.sections[0].paths[0];
      assert.equal(path.sweepRadians,sweep); assert.equal(path.axialRise,rise); assert.equal(path.clockwise,cw); assert.equal(path.plane,plane);
      assert.deepEqual(path.end,p.sections[0].position); assert.equal(decoded.model.profileRevision,2);
      assert.equal(decoded.model.requiredCapabilities.includes("helix"),rise!==0);
      assert.equal(decoded.model.requiredCapabilities.includes("multiple-turns"),sweep>tau);
      assert.equal(path.feed.mode,machine==="lathe"?"perRevolution":"perMinute");
    }
});
test("tolerance and movement affect fingerprints and prevent incompatible path compaction",()=>{
  const p=program(), before=inspect(p.toSTEP()).report.programFingerprint.value;
  p.sections[0].tolerance.value=0.003;
  assert.notEqual(inspect(p.toSTEP()).report.programFingerprint.value,before);
  const s=p.sections[0]; s.setMovement("lead-out"); s.linear([3,0,0],{value:120,mode:"perMinute"});
  s.setMovement("link-direct"); s.linear([4,0,0],{value:120,mode:"perMinute"});
  assert.equal(inspect(p.toSTEP()).model.sections[0].paths.length,3);
});
test("old-profile label cannot disguise revision two, and capability corruption fails",()=>{
  const text=program({rise:2}).toSTEP();
  assert.throws(()=>inspect(text.replaceAll("milling-toolpath/0.2","milling-toolpath/0.1")),/revision-2/);
  assert.throws(()=>inspect(text.replace('"helix",','')),/capabilities disagree/);
  assert.throws(()=>inspect(text.replace('"axialRise":2','"axialRise":-2')),/axial rise/);
  assert.throws(()=>inspect(text.replace('"sweepRadians":6.283185307179586','"sweepRadians":3.141592653589793')),/sweep disagrees/);
});
test("missing tolerance stays missing and does not become a post default",()=>{
  const p=program({tolerance:{value:null,provenance:"missing"}});
  assert.deepEqual(inspect(p.toSTEP()).model.sections[0].tolerance,{value:null,provenance:"missing"});
});
test("Fusion retains operation tolerance and movement while rejecting unsupported coolant",()=>{
  const {c,output}=engine(); c.currentSection.parameters["operation:tolerance"]=0.004;
  c.onOpen();c.onSection();c.onMovement(c.MOVEMENT_LEAD_IN);c.onLinear(12,0,0,0.1);c.onClose();
  const section=inspect(output.join("\n")+"\n").model.sections[0];
  assert.deepEqual(section.tolerance,{value:0.004,provenance:"fusion:operation:tolerance"}); assert.equal(section.paths[0].movement,"lead-in");
  const e=engine(); e.c.tool.coolant=e.c.COOLANT_THROUGH_TOOL;
  assert.throws(()=>e.c.onOpen(),/COOLANT_CAPABILITY/);assert.equal(e.output.length,0);
});
