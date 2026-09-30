"use strict";
const {engine}=require("./fusion-engine");
// Actual generated CPS callbacks in the synthetic Fusion host, not a machine job.
function postedFixture(machine,units){
  const {c,output}=engine(),mill=machine==="mill",y=mill?1:0;
  c.unit=units==="mm"?c.MM:c.IN;c.tool.lengthOffset=4;
  c.currentSection.getType=()=>mill?c.TYPE_MILLING:c.TYPE_TURNING;
  c.currentSection.getInitialPosition=()=>({x:2,y,z:0});c.currentSection.feedMode=c.FEED_PER_MINUTE;
  const first=c.currentSection,firstTool=c.tool;first.getTool=()=>firstTool;
  const secondTool={...firstTool,number:2,lengthOffset:7,compensationOffset:8,clockwise:false,coolant:c.COOLANT_MIST};
  const second={...first,getTool:()=>secondTool,parameters:{...first.parameters,"operation-comment":"Second tool"}};
  if(!mill){firstTool.getSpindleMode=()=>c.SPINDLE_CONSTANT_SURFACE_SPEED;firstTool.surfaceSpeed=units==="mm"?80000:1200;}
  c.sections=[first,second];c.onOpen();c.onSection();
  c.onRapid(2,y,-1);c.onLinear(2,y,-2,100);c.isFullCircle=()=>1;
  for(const [plane,center] of mill?[[c.PLANE_XY,[1,y,-2]],[c.PLANE_ZX,[1,y,-2]],[c.PLANE_YZ,[2,0,-2]]]:[[c.PLANE_ZX,[1,0,-2]]]){
    c.getCircularPlane=()=>plane;c.onCircular(0,...center,2,y,-2,100);c.onCircular(1,...center,2,y,-2,100);
  }
  c.onFeedMode(c.FEED_PER_REVOLUTION);c.onLinear(2,y,-3,0.08);c.onDwell(0.25);c.onSectionEnd();
  c.currentSection=second;c.tool=secondTool;c.onSection();c.onSpindleSpeed(700);c.onLinear(2,y,-4,50);c.onSectionEnd();c.onClose();
  return output.join("\n")+"\n";
}
module.exports={postedFixture};
