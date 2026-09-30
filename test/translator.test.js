"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const {postedFixture} = require("./support/posted-fixture");
const {Program} = require("../src/next-nc");
const {consumer, checkTranslation} = require("./support/translator");
const {inspect} = require("../lib/inspect");
const api = consumer();
for (const machine of ["lathe", "mill"]) for (const units of ["mm", "inch"]) {
  test(`${machine} ${units}: legacy consumer refuses native CPS semantics even under a forged old label`, () => {
    const text=postedFixture(machine,units);
    assert.equal(inspect(text).model.profileRevision,2);
    for(const input of [text,text.replaceAll("toolpath/0.2","toolpath/0.1")]){
      assert.throws(()=>api.readProgram(input),e=>e.code==="UNSUPPORTED_PROPERTY");
    }
  });
  test(`${machine} ${units}: explicit revision-1 writer API retains the pinned translator's execution audits`, () => {
    const mill=machine==="mill",y=mill?1:0,p=new Program({machine,units,profileRevision:1});
    const initial={mode:mill?"rpm":"css",speed:mill?1200:units==="mm"?80000:1200,clockwise:true,...(mill?{}:{maximumRPM:1800})};
    const s=p.addSection({name:"First",start:[2,y,0],tool:{number:1,offset:4},workOffset:1,spindle:initial,coolant:"flood"});
    s.rapid([2,y,-1]);s.linear([2,y,-2],{value:100,mode:"perMinute"});
    for(const [plane,center] of mill?[["XY",[1,y,-2]],["XZ",[1,y,-2]],["YZ",[2,0,-2]]]:[["XZ",[1,0,-2]]]){
      s.arc([2,y,-2],center,false,{value:100,mode:"perMinute"},true,plane);s.arc([2,y,-2],center,true,{value:100,mode:"perMinute"},true,plane);
    }
    s.linear([2,y,-3],{value:0.08,mode:"perRevolution"});s.dwell(0.25);
    p.addSection({name:"Second",start:[2,y,0],tool:{number:2,offset:mill?7:8},workOffset:1,spindle:{mode:"rpm",speed:700,clockwise:false},coolant:"mist"}).linear([2,y,-4],{value:50,mode:"perMinute"});
    const text=p.toSTEP(),result=checkTranslation(text,api);
    assert.deepEqual(result.program.model, inspect(text).model);
    assert.match(result.out.gcode, /T2 M6/); assert.match(result.out.gcode, mill ? /G43 H7/ : /G43 H8/);
    assert.match(result.out.gcode, /G95 F0\.08/); assert.match(result.out.gcode, /G4 P0\.25/);
    assert.match(result.out.gcode, /M4 \$0/); assert.match(result.out.gcode, /M7/);
    if (!mill) assert.match(result.out.gcode, units === "mm" ? /G96 D1800 S80/ : /G96 D1800 S100/);
    for (const change of result.out.sourceMap.filter(e => e.command.type === "toolChange")) {
      assert.deepEqual(result.out.sourceMap.slice(change.line, change.line + 4).map(e => e.command.type), ["initialize", "spindleStop", "coolant", "spindleMode"]);
    }
  });
}
