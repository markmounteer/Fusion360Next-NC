"use strict";
// Synthetic dimensions and tooling only. This is not a machine-ready program.
const fs = require("node:fs");
const path = require("node:path");
const {Program} = require("../src/next-nc");
const program = new Program({name: "Synthetic turning example", units: "mm", timestamp: "2026-09-27T00:00:00Z"});
const section = program.addSection({name: "Outside profile", tool: {number: 1, offset: 1, description: "Logical OD tool"},
  workOffset: 1, start: [12, 0, 2], spindle: {mode: "css", speed: 80000, maximumRPM: 1800, clockwise: true}, coolant: "off"});
section.rapid([10, 0, 2]);
section.linear([10, 0, 0], {value: 0.1, mode: "perRevolution"});
section.linear([10, 0, -8], {value: 0.1, mode: "perRevolution"});
section.arc([8, 0, -10], [8, 0, -8], false, {value: 0.1, mode: "perRevolution"}, false);
section.rapid([12, 0, -10]);
fs.writeFileSync(path.join(__dirname, "turning.stpnc"), program.toSTEP());
