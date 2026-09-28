"use strict";
const fs = require("node:fs");
const {inspect, compare} = require("../lib/inspect");
const args = process.argv.slice(2), files = [];
let previous, invalid = false;
for (let i = 0; i < args.length; ++i) {
  if (args[i] === "--compare" && !previous && args[i + 1] && !args[i + 1].startsWith("--")) previous = args[++i];
  else if (args[i].startsWith("--")) invalid = true;
  else files.push(args[i]);
}
const [input, output] = files;
if (!input || files.length > 2 || invalid) {
  console.error("Usage: node scripts/inspect.js input.stpnc [new-report.json] [--compare previous.stpnc]"); process.exitCode = 2;
} else {
  try {
    const text = fs.readFileSync(input, "utf8"), result = inspect(text);
    if (previous) result.report.comparison = compare(fs.readFileSync(previous, "utf8"), text);
    const report = JSON.stringify(result.report, null, 2) + "\n";
    if (output) fs.writeFileSync(output, report, {flag: "wx"});
    process.stdout.write(report);
    if (result.report.comparison && !result.report.comparison.sameProgram) process.exitCode = 3;
  } catch (error) {
    console.error(error.message);
    if (error.context) console.error(JSON.stringify(error.context));
    process.exitCode = 1;
  }
}
