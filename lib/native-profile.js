"use strict";
// Independent validation of the revision-2 descriptive extensions. Do not import
// writer code here: this reader is also an oracle for native posting fixtures.
const movementClasses = ["unspecified", "rapid", "cutting", "finish-cutting", "lead-in", "lead-out", "link-transition", "link-direct", "ramp-helix", "ramp-profile", "ramp-zig-zag", "ramp", "plunge", "predrill", "extended", "reduced", "high-feed"];
function object(value, keys, check) {
  check(value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("|") === [...keys].sort().join("|"), "invalid revision-2 object fields");
}
function tolerance(value, check) {
  object(value, ["value", "provenance"], check);
  check(value.provenance === "missing" ? value.value === null :
    ["fusion:operation:tolerance", "source-declared"].includes(value.provenance) && Number.isFinite(value.value) && value.value > 0,
  "invalid tolerance value/provenance");
  return {value:value.value,provenance:value.provenance};
}
function circular(value, milling, bounds, check) {
  object(value, ["start", "end", "center", "plane", "clockwise", "sweepRadians", "axialRise"], check);
  const frames = {XY: [0,1,2,1], XZ: [0,2,1,-1], YZ: [1,2,0,1]};
  check(Object.hasOwn(frames, value.plane) && (milling || value.plane === "XZ"), "unsupported circular plane");
  const [u,v,n,sign] = frames[value.plane], {start,end,center,sweepRadians:sweep,clockwise,axialRise} = value;
  for (const p of [start,end,center]) check(Array.isArray(p) && p.length === 3 && p.every(x => Number.isFinite(x) && Math.abs(x)<1e15) && (milling || p[1] === 0), "invalid circular point");
  check(typeof clockwise === "boolean" && Number.isFinite(sweep) && sweep>0 && sweep<=20000*Math.PI, "invalid circular sweep/direction");
  check(Number.isFinite(axialRise) && end[n]-start[n] === axialRise && center[n] === start[n], "circular axial rise or center height disagrees");
  const a = [start[u]-center[u],sign*(start[v]-center[v])], b = [end[u]-center[u],sign*(end[v]-center[v])];
  const radius = Math.hypot(...a), endRadius = Math.hypot(...b), threshold = Math.max(1e-7,radius*1e-6);
  check(radius>0 && Math.abs(endRadius-radius)<=threshold, "circular endpoint radius mismatch");
  const actual = Math.atan2(a[0]*b[1]-a[1]*b[0],a[0]*b[0]+a[1]*b[1]);
  const difference = actual-(clockwise ? -sweep : sweep);
  check(Math.abs(Math.atan2(Math.sin(difference),Math.cos(difference)))*radius <= threshold, "circular sweep disagrees with supplied endpoint");
  bounds(start); bounds(end);
  const firstAngle = Math.atan2(a[1],a[0]), tau=2*Math.PI;
  for (let i=0;i<4;i++) {
    const angle=i*Math.PI/2, along=((clockwise ? firstAngle-angle : angle-firstAngle)%tau+tau)%tau;
    if (along<=sweep) {
      const p=[...center]; p[u]+=radius*Math.cos(angle); p[v]+=sign*radius*Math.sin(angle);
      p[n]=start[n]+axialRise*(along/sweep); bounds(p);
    }
  }
  // Hash source intent in a fixed order. Derived hypot/trigonometric results can
  // differ by an ULP across runtimes and are not source fields or job identity.
  return {kind:"circular",start,end,center,plane:value.plane,clockwise,sweepRadians:sweep,axialRise};
}
function requirements(model) {
  const result=new Set(["completion","spindle","tool-change","tool-offset","coolant"]);
  for (const s of model.sections) {
    if (s.initialSpindle.mode==="css") result.add("css");
    if (s.initialCoolant==="through tool") result.add("coolant-through-tool");
    for (const p of s.paths) {
      result.add(p.kind==="dwell" ? "dwell" : ["arc","circular"].includes(p.kind) ? "planar-arc" : "linear");
      if(p.axialRise) result.add("helix");
      if(p.sweepRadians>2*Math.PI) result.add("multiple-turns");
      if(p.feed?.mode==="perRevolution") result.add("feed-per-revolution");
      if(p.spindle.mode==="css") result.add("css");
      if(p.coolant==="through tool") result.add("coolant-through-tool");
    }
  }
  return [...result].sort();
}
module.exports={movementClasses,tolerance,circular,requirements};
